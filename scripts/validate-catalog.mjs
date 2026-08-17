import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const root = new URL('../', import.meta.url)
const catalogPath = new URL('registry/catalog.json', root)
const exampleDirectory = new URL('examples/setup-package/', root)
const workspaceExampleDirectory = new URL('examples/setup-workspace/', root)
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

function validateCommandList(value, label) {
  if (!Array.isArray(value) || value.some((command) => typeof command !== 'string' || command.trim() === '')) {
    fail(`${label} must be an array of non-empty commands`)
  }
}

function validateWorkspace(manifest, label) {
  if (manifest.schemaVersion !== 1) fail(`${label}: schemaVersion must be 1`)
  if (!idPattern.test(manifest.id ?? '')) fail(`${label}: invalid id`)
  for (const key of ['name', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') fail(`${label}: ${key} is required`)
  }
  assertHttps(manifest.publisher?.url, `${label}: publisher.url`)
  if (!['git', 'zip', 'local', 'generated'].includes(manifest.source?.kind)) fail(`${label}: invalid source.kind`)
  if (manifest.source.kind === 'git') {
    assertHttps(manifest.source.repository, `${label}: source.repository`)
    if (typeof manifest.source.ref !== 'string' || manifest.source.ref.trim() === '') fail(`${label}: git source.ref is required`)
  }
  if (manifest.source.kind === 'zip') {
    assertHttps(manifest.source.url, `${label}: source.url`)
    if (!shaPattern.test(manifest.source.sha256 ?? '')) fail(`${label}: zip source.sha256 must be lowercase SHA-256`)
  }
  if (manifest.source.kind === 'local' && (typeof manifest.source.path !== 'string' || manifest.source.path.trim() === '')) {
    fail(`${label}: local source.path is required`)
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0 || manifest.targets.some((target) => !['desktop', 'hub'].includes(target))) {
    fail(`${label}: targets must contain desktop and/or hub`)
  }
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) fail(`${label}: components are required`)
  const componentIds = new Set()
  for (const component of manifest.components) {
    if (!idPattern.test(component.id ?? '')) fail(`${label}: invalid component id`)
    if (componentIds.has(component.id)) fail(`${label}: duplicate component id ${component.id}`)
    componentIds.add(component.id)
    if (!['desktop', 'hub', 'both'].includes(component.scope)) fail(`${label}: invalid component scope`)
    if (typeof component.defaultEnabled !== 'boolean') fail(`${label}: component.defaultEnabled is required`)
    for (const option of component.options ?? []) {
      if (!idPattern.test(option.id ?? '')) fail(`${label}: invalid component option id`)
      if (!['boolean', 'string', 'number', 'choice', 'path'].includes(option.type)) fail(`${label}: invalid component option type`)
      if (option.type === 'choice' && (!Array.isArray(option.choices) || option.choices.length === 0)) fail(`${label}: choice options require choices`)
    }
  }
  for (const hook of ['preflight', 'install', 'verify', 'uninstall']) {
    validateCommandList(manifest.hooks?.[hook], `${label}: hooks.${hook}`)
  }
  if (typeof manifest.receipts?.root !== 'string' || manifest.receipts.root.trim() === '') fail(`${label}: receipts.root is required`)
  if (typeof manifest.receipts?.rollback !== 'string' || manifest.receipts.rollback.trim() === '') fail(`${label}: receipts.rollback is required`)
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

let workspaceCount = 0
for (const file of await readdir(workspaceExampleDirectory)) {
  if (extname(file) !== '.json') continue
  const path = new URL(`examples/setup-workspace/${file}`, root)
  validateWorkspace(JSON.parse(await readFile(path, 'utf8')), `workspace-example:${file}`)
  workspaceCount += 1
}

console.log(`Validated ${catalog.entries.length} catalog entries, ${workspaceCount} Setup Workspace example(s), and ${ids.size > 0 ? 'Setup Registry v1' : 'an empty catalog'}.`)
