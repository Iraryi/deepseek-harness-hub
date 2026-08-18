import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimeDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(runtimeDir, '..', '..')
const check = process.argv.includes('--check')
const packagePaths = globSync([
  'apps/*/package.json',
  'packages/*/*/package.json',
  'vendor/*/package.json',
  'native/landlock-run/package.json',
  'native/landlock-run/packages/*/package.json',
], { cwd: root }).sort()

const workspace = new Map()
for (const relativePath of packagePaths) {
  const manifest = JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
  if (manifest.name !== undefined) workspace.set(manifest.name, manifest)
}

const repositoryManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const cli = workspace.get('@deepseek-ai/dsh')
if (cli === undefined) throw new Error('apps/cli/package.json is missing from the workspace package map')

const runtimeDependencies = new Set(['@deepseek-ai/dsh'])
for (const dependency of Object.keys({ ...cli.dependencies, ...cli.optionalDependencies })) {
  if (workspace.has(dependency)) runtimeDependencies.add(dependency)
}

const queued = [...runtimeDependencies]
const visited = new Set()
for (let index = 0; index < queued.length; index += 1) {
  const packageName = queued[index]
  if (visited.has(packageName)) continue
  visited.add(packageName)
  const manifest = workspace.get(packageName)
  if (manifest === undefined) continue

  for (const peer of Object.keys(manifest.peerDependencies ?? {}).sort()) {
    if (!workspace.has(peer) || manifest.peerDependenciesMeta?.[peer]?.optional === true) continue
    if (!runtimeDependencies.has(peer)) runtimeDependencies.add(peer)
    if (!visited.has(peer)) queued.push(peer)
  }
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort()) {
    if (!workspace.has(dependency)) continue
    if (!runtimeDependencies.has(dependency)) runtimeDependencies.add(dependency)
    if (!visited.has(dependency)) queued.push(dependency)
  }
}

const output = `${JSON.stringify({
  name: '@deepseek-ai/dsh-windows-runtime',
  description: 'Dependency-only deploy root for the self-contained Windows desktop runtime.',
  version: repositoryManifest.version,
  private: true,
  type: 'module',
  files: [],
  dependencies: Object.fromEntries([...runtimeDependencies].sort().map(name => [name, 'workspace:^'])),
}, null, 2)}\n`
const manifestPath = join(runtimeDir, 'package.json')

if (check) {
  if (readFileSync(manifestPath, 'utf8') !== output) {
    console.error('windows/runtime/package.json is stale; run node windows/runtime/generate-manifest.mjs')
    process.exit(1)
  }
  console.log(`windows runtime manifest: ${runtimeDependencies.size} workspace roots are current.`)
} else {
  writeFileSync(manifestPath, output)
  console.log(`windows runtime manifest: wrote ${runtimeDependencies.size} workspace roots.`)
}
