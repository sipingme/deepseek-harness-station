import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('dist:mac must run on macOS')
if (process.arch !== 'x64' && process.arch !== 'arm64') throw new Error(`Unsupported macOS architecture: ${process.arch}`)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function run(label, command, args) {
  console.log(`\n==> ${label}`)
  await new Promise((resolveRun, reject) => {
    let output = ''
    const child = spawn(command, args, { cwd: projectRoot, stdio: ['inherit', 'pipe', 'pipe'] })
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
          const detail = output.trim().split(/\r?\n/)
            .filter(line => !line.includes('duplicate dependency references')
              && !line.includes('platform-specific optional dependencies not bundled')
              && !line.includes('dependency not found on disk'))
            .slice(-30)
            .map(line => line.length > 1_000 ? '[truncated verbose dependency line]' : line)
            .join('\n')
          const escaped = detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
          console.log(`::error title=${label.replaceAll(',', '%2C').replaceAll(':', '%3A')}::${escaped}`)
        }
        reject(new Error(`${label} failed (${code ?? signal ?? 'unknown'})`))
      }
    })
  })
}

await run('Quality gate', 'pnpm', ['check'])
await run('Generate application icons', process.execPath, ['scripts/generate-icon.mjs'])
await run('Generate third-party notices', process.execPath, ['scripts/generate-notices.mjs'])
await run(`Create macOS ${process.arch} artifacts`, 'pnpm', [
  'exec',
  'electron-builder',
  '--mac',
  'dmg',
  'zip',
  `--${process.arch}`,
])
await run('Verify DMG and ZIP artifacts', process.execPath, ['scripts/verify-mac-artifacts.mjs', process.arch])
console.log(`\nDeepSeek Harness Station macOS ${process.arch} distribution completed successfully.`)
