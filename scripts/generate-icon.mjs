import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const icoOutput = resolve(projectRoot, 'build-resources', 'icon.ico')
const pngOutput = resolve(projectRoot, 'build-resources', 'icon.png')
const sizes = [16, 24, 32, 48, 64, 128, 256]

function insideRoundedSquare(x, y, size) {
  const margin = size * 0.055
  const radius = size * 0.19
  const left = margin
  const right = size - margin
  const top = margin
  const bottom = size - margin
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true
  if (x >= left && x <= right && y >= top + radius && y <= bottom - radius) return true
  const cx = x < left + radius ? left + radius : right - radius
  const cy = y < top + radius ? top + radius : bottom - radius
  return ((x - cx) ** 2) + ((y - cy) ** 2) <= radius ** 2
}

function rgba(x, y, size) {
  if (!insideRoundedSquare(x + 0.5, y + 0.5, size)) return [0, 0, 0, 0]
  const gradient = y / Math.max(1, size - 1)
  let color = [Math.round(16 + gradient * 8), Math.round(29 + gradient * 8), Math.round(58 + gradient * 22), 255]
  const line = Math.max(1, Math.round(size * 0.075))
  const left = Math.round(size * 0.27)
  const top = Math.round(size * 0.31)
  const mid = Math.round(size * 0.50)
  const bottom = Math.round(size * 0.69)
  const right = Math.round(size * 0.73)
  const prompt = (Math.abs((y - top) - (x - left)) <= line / 2 && x >= left && x <= mid)
    || (Math.abs((y - bottom) + (x - left)) <= line / 2 && x >= left && x <= mid)
  const cursor = y >= bottom - line / 2 && y <= bottom + line / 2 && x >= mid + line && x <= right
  if (prompt) color = [44, 224, 220, 255]
  if (cursor) color = [91, 145, 255, 255]
  return color
}

function dib(size) {
  const xorStride = size * 4
  const andStride = Math.ceil(size / 32) * 4
  const pixels = Buffer.alloc(xorStride * size)
  const mask = Buffer.alloc(andStride * size)
  for (let row = 0; row < size; row += 1) {
    const y = size - 1 - row
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = rgba(x, y, size)
      const offset = row * xorStride + x * 4
      pixels[offset] = b
      pixels[offset + 1] = g
      pixels[offset + 2] = r
      pixels[offset + 3] = a
      if (a === 0) mask[row * andStride + Math.floor(x / 8)] |= 0x80 >> (x % 8)
    }
  }
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(pixels.length, 20)
  return Buffer.concat([header, pixels, mask])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return chunk
}

function png(size) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = rgba(x, y, size)
      const offset = row + 1 + x * 4
      scanlines[offset] = r
      scanlines[offset + 1] = g
      scanlines[offset + 2] = b
      scanlines[offset + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const images = sizes.map(dib)
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
for (let index = 0; index < images.length; index += 1) {
  const size = sizes[index]
  const image = images[index]
  const entry = 6 + index * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
}
await mkdir(dirname(icoOutput), { recursive: true })
await Promise.all([
  writeFile(icoOutput, Buffer.concat([header, ...images])),
  writeFile(pngOutput, png(1024)),
])
console.log(`Generated ${icoOutput} and ${pngOutput}`)
