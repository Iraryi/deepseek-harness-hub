import { readFile, readdir } from 'node:fs/promises'
import { extname } from 'node:path'

const root = new URL('../', import.meta.url)
const catalogPath = new URL('registry/catalog.json', root)
const webCatalogPath = new URL('apps/web/public/setup/registry.json', root)
const exampleDirectory = new URL('examples/setup-package/', root)
const workspaceExampleDirectory = new URL('examples/setup-workspace/', root)
const shaPattern = /^[0-9a-fA-F]{64}$/
const commitPattern = /^[0-9a-fA-F]{40}$/
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const surfaces = new Set(['cli', 'web', 'desktop'])
const platforms = new Set(['windows-x64', 'windows-arm64', 'any'])
const artifactKinds = new Set(['package', 'archive', 'installer'])
const signatureStatuses = new Set(['valid', 'invalid', 'unsigned', 'unknown'])
const auditStatuses = new Set(['certified', 'reviewed', 'unreviewed', 'rejected'])

function fail(message) {
  throw new Error(message)
}

function assertHttps(value, label) {
  if (typeof value !== 'string' || !value.startsWith('https://')) fail(label + ' must use HTTPS')
}

function assertDate(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(label + ' must be an ISO date string')
}

function assertKeys(value, allowed, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object')
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(label + '.' + key + ' is not part of Setup Registry v1')
}

function assertStringArray(value, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    fail(label + ' must be an array of non-empty strings')
  }
}

function assertLocalizedText(value, label) {
  if (typeof value === 'string') {
    if (value.trim() === '') fail(label + ' must not be empty')
    return
  }
  assertKeys(value, new Set(['default', 'zh', 'en']), label)
  if (typeof value.default !== 'string' || value.default.trim() === '') fail(label + '.default is required')
  for (const language of ['zh', 'en']) {
    if (value[language] !== undefined && (typeof value[language] !== 'string' || value[language].trim() === '')) {
      fail(label + '.' + language + ' must be non-empty when present')
    }
  }
}

function validateArtifact(artifact, label) {
  assertKeys(artifact, new Set(['id', 'kind', 'component', 'platform', 'url', 'sha256', 'fileName', 'bytes', 'executable']), label)
  if (typeof artifact.id !== 'string' || artifact.id.trim() === '') fail(label + '.id is required')
  if (artifact.kind === 'in-box') {
    if (typeof artifact.component !== 'string' || artifact.component.trim() === '') fail(label + '.component is required')
  } else {
    if (!artifactKinds.has(artifact.kind)) fail(label + '.kind is invalid')
    assertHttps(artifact.url, label + '.url')
    if (!shaPattern.test(artifact.sha256 ?? '')) fail(label + '.sha256 must be a hexadecimal SHA-256')
    if (artifact.fileName !== undefined && (typeof artifact.fileName !== 'string' || artifact.fileName.trim() === '' || /[<>:"/\\|?*\u0000-\u001f]/.test(artifact.fileName))) {
      fail(label + '.fileName must be a safe basename')
    }
    if (artifact.bytes !== undefined && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)) fail(label + '.bytes must be a non-negative safe integer')
    if (artifact.executable !== undefined && typeof artifact.executable !== 'boolean') fail(label + '.executable must be boolean')
  }
  if (artifact.platform !== undefined && !platforms.has(artifact.platform)) fail(label + '.platform is invalid')
}

function validateManifest(manifest, label) {
  assertKeys(manifest, new Set(['schemaVersion', 'id', 'name', 'description', 'version', 'kind', 'categories', 'tags', 'source', 'compatibility', 'license', 'signature', 'audit', 'artifacts', 'install', 'permissions', 'network']), label)
  if (manifest.schemaVersion !== 1) fail(label + '.schemaVersion must be 1')
  if (!idPattern.test(manifest.id ?? '')) fail(label + '.id is invalid')
  assertLocalizedText(manifest.name, label + '.name')
  assertLocalizedText(manifest.description, label + '.description')
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') fail(label + '.version is required')
  if (!['virtual', 'executable'].includes(manifest.kind)) fail(label + '.kind is invalid')
  assertStringArray(manifest.categories, label + '.categories', 1)
  assertStringArray(manifest.tags, label + '.tags')
  assertKeys(manifest.source, new Set(['repository', 'ref', 'commit', 'release']), label + '.source')
  assertHttps(manifest.source?.repository, label + '.source.repository')
  if (typeof manifest.source?.ref !== 'string' || manifest.source.ref.trim() === '') fail(label + '.source.ref is required')
  if (manifest.source.commit !== undefined && !commitPattern.test(manifest.source.commit)) fail(label + '.source.commit must be a 40-character commit hash')
  if (manifest.source.release !== undefined && typeof manifest.source.release !== 'string') fail(label + '.source.release must be a string')
  assertKeys(manifest.compatibility, new Set(['dsh', 'surfaces', 'node', 'platforms']), label + '.compatibility')
  if (typeof manifest.compatibility?.dsh !== 'string' || manifest.compatibility.dsh.trim() === '') fail(label + '.compatibility.dsh is required')
  assertStringArray(manifest.compatibility?.surfaces, label + '.compatibility.surfaces', 1)
  if (manifest.compatibility.surfaces.some(surface => !surfaces.has(surface))) fail(label + '.compatibility.surfaces contains an invalid surface')
  if (manifest.compatibility.node !== undefined && typeof manifest.compatibility.node !== 'string') fail(label + '.compatibility.node must be a string')
  if (manifest.compatibility.platforms !== undefined) {
    assertStringArray(manifest.compatibility.platforms, label + '.compatibility.platforms', 1)
    if (manifest.compatibility.platforms.some(platform => !platforms.has(platform))) fail(label + '.compatibility.platforms contains an invalid platform')
  }
  assertKeys(manifest.license, new Set(['identifier', 'name', 'url', 'notice', 'redistributable']), label + '.license')
  for (const key of ['identifier', 'name']) if (typeof manifest.license?.[key] !== 'string' || manifest.license[key].trim() === '') fail(label + '.license.' + key + ' is required')
  if (manifest.license.url !== undefined) assertHttps(manifest.license.url, label + '.license.url')
  if (manifest.license.notice !== undefined && typeof manifest.license.notice !== 'string') fail(label + '.license.notice must be a string')
  if (typeof manifest.license.redistributable !== 'boolean') fail(label + '.license.redistributable must be boolean')
  assertKeys(manifest.signature, new Set(['status', 'type', 'signer', 'issuer', 'thumbprint', 'timestamp']), label + '.signature')
  if (!signatureStatuses.has(manifest.signature?.status)) fail(label + '.signature.status is invalid')
  if (manifest.signature.type !== undefined && !['authenticode', 'sigstore', 'minisign', 'other'].includes(manifest.signature.type)) fail(label + '.signature.type is invalid')
  for (const key of ['signer', 'issuer', 'thumbprint', 'timestamp']) if (manifest.signature[key] !== undefined && typeof manifest.signature[key] !== 'string') fail(label + '.signature.' + key + ' must be a string')
  assertKeys(manifest.audit, new Set(['status', 'auditor', 'checkedAt', 'report', 'checks']), label + '.audit')
  if (!auditStatuses.has(manifest.audit?.status)) fail(label + '.audit.status is invalid')
  assertStringArray(manifest.audit?.checks, label + '.audit.checks')
  for (const key of ['auditor', 'checkedAt', 'report']) if (manifest.audit[key] !== undefined && typeof manifest.audit[key] !== 'string') fail(label + '.audit.' + key + ' must be a string')
  if (manifest.audit.checkedAt !== undefined) assertDate(manifest.audit.checkedAt, label + '.audit.checkedAt')
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) fail(label + '.artifacts must not be empty')
  const artifactIds = new Set()
  for (const [index, artifact] of manifest.artifacts.entries()) {
    validateArtifact(artifact, label + '.artifacts[' + index + ']')
    if (artifactIds.has(artifact.id)) fail(label + ': duplicate artifact id ' + artifact.id)
    artifactIds.add(artifact.id)
  }
  assertKeys(manifest.install, new Set(['mode', 'source', 'artifactId', 'bundle', 'profile', 'silentArgs']), label + '.install')
  if (manifest.kind === 'virtual' && manifest.install.mode !== 'profile') fail(label + ': virtual Setup must use profile installation')
  if (manifest.kind === 'executable' && manifest.install.mode !== 'executable') fail(label + ': executable Setup must use executable installation')
  if (manifest.install.mode === 'profile' && manifest.install.source === 'package') {
    if (typeof manifest.install.artifactId !== 'string' || !artifactIds.has(manifest.install.artifactId)) fail(label + '.install.artifactId must refer to an artifact')
    const artifact = manifest.artifacts.find(candidate => candidate.id === manifest.install.artifactId)
    if (!['package', 'archive'].includes(artifact.kind)) fail(label + '.install.artifactId must refer to a package or archive')
  } else if (manifest.install.mode === 'profile' && manifest.install.source === 'in-box') {
    if (typeof manifest.install.bundle !== 'string' || manifest.install.bundle.trim() === '') fail(label + '.install.bundle is required')
  } else if (manifest.install.mode === 'executable') {
    if (typeof manifest.install.artifactId !== 'string' || !artifactIds.has(manifest.install.artifactId)) fail(label + '.install.artifactId must refer to an artifact')
    const artifact = manifest.artifacts.find(candidate => candidate.id === manifest.install.artifactId)
    if (artifact.kind === 'in-box') fail(label + '.install.artifactId cannot refer to an in-box artifact')
    if (manifest.install.silentArgs !== undefined) assertStringArray(manifest.install.silentArgs, label + '.install.silentArgs')
  } else {
    fail(label + '.install is invalid')
  }
  if (manifest.install.profile !== undefined && (typeof manifest.install.profile !== 'string' || manifest.install.profile.trim() === '')) fail(label + '.install.profile must be non-empty')
  assertStringArray(manifest.permissions, label + '.permissions')
  assertStringArray(manifest.network, label + '.network')
}

function validateMetrics(metrics, label) {
  assertKeys(metrics, new Set(['stars', 'installs', 'updatedAt']), label)
  for (const key of ['stars', 'installs']) if (metrics[key] !== undefined && (!Number.isSafeInteger(metrics[key]) || metrics[key] < 0)) fail(label + '.' + key + ' must be a non-negative safe integer')
  if (metrics.updatedAt !== undefined) assertDate(metrics.updatedAt, label + '.updatedAt')
}

function validateRegistry(registry, label) {
  assertKeys(registry, new Set(['schemaVersion', 'generatedAt', 'source', 'entries']), label)
  if (registry.schemaVersion !== 1) fail(label + '.schemaVersion must be 1')
  assertDate(registry.generatedAt, label + '.generatedAt')
  assertHttps(registry.source, label + '.source')
  if (!Array.isArray(registry.entries)) fail(label + '.entries must be an array')
  const ids = new Set()
  for (const [index, entry] of registry.entries.entries()) {
    assertKeys(entry, new Set(['manifest', 'metrics']), label + '.entries[' + index + ']')
    validateManifest(entry.manifest, label + '.entries[' + index + '].manifest')
    validateMetrics(entry.metrics, label + '.entries[' + index + '].metrics')
    if (ids.has(entry.manifest.id)) fail(label + ': duplicate manifest id ' + entry.manifest.id)
    ids.add(entry.manifest.id)
  }
  return ids
}

function validateCommandList(value, label) {
  if (!Array.isArray(value) || value.some(command => typeof command !== 'string' || command.trim() === '')) {
    fail(label + ' must be an array of non-empty commands')
  }
}

function validateWorkspace(manifest, label) {
  if (manifest.schemaVersion !== 1) fail(label + ': schemaVersion must be 1')
  if (!idPattern.test(manifest.id ?? '')) fail(label + ': invalid id')
  for (const key of ['name', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') fail(label + ': ' + key + ' is required')
  }
  assertHttps(manifest.publisher?.url, label + ': publisher.url')
  if (!['git', 'zip', 'local', 'generated'].includes(manifest.source?.kind)) fail(label + ': invalid source.kind')
  if (manifest.source.kind === 'git') {
    assertHttps(manifest.source.repository, label + ': source.repository')
    if (typeof manifest.source.ref !== 'string' || manifest.source.ref.trim() === '') fail(label + ': git source.ref is required')
  }
  if (manifest.source.kind === 'zip') {
    assertHttps(manifest.source.url, label + ': source.url')
    if (!shaPattern.test(manifest.source.sha256 ?? '')) fail(label + ': zip source.sha256 must be hexadecimal SHA-256')
  }
  if (manifest.source.kind === 'local' && (typeof manifest.source.path !== 'string' || manifest.source.path.trim() === '')) {
    fail(label + ': local source.path is required')
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0 || manifest.targets.some(target => !['desktop', 'hub'].includes(target))) {
    fail(label + ': targets must contain desktop and/or hub')
  }
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) fail(label + ': components are required')
  const componentIds = new Set()
  for (const component of manifest.components) {
    if (!idPattern.test(component.id ?? '')) fail(label + ': invalid component id')
    if (componentIds.has(component.id)) fail(label + ': duplicate component id ' + component.id)
    componentIds.add(component.id)
    if (!['desktop', 'hub', 'both'].includes(component.scope)) fail(label + ': invalid component scope')
    if (typeof component.defaultEnabled !== 'boolean') fail(label + ': component.defaultEnabled is required')
    for (const option of component.options ?? []) {
      if (!idPattern.test(option.id ?? '')) fail(label + ': invalid component option id')
      if (!['boolean', 'string', 'number', 'choice', 'path'].includes(option.type)) fail(label + ': invalid component option type')
      if (option.type === 'choice' && (!Array.isArray(option.choices) || option.choices.length === 0)) fail(label + ': choice options require choices')
    }
  }
  for (const hook of ['preflight', 'install', 'verify', 'uninstall']) validateCommandList(manifest.hooks?.[hook], label + ': hooks.' + hook)
  if (typeof manifest.receipts?.root !== 'string' || manifest.receipts.root.trim() === '') fail(label + ': receipts.root is required')
  if (typeof manifest.receipts?.rollback !== 'string' || manifest.receipts.rollback.trim() === '') fail(label + ': receipts.rollback is required')
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const webCatalog = JSON.parse(await readFile(webCatalogPath, 'utf8'))
const catalogIds = validateRegistry(catalog, 'registry/catalog.json')
const webCatalogIds = validateRegistry(webCatalog, 'apps/web/public/setup/registry.json')
if (JSON.stringify(catalog) !== JSON.stringify(webCatalog)) fail('registry/catalog.json and apps/web/public/setup/registry.json must be identical mirrors')
if (JSON.stringify([...catalogIds]) !== JSON.stringify([...webCatalogIds])) fail('catalog mirrors contain different entry IDs')

for (const file of await readdir(exampleDirectory)) {
  if (extname(file) !== '.json') continue
  const path = new URL('examples/setup-package/' + file, root)
  validateManifest(JSON.parse(await readFile(path, 'utf8')), 'example:' + file)
}

let workspaceCount = 0
for (const file of await readdir(workspaceExampleDirectory)) {
  if (extname(file) !== '.json') continue
  const path = new URL('examples/setup-workspace/' + file, root)
  validateWorkspace(JSON.parse(await readFile(path, 'utf8')), 'workspace-example:' + file)
  workspaceCount += 1
}

console.log('Validated ' + catalog.entries.length + ' Setup Registry v1 entries, ' + workspaceCount + ' Setup Workspace example(s), and identical catalog mirrors.')
