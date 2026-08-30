import { access, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const manifest = await import('../package.json', { with: { type: 'json' } }).then(module => module.default)
const projectRoot = new URL('..', import.meta.url).pathname.slice(1).replaceAll('/', '\\')
const installer = join(projectRoot, 'dist', `DeepSeek-Harness-Station-${manifest.version}-x64-Setup.exe`)
const installDir = join(tmpdir(), `dhs-${process.pid}-${Date.now().toString(36)}`)

function run(executable, args, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${executable} timed out`))
    }, timeoutMs)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveRun()
      else reject(new Error(`${executable} exited with ${code ?? signal ?? 'unknown'}`))
    })
  })
}

async function waitUntilRemoved(path, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await access(path)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
    } catch {
      return
    }
  }
  throw new Error(`Uninstaller did not remove ${path}`)
}

await run(installer, ['/S', `/D=${installDir}`], 360_000)
await access(join(installDir, 'DeepSeek Harness Station.exe'))
const uninstallerName = (await readdir(installDir)).find(name => /^unins.*\.exe$/i.test(name) || /^uninstall.*\.exe$/i.test(name))
if (uninstallerName === undefined) throw new Error('Installed application has no uninstaller')
await run(join(installDir, uninstallerName), ['/S'], 180_000)
await waitUntilRemoved(installDir, 60_000)
console.log('Installer smoke passed: silent install, payload presence, uninstaller, and removal verified')
