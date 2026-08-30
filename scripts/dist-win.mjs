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
    let output = ''
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const forward = (stream, destination) => {
      stream?.on('data', chunk => {
        destination.write(chunk)
        output = `${output}${chunk.toString()}`.slice(-16_000)
      })
    }
    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else {
        if (process.env.GITHUB_ACTIONS === 'true') {
          const detail = output.trim().split(/\r?\n/).slice(-30).join('\n')
          const escaped = detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
          console.log(`::error title=${label.replaceAll(',', '%2C').replaceAll(':', '%3A')}::${escaped}`)
        }
        reject(new Error(`${label} failed (${code ?? signal ?? 'unknown'})`))
      }
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
