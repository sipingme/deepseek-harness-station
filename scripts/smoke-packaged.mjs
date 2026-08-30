import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = join(projectRoot, 'dist', 'win-unpacked', 'DeepSeek Harness Station.exe')
const smokeRoot = join(tmpdir(), `dsh-station-smoke-${process.pid}-${Date.now()}`)
const resultFile = join(smokeRoot, 'ready.json')
const secondFile = join(smokeRoot, 'second-instance.txt')
const userData = join(smokeRoot, 'user-data')
const dshHome = join(smokeRoot, 'dsh-home')
await mkdir(smokeRoot, { recursive: true })

function waitForFile(path, timeoutMs) {
  return new Promise((resolveWait, reject) => {
    const started = Date.now()
    const timer = setInterval(async () => {
      try {
        const content = await readFile(path, 'utf8')
        clearInterval(timer)
        resolveWait(content)
      } catch {
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer)
          reject(new Error(`Timed out waiting for ${path}`))
        }
      }
    }, 150)
  })
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged app did not exit within ${timeoutMs} ms`)), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveExit()
      else reject(new Error(`Packaged app exited with ${code ?? signal ?? 'unknown'}`))
    })
    child.once('error', reject)
  })
}

let first
let logs = ''
try {
  first = spawn(executable, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      STATION_SMOKE_FILE: resultFile,
      STATION_SMOKE_HOLD_MS: '15000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  first.stdout.on('data', chunk => { logs += chunk.toString() })
  first.stderr.on('data', chunk => { logs += chunk.toString() })
  const earlyExit = new Promise((_resolveExit, rejectExit) => {
    first.once('exit', (code, signal) => rejectExit(new Error(`Packaged app exited before readiness (${code ?? signal ?? 'unknown'})`)))
  })
  const result = JSON.parse(await Promise.race([waitForFile(resultFile, 90_000), earlyExit]))
  if (result.ok !== true || result.packaged !== true || !String(result.origin).startsWith('http://127.0.0.1:')) {
    throw new Error(`Invalid packaged readiness result: ${JSON.stringify(result)}`)
  }

  const second = spawn(executable, [
    `--user-data-dir=${userData}`,
    `--station-second-instance-smoke=${secondFile}`,
  ], { stdio: 'ignore', windowsHide: true })
  await waitForExit(second, 15_000)
  const secondResult = await waitForFile(secondFile, 15_000)
  if (secondResult.trim() !== 'focused') throw new Error('Second instance did not focus the existing window')
  await waitForExit(first, 30_000)

  const generations = join(dshHome, 'profiles', 'web', '.station-generations')
  const leftovers = await readdir(generations).catch(() => [])
  if (leftovers.length !== 0) throw new Error(`Host generation cleanup left ${leftovers.length} directories`)
  console.log('Packaged smoke passed: Host ready, renderer loaded, second instance focused, clean shutdown verified')
} finally {
  if (first !== undefined && first.exitCode === null) {
    const killer = spawn('taskkill.exe', ['/PID', String(first.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise(resolveKill => killer.once('exit', resolveKill))
  }
  await rm(smokeRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }).catch(() => undefined)
  if (logs.trim() !== '') console.error(logs.trim())
}
