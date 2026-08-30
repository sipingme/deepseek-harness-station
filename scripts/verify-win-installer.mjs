import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPeMachine } from './verify-runtime.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const installer = join(projectRoot, 'dist', `DeepSeek-Harness-Station-${manifest.version}-x64-Setup.exe`)
await access(installer).catch(() => { throw new Error(`Windows installer is missing: ${installer}`) })
const machine = await readPeMachine(installer)
if (machine !== 0x014c && machine !== 0x8664) throw new Error(`Unexpected NSIS PE machine: 0x${machine.toString(16)}`)
const stat = await import('node:fs/promises').then(fs => fs.stat(installer))
if (stat.size < 1_000_000) throw new Error(`Installer is unexpectedly small: ${stat.size} bytes`)
console.log(`Verified NSIS installer (${(stat.size / 1024 / 1024).toFixed(1)} MiB): ${installer}`)
