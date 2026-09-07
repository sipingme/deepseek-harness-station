import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

if (process.env.GITHUB_ACTIONS !== 'true' && process.env.GITLAB_CI !== 'true') {
  throw new Error('Installer smoke must run in an isolated CI Windows account; it must not replace a user installation or shortcuts.')
}

const manifest = await import('../package.json', { with: { type: 'json' } }).then(module => module.default)
const projectRoot = new URL('..', import.meta.url).pathname.slice(1).replaceAll('/', '\\')
const installer = join(projectRoot, 'dist', `DeepSeek-Harness-Station-${manifest.version}-x64-Setup.exe`)
const installDir = join(tmpdir(), `dhs-${process.pid}-${Date.now().toString(36)}`)
const product = 'DeepSeek Harness Station'
const timings = {}

function state() {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(projectRoot, 'scripts', 'read-windows-install-state.ps1')], { encoding: 'utf8', windowsHide: true }))
}

function samePath(left, right) { return resolve(left).toLowerCase() === resolve(right).toLowerCase() }

function verifyLinks(snapshot, uninstaller) {
  const exe = join(installDir, `${product}.exe`)
  for (const path of [join(snapshot.desktop, `${product}.lnk`), join(snapshot.programs, product, `${product}.lnk`)]) {
    const link = snapshot.shortcuts.find(item => samePath(item.path, path))
    if (!link || !samePath(link.target, exe) || !link.icon.toLowerCase().startsWith(exe.toLowerCase())) {
      throw new Error(`Missing or incorrect application shortcut/icon: ${path}`)
    }
  }
  if (!snapshot.shortcuts.some(link => samePath(link.target, uninstaller))) throw new Error('Start menu uninstaller shortcut is missing')
  if (snapshot.registrations.length !== 1 || !snapshot.registrations[0].UninstallString.includes(uninstaller)) {
    throw new Error('Windows installed-apps uninstall registration is missing or incorrect')
  }
}

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

async function timed(label, executable, args, timeoutMs) {
  const start = performance.now()
  await run(executable, args, timeoutMs)
  timings[label] = Math.round(performance.now() - start)
  console.log(`${label}: ${(timings[label] / 1000).toFixed(1)} seconds`)
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

const initial = state()
if (initial.registrations.length || initial.shortcuts.length || initial.running) {
  throw new Error('Installer smoke refused: this Windows account already has a Station installation, shortcut, or running process.')
}
const sentinelName = `station-uninstall-smoke-${process.pid}.txt`
const sentinels = [join(resolveDshHome(), sentinelName), join(initial.appData, product, sentinelName)]
for (const file of sentinels) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'keep user data', { flag: 'wx' })
}
await timed('install', installer, ['/S', `/D=${installDir}`], 360_000)
await access(join(installDir, 'DeepSeek Harness Station.exe'))
const uninstallerName = (await readdir(installDir)).find(name => /^unins.*\.exe$/i.test(name) || /^uninstall.*\.exe$/i.test(name))
if (uninstallerName === undefined) throw new Error('Installed application has no uninstaller')
const uninstaller = join(installDir, uninstallerName)
const installed = state()
verifyLinks(installed, uninstaller)
// Remove only the links just created for our isolated test installation.
for (const link of installed.shortcuts) {
  if (!samePath(link.target, join(installDir, `${product}.exe`)) && !samePath(link.target, uninstaller)) {
    throw new Error(`Refusing to remove a shortcut outside the test installation: ${link.path}`)
  }
  await rm(link.path)
}
await timed('repair-install', installer, ['/S', `/D=${installDir}`], 360_000)
verifyLinks(state(), uninstaller)
await timed('uninstall', uninstaller, ['/S'], 180_000)
await waitUntilRemoved(installDir, 60_000)
const final = state()
if (final.registrations.length || final.shortcuts.length) throw new Error('Uninstaller left application registrations or shortcuts')
for (const file of sentinels) {
  if (await readFile(file, 'utf8') !== 'keep user data') throw new Error(`Uninstaller modified user data: ${file}`)
  await rm(file)
}
await writeFile(join(projectRoot, 'dist', 'installer-timings.json'), JSON.stringify(timings, null, 2))
console.log('Installer smoke passed: install, shortcut icons, repair install, uninstall entry, link cleanup, and user-data preservation verified')
