import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function packageDirFromAnchor(anchor, packageName) {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
}

export function auditRuntimeClosure(packagedModules) {
  const anchor = createRequire(join(projectRoot, 'package.json')).resolve('@deepseek-ai/dsh/package.json')
  const queue = [anchor]
  const closure = new Map()
  while (queue.length > 0) {
    const manifestPath = queue.shift()
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (closure.has(manifest.name)) continue
    closure.set(manifest.name, { version: manifest.version, manifestPath })
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
    for (const name of names) {
      if (closure.has(name)) continue
      const directory = packageDirFromAnchor(manifestPath, name)
      if (directory !== undefined) queue.push(join(directory, 'package.json'))
    }
  }
  const missing = [...closure.entries()]
    .filter(([name]) => !existsSync(join(packagedModules, name, 'package.json')))
    .map(([name, entry]) => ({ name, version: entry.version }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return { closure: closure.size, missing }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packagedModules = join(projectRoot, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules')
  console.log(JSON.stringify(auditRuntimeClosure(packagedModules), null, 2))
}
