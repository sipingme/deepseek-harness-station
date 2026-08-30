import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'corepack'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'corepack', 'pnpm', 'licenses', 'list', '--prod', '--json']
  : ['pnpm', 'licenses', 'list', '--prod', '--json']
const result = spawnSync(command, args, {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
})
if (result.status !== 0) throw new Error(result.stderr || 'Unable to enumerate production dependency licenses')
const groups = JSON.parse(result.stdout)
const rows = []
for (const [license, packages] of Object.entries(groups)) {
  for (const entry of packages) {
    rows.push({
      name: entry.name,
      versions: [...entry.versions].sort().join(', '),
      license,
      homepage: entry.homepage ?? '',
    })
  }
}
rows.sort((left, right) => left.name.localeCompare(right.name) || left.versions.localeCompare(right.versions))
const lines = [
  'DeepSeek Harness Station — Third-Party Software Notices',
  '=======================================================',
  '',
  'This distribution contains the production dependencies listed below.',
  'Their license files remain in the packaged dependency directories.',
  '',
]
for (const row of rows) {
  lines.push(`${row.name} ${row.versions}`)
  lines.push(`License: ${row.license}`)
  if (row.homepage !== '') lines.push(`Project: ${row.homepage}`)
  lines.push('')
}
const output = join(projectRoot, 'THIRD_PARTY_NOTICES.txt')
await writeFile(output, `${lines.join('\n').trimEnd()}\n`, 'utf8')
console.log(`Generated ${output} (${rows.length} package records)`)
