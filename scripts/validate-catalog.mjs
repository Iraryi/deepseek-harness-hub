import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const root = new URL('../', import.meta.url)
const catalogPath = new URL('registry/catalog.json', root)
const exampleDirectory = new URL('examples/setup-package/', root)
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const shaPattern = /^[a-f0-9]{64}$/

function fail(message) {
  throw new Error(message)
}

function assertHttps(value, label) {
  if (typeof value !== 'string' || !value.startsWith('https://')) fail(`${label} must use HTTPS`)
}

function validateManifest(manifest, label) {
  if (manifest.schemaVersion !== 1) fail(`${label}: schemaVersion must be 1`)
  if (!idPattern.test(manifest.id ?? '')) fail(`${label}: invalid id`)
  for (const key of ['name', 'summary', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') fail(`${label}: ${key} is required`)
  }
  if (!['virtual', 'standalone'].includes(manifest.kind)) fail(`${label}: invalid kind`)
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) fail(`${label}: categories are required`)
  assertHttps(manifest.publisher?.url, `${label}: publisher.url`)
  assertHttps(manifest.source?.repository, `${label}: source.repository`)
  if (typeof manifest.source?.ref !== 'string' || manifest.source.ref === '') fail(`${label}: source.ref is required`)
  if (!['schema', 'source', 'install', 'lifecycle'].includes(manifest.trust?.review)) fail(`${label}: invalid trust.review`)
  if (!['verified', 'unsigned', 'unknown'].includes(manifest.trust?.signature)) fail(`${label}: invalid trust.signature`)
  if (!['desktop', 'hub', 'both'].includes(manifest.install?.profile)) fail(`${label}: invalid install.profile`)
  if (manifest.kind === 'standalone' && (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0)) fail(`${label}: standalone Setup requires artifacts`)
  for (const [index, artifact] of (manifest.artifacts ?? []).entries()) {
    assertHttps(artifact.url, `${label}: artifacts[${index}].url`)
    if (artifact.sha256 !== undefined && !shaPattern.test(artifact.sha256)) fail(`${label}: artifacts[${index}].sha256 must be lowercase SHA-256`)
  }
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) fail('registry/catalog.json is not a Registry v1 catalog')
const ids = new Set()
for (const entry of catalog.entries) {
  validateManifest(entry, `catalog:${entry.id ?? '<unknown>'}`)
  if (ids.has(entry.id)) fail(`duplicate catalog id: ${entry.id}`)
  ids.add(entry.id)
}

for (const file of await readdir(exampleDirectory)) {
  if (extname(file) !== '.json') continue
  const path = new URL(`examples/setup-package/${file}`, root)
  validateManifest(JSON.parse(await readFile(path, 'utf8')), `example:${file}`)
}

console.log(`Validated ${catalog.entries.length} catalog entries and ${ids.size > 0 ? 'Setup Registry v1' : 'an empty catalog'}.`)
