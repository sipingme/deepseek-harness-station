import { access, cp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Arch, build, Platform } from 'electron-builder'

process.on('uncaughtExceptionMonitor', error => {
  if (process.env.GITHUB_ACTIONS) console.error(`::error::${error.message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
})

const manifest = await import('../package.json', { with: { type: 'json' } }).then(module => module.default)
const projectRoot = new URL('..', import.meta.url).pathname.slice(1).replaceAll('/', '\\')
const smokeRoot = resolve(projectRoot, 'dist', `installer-smoke-${process.pid}-${Date.now()}`)
if (!smokeRoot.startsWith(resolve(projectRoot, 'dist') + sep)) throw new Error('Invalid installer smoke directory')
const payload = join(smokeRoot, 'payload')
const installer = join(smokeRoot, 'Station-Installer-Smoke.exe')
// Expand TEMP's 8.3 alias before comparing WScript's long shortcut targets.
const installDir = join(await realpath(tmpdir()), `dhs-${process.pid}`)
const product = `Station Installer Test ${process.pid}`
const timings = {}

function state(name = product) {
  // NSIS is a 32-bit process: resolve SYSTEM profile folders in the same view.
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return JSON.parse(execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(projectRoot, 'scripts', 'read-windows-install-state.ps1'), '-Product', name], { encoding: 'utf8', windowsHide: true }))
}

function samePath(left, right) { return resolve(left).toLowerCase() === resolve(right).toLowerCase() }

function verifyLinks(snapshot, uninstaller) {
  const exe = join(installDir, `${product}.exe`)
  for (const path of [join(snapshot.desktop, `${product}.lnk`), join(snapshot.programs, product, `${product}.lnk`)]) {
    const link = snapshot.shortcuts.find(item => samePath(item.path, path))
    if (!link || !samePath(link.target, exe) || !link.icon.toLowerCase().startsWith(exe.toLowerCase())) {
      throw new Error(`Missing or incorrect application shortcut/icon: ${path}; state=${JSON.stringify(snapshot)}`)
    }
  }
  if (!snapshot.shortcuts.some(link => samePath(link.target, uninstaller))) throw new Error(`Start menu uninstaller shortcut is missing: expected=${uninstaller}; state=${JSON.stringify(snapshot)}`)
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

// Use the production payload and NSIS hooks with a separate executable, GUID,
// registry key and shortcut names. Never run the production installer as a test.
await cp(join(projectRoot, 'dist', 'win-unpacked'), payload, { recursive: true })
await rename(join(payload, 'DeepSeek Harness Station.exe'), join(payload, `${product}.exe`))
await build({
  projectDir: projectRoot, prepackaged: payload, publish: 'never',
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config: {
    extends: join(projectRoot, 'electron-builder.yml'),
    appId: `com.siping.deepseek-harness-station.installer-test.${process.pid}`,
    productName: product,
    extraMetadata: { name: `station-installer-test-${process.pid}` },
    directories: { output: smokeRoot },
    win: { executableName: product, artifactName: 'Station-Installer-Smoke.exe' },
    nsis: { shortcutName: product, menuCategory: product, uninstallDisplayName: product },
  },
})
const productionBefore = state('DeepSeek Harness Station')
const initial = state()
if (initial.registrations.length || initial.shortcuts.length || initial.running) {
  throw new Error(`Installer smoke refused: test identity is already in use: ${JSON.stringify(initial)}`)
}
const sentinelName = `station-uninstall-smoke-${process.pid}.txt`
const sentinels = [join(resolveDshHome(), sentinelName), join(initial.appData, product, sentinelName)]
for (const file of sentinels) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'keep user data', { flag: 'wx' })
}
await timed('install', installer, ['/S', '/currentuser', `/D=${installDir}`], 360_000)
await access(join(installDir, `${product}.exe`))
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
await timed('repair-install', installer, ['/S', '/currentuser', `/D=${installDir}`], 360_000)
verifyLinks(state(), uninstaller)
await timed('uninstall', uninstaller, ['/S'], 180_000)
await waitUntilRemoved(installDir, 60_000)
// NSIS removes the directory before its child finishes shortcut/registry cleanup.
const cleanupDeadline = Date.now() + 60_000
let final = state()
while (final.registrations.length || final.shortcuts.length) {
  if (Date.now() >= cleanupDeadline) throw new Error(`Uninstaller left application registrations or shortcuts: ${JSON.stringify(final)}`)
  await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  final = state()
}
for (const file of sentinels) {
  if (await readFile(file, 'utf8') !== 'keep user data') throw new Error(`Uninstaller modified user data: ${file}`)
  await rm(file)
}
await writeFile(join(projectRoot, 'dist', 'installer-timings.json'), JSON.stringify(timings, null, 2))
const productionAfter = state('DeepSeek Harness Station')
if (JSON.stringify(productionBefore.registrations) !== JSON.stringify(productionAfter.registrations)
  || JSON.stringify(productionBefore.shortcuts) !== JSON.stringify(productionAfter.shortcuts)) {
  throw new Error('Production installation registration or shortcuts changed during the test')
}
await rm(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
console.log('Installer smoke passed: install, shortcut icons, repair install, uninstall entry, link cleanup, and user-data preservation verified')
