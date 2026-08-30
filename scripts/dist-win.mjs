import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('dist:win must run on Windows')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const corepack = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'corepack'
const pnpmArgs = args => process.platform === 'win32'
  ? ['/d', '/s', '/c', 'corepack', 'pnpm', ...args]
  : ['pnpm', ...args]

async function run(label, command, args) {
  console.log(`\n==> ${label}`)
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${label} failed (${code ?? signal ?? 'unknown'})`))
    })
  })
}

await run('Quality gate', corepack, pnpmArgs(['check']))
await run('Generate Windows icon', process.execPath, ['scripts/generate-icon.mjs'])
await run('Generate third-party notices', process.execPath, ['scripts/generate-notices.mjs'])
await run('Create unpacked Windows app', corepack, pnpmArgs(['exec', 'electron-builder', '--win', '--x64', '--dir']))
await run('Verify packaged runtime closure', process.execPath, ['scripts/verify-runtime.mjs', 'dist/win-unpacked'])
await run('Smoke packaged application', process.execPath, ['scripts/smoke-packaged.mjs'])
await run('Create NSIS installer', corepack, pnpmArgs(['exec', 'electron-builder', '--win', 'nsis', '--x64']))
await run('Verify NSIS installer', process.execPath, ['scripts/verify-win-installer.mjs'])
console.log('\nDeepSeek Harness Station Windows distribution completed successfully.')
