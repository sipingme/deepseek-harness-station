import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'
import { auditRuntimeClosure } from './audit-runtime-closure.mjs'

async function mustExist(path, label = path) {
  await access(path).catch(() => {
    throw new Error(`Packaged macOS runtime is missing ${label}: ${path}`)
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

async function readMachOArchitecture(path) {
  const file = await readFile(path)
  if (file.length < 32 || file.readUInt32LE(0) !== 0xfeedfacf) {
    throw new Error(`${path} is not a little-endian 64-bit Mach-O executable`)
  }
  const cpuType = file.readUInt32LE(4)
  if (cpuType === 0x01000007) return 'x64'
  if (cpuType === 0x0100000c) return 'arm64'
  throw new Error(`${path} has an unsupported Mach-O CPU type 0x${cpuType.toString(16)}`)
}

export async function verifyPackagedMacRuntime(appOutDir) {
  const appDir = resolve(appOutDir)
  const bundle = join(appDir, 'DeepSeek Harness Station.app')
  const contents = join(bundle, 'Contents')
  const resources = join(contents, 'Resources')
  const executable = await mustExist(join(contents, 'MacOS', 'DeepSeek Harness Station'), 'application executable')
  const architecture = await readMachOArchitecture(executable)
  const asar = await mustExist(join(resources, 'app.asar'), 'app.asar')
  const unpacked = await mustExist(join(resources, 'app.asar.unpacked'), 'unpacked Host runtime')

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
  for (const packageName of [
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
  ]) {
    await mustExist(await resolvePackageManifest(requireFromRuntime, packageName, unpacked), packageName)
  }

  const unpackedEntries = await walk(unpacked)
  const closureAudit = auditRuntimeClosure(join(unpacked, 'node_modules'))
  if (closureAudit.missing.length > 0) {
    throw new Error(`Packaged DeepSeek Harness closure is missing: ${closureAudit.missing.map(entry => `${entry.name}@${entry.version}`).join(', ')}`)
  }

  const requiredNative = [
    new RegExp(`node-pty/prebuilds/darwin-${architecture}/pty\\.node$`, 'i'),
    new RegExp(`node-pty/prebuilds/darwin-${architecture}/spawn-helper$`, 'i'),
    new RegExp(`@koromix/koffi-darwin-${architecture}/darwin_${architecture}/koffi\\.node$`, 'i'),
  ]
  for (const pattern of requiredNative) {
    if (!unpackedEntries.some(path => pattern.test(path))) {
      throw new Error(`Packaged runtime is missing required macOS ${architecture} native artifact matching ${pattern}`)
    }
  }
  const wrongNative = unpackedEntries.find(path => /\/(prebuilds\/(win32|linux)-|@koromix\/koffi-(win32|linux)-)/i.test(`/${path}`))
  if (wrongNative !== undefined) throw new Error(`Packaged runtime contains a wrong-platform native artifact: ${wrongNative}`)
  const forbiddenUnpacked = unpackedEntries.find(path => /(^|\/)\.cache(\/|$)/i.test(path) || /^lib\/.*\.map$/i.test(path))
  if (forbiddenUnpacked !== undefined) throw new Error(`Unpacked runtime contains development-only content: ${forbiddenUnpacked}`)

  console.log(`Verified packaged macOS ${architecture} Host closure (${unpackedEntries.length} physical files): ${hostEntry}`)
  return { appDir, architecture, bundle, executable, resources, unpacked }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const appOutDir = process.argv[2] ?? join(projectRoot, 'dist', 'mac')
  await verifyPackagedMacRuntime(appOutDir)
}
