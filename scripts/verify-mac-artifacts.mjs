import { open, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('verify:mac-artifacts must run on macOS')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const architecture = process.argv[2] ?? process.arch
if (architecture !== 'x64' && architecture !== 'arm64') throw new Error(`Unsupported macOS architecture: ${architecture}`)

async function verifyZip(path) {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(4)
    await file.read(header, 0, header.length, 0)
    if (header[0] !== 0x50 || header[1] !== 0x4b) throw new Error(`${path} is not a ZIP archive`)
  } finally {
    await file.close()
  }
}

async function verifyDmg(path) {
  const info = await stat(path)
  if (info.size < 512) throw new Error(`${path} is too small to be a DMG`)
  const file = await open(path, 'r')
  try {
    const trailer = Buffer.alloc(4)
    await file.read(trailer, 0, trailer.length, info.size - 512)
    if (trailer.toString('ascii') !== 'koly') throw new Error(`${path} does not contain a UDIF trailer`)
  } finally {
    await file.close()
  }
}

const base = join(projectRoot, 'dist', `DeepSeek-Harness-Station-${manifest.version}-${architecture}`)
const dmg = `${base}.dmg`
const zip = `${base}.zip`
await Promise.all([verifyDmg(dmg), verifyZip(zip)])
const [dmgInfo, zipInfo] = await Promise.all([stat(dmg), stat(zip)])
console.log(`Verified macOS ${architecture}: DMG ${(dmgInfo.size / 1024 / 1024).toFixed(1)} MiB, ZIP ${(zipInfo.size / 1024 / 1024).toFixed(1)} MiB`)
