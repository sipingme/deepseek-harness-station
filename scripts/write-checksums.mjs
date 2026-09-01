import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const filename = `DeepSeek-Harness-Station-${manifest.version}-x64-Setup.exe`
const installer = await readFile(join(projectRoot, 'dist', filename))
const digest = createHash('sha256').update(installer).digest('hex')
await writeFile(join(projectRoot, 'dist', 'SHA256SUMS.txt'), `${digest}  ${filename}\n`, 'ascii')
console.log(`Wrote SHA256SUMS.txt for ${filename}`)
