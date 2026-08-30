import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'
import { auditRuntimeClosure } from './audit-runtime-closure.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function mustExist(path, label = path) {
  await access(path).catch(() => {
    throw new Error(`Packaged runtime is missing ${label}: ${path}`)
  })
  return path
}

async function walk(root, current = root) {
  const result = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) result.push(...await walk(root, path))
    else result.push(path.slice(root.length + 1).replaceAll('\\', '/'))
  }
  return result
}

async function resolvePackageManifest(requireFromRuntime, packageName, runtimeRoot) {
  try {
    return requireFromRuntime.resolve(`${packageName}/package.json`)
  } catch {
    let directory = dirname(requireFromRuntime.resolve(packageName))
    while (directory.startsWith(runtimeRoot)) {
      const candidate = join(directory, 'package.json')
      try {
        const manifest = JSON.parse(await readFile(candidate, 'utf8'))
        if (manifest.name === packageName) return candidate
      } catch {
        // Continue toward the package root.
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    throw new Error(`Unable to resolve packaged manifest for ${packageName}`)
  }
}

export async function readPeMachine(path) {
  const file = await readFile(path)
  if (file.length < 64 || file[0] !== 0x4d || file[1] !== 0x5a) throw new Error(`${path} is not a PE executable`)
  const peOffset = file.readUInt32LE(0x3c)
  if (peOffset + 6 > file.length || file.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${path} has an invalid PE header`)
  }
  return file.readUInt16LE(peOffset + 4)
}

export async function verifyPackagedRuntime(appOutDir) {
  const appDir = resolve(appOutDir)
  const resources = join(appDir, 'resources')
  const asar = await mustExist(join(resources, 'app.asar'), 'app.asar')
  const unpacked = await mustExist(join(resources, 'app.asar.unpacked'), 'unpacked Host runtime')
  const executable = await mustExist(join(appDir, 'DeepSeek Harness Station.exe'), 'application executable')
  const machine = await readPeMachine(executable)
  if (machine !== 0x8664) throw new Error(`Application executable is not x64 (PE machine 0x${machine.toString(16)})`)

  const archiveEntries = listPackage(asar, { isPack: false }).map(path => path.replaceAll('\\', '/'))
  for (const required of ['/lib/shell/main.js', '/lib/shell/supervisor.js', '/lib/host/main.js', '/lib/protocol.js', '/package.json']) {
    if (!archiveEntries.includes(required)) throw new Error(`app.asar is missing ${required}`)
  }
  const forbiddenArchive = archiveEntries.find(path => /^\/(src|tests?)(\/|$)/i.test(path) || /^\/lib\/.*\.map$/i.test(path) || /\/.cache\//i.test(path))
  if (forbiddenArchive !== undefined) throw new Error(`app.asar contains development-only content: ${forbiddenArchive}`)

  const hostEntry = await mustExist(join(unpacked, 'lib', 'host', 'main.js'), 'physical Host entry')
  await mustExist(join(unpacked, 'lib', 'protocol.js'), 'physical Host protocol')
  const unpackedManifest = await mustExist(join(unpacked, 'package.json'), 'physical ESM package manifest')
  const manifest = JSON.parse(await readFile(unpackedManifest, 'utf8'))
  if (manifest.type !== 'module') throw new Error('Physical package manifest must declare type=module')

  const requireFromRuntime = createRequire(unpackedManifest)
  const runtimePackages = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/cordis-plugin-group',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-host-frontend-static',
    'node-pty',
    'koffi',
  ]
  for (const packageName of runtimePackages) {
    await mustExist(await resolvePackageManifest(requireFromRuntime, packageName, unpacked), packageName)
  }

  const unpackedEntries = await walk(unpacked)
  const closureAudit = auditRuntimeClosure(join(unpacked, 'node_modules'))
  if (closureAudit.missing.length > 0) {
    throw new Error(`Packaged DeepSeek Harness closure is missing: ${closureAudit.missing.map(entry => `${entry.name}@${entry.version}`).join(', ')}`)
  }
  const requiredNative = [
    path => /node-pty\/prebuilds\/win32-x64\/conpty\.node$/i.test(path),
    path => /node-pty\/prebuilds\/win32-x64\/conpty_console_list\.node$/i.test(path),
    path => /koffi[^/]*\/win32_x64\/koffi\.node$/i.test(path),
    path => /node-pty\/(build\/Release|prebuilds\/win32-x64)\/conpty\/OpenConsole\.exe$/i.test(path),
  ]
  for (const predicate of requiredNative) {
    if (!unpackedEntries.some(predicate)) throw new Error('Packaged runtime is missing a required Windows x64 native artifact')
  }
  const wrongNative = unpackedEntries.find(path => /\.(node|dll|exe)$/i.test(path)
    && /\/(darwin-|linux-|win32-arm64|win10-arm64)\//i.test(`/${path}`))
  if (wrongNative !== undefined) throw new Error(`Packaged runtime contains a wrong-platform native artifact: ${wrongNative}`)
  const forbiddenUnpacked = unpackedEntries.find(path => /(^|\/)\.cache(\/|$)/i.test(path) || /^lib\/.*\.map$/i.test(path))
  if (forbiddenUnpacked !== undefined) throw new Error(`Unpacked runtime contains development-only content: ${forbiddenUnpacked}`)

  console.log(`Verified packaged Host closure (${unpackedEntries.length} physical files): ${hostEntry}`)
  return { appDir, executable, resources, unpacked }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appOutDir = process.argv[2] ?? join(projectRoot, 'dist', 'win-unpacked')
  await verifyPackagedRuntime(appOutDir)
}
