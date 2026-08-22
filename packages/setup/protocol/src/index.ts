/**
 * Canonical Setup evidence and trust rules shared by HUB, the Setup library,
 * and command-line validation.
 *
 * @module @deepseek-ai/dsh-setup-protocol
 */

import type {
  SetupArtifact,
  SetupIssue,
  SetupListing,
  SetupManifest,
  SetupSort,
  SetupTrust,
} from './types.ts'

export * from './types.ts'

/** The only manifest version currently accepted by the HUB. */
export const SETUP_MANIFEST_SCHEMA_VERSION = 1 as const

/** Error thrown when a durable Setup manifest cannot be trusted as structured data. */
export class SetupManifestError extends Error {
  /** Structured validation problems with stable manifest field paths. */
  readonly issues: readonly SetupIssue[]

  constructor(issues: readonly SetupIssue[]) {
    super(`invalid Setup manifest: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`)
    this.name = 'SetupManifestError'
    this.issues = issues
  }
}

/**
 * Parse and validate untrusted JSON before the manifest reaches an installer.
 * @param value - decoded JSON from a registry, GitHub release, or local file.
 * @returns a structurally validated manifest.
 * @throws SetupManifestError when any required field is missing or inconsistent.
 */
export function parseSetupManifest(value: unknown): SetupManifest {
  const issues = validateSetupManifest(value)
  if (issues.length > 0) throw new SetupManifestError(issues)
  return value as SetupManifest
}

/**
 * Validate a Setup manifest without making an installation decision.
 * @param value - decoded JSON from an untrusted source.
 * @returns all validation problems, in stable path order.
 */
export function validateSetupManifest(value: unknown): readonly SetupIssue[] {
  const issues: SetupIssue[] = []
  const record = asRecord(value, '$', issues)
  if (record === undefined) return issues

  rejectUnknownKeys(record, ['schemaVersion', 'id', 'name', 'description', 'version', 'kind', 'categories', 'tags', 'source', 'compatibility', 'license', 'signature', 'audit', 'artifacts', 'install', 'permissions', 'network'], '$', issues)
  requiredLiteral(record, 'schemaVersion', SETUP_MANIFEST_SCHEMA_VERSION, issues)
  requiredString(record, 'id', issues)
  requiredText(record, 'name', issues)
  requiredText(record, 'description', issues)
  requiredString(record, 'version', issues)
  requiredOneOf(record, 'kind', ['virtual', 'executable'], issues)
  requiredStringArray(record, 'categories', issues, '$.categories', 1, true)
  requiredStringArray(record, 'tags', issues, '$.tags', 0, true)
  validateSource(record.source, issues)
  validateCompatibility(record.compatibility, issues)
  validateLicense(record.license, issues)
  validateSignature(record.signature, issues)
  validateAudit(record.audit, issues)
  const artifacts = validateArtifacts(record.artifacts, issues)
  const install = validateInstall(record.install, issues)
  requiredStringArray(record, 'permissions', issues)
  requiredStringArray(record, 'network', issues)

  if (record.kind === 'virtual' && install?.mode === 'executable') {
    issues.push({ path: '$.install.mode', message: 'virtual Setup entries must use profile installation' })
  }
  if (record.kind === 'executable' && install?.mode === 'profile') {
    issues.push({ path: '$.install.mode', message: 'executable Setup entries must use executable installation' })
  }
  if (install?.mode === 'executable' && artifacts !== undefined && !artifacts.some(artifact => artifact.id === install.artifactId)) {
    issues.push({ path: '$.install.artifactId', message: 'must refer to an artifact in $.artifacts' })
  }
  if (install?.mode === 'profile' && install.source === 'package' && artifacts !== undefined) {
    const artifact = artifacts.find(candidate => candidate.id === install.artifactId)
    if (artifact === undefined) issues.push({ path: '$.install.artifactId', message: 'must refer to an artifact in $.artifacts' })
    else if (artifact.kind !== 'package' && artifact.kind !== 'archive') issues.push({ path: '$.install.artifactId', message: 'must refer to a package or archive artifact' })
  }
  return issues
}

/**
 * Derive the user-facing trust tier from evidence, never from a maintainer's
 * claimed badge alone.
 * @param manifest - validated Setup manifest.
 * @returns the trust tier HUB should display.
 */
export function classifySetupTrust(manifest: SetupManifest): SetupTrust {
  if (
    manifest.audit.status === 'certified'
    && manifest.signature.status === 'valid'
    && manifest.license.redistributable
    && manifest.source.commit !== undefined
    && manifest.artifacts.every(artifact => artifact.kind === 'in-box' || isSha256(artifact.sha256))
  ) return 'certified'
  if (isGitHubUrl(manifest.source.repository)) return 'github-source'
  return 'unverified'
}

/**
 * Return a localized title without exposing raw manifest objects to UI code.
 * @param text - localized or plain display text.
 * @param language - preferred UI language.
 * @returns the best available title.
 */
export function resolveSetupText(text: SetupManifest['name'], language: 'zh' | 'en'): string {
  if (typeof text === 'string') return text
  return text[language] ?? text.default
}

/**
 * Sort catalog entries with trust first for the default view and deterministic
 * tie-breaking for every mode.
 * @param listings - catalog entries to sort.
 * @param mode - ranking requested by the HUB.
 * @returns a new sorted array; the input remains unchanged.
 */
export function sortSetupListings(listings: readonly SetupListing[], mode: SetupSort): SetupListing[] {
  const trustWeight: Record<SetupTrust, number> = { certified: 3, 'github-source': 2, unverified: 1 }
  return [...listings].sort((left, right) => {
    const leftTrust = trustWeight[classifySetupTrust(left.manifest)]
    const rightTrust = trustWeight[classifySetupTrust(right.manifest)]
    if (mode === 'recommended' && leftTrust !== rightTrust) return rightTrust - leftTrust
    if (mode === 'stars' && left.metrics.stars !== right.metrics.stars) return (right.metrics.stars ?? -1) - (left.metrics.stars ?? -1)
    if (mode === 'installs' && left.metrics.installs !== right.metrics.installs) return (right.metrics.installs ?? -1) - (left.metrics.installs ?? -1)
    if (mode === 'updated' && left.metrics.updatedAt !== right.metrics.updatedAt) return compareDates(right.metrics.updatedAt, left.metrics.updatedAt)
    if (mode === 'recommended') {
      const leftInstalls = left.metrics.installs ?? 0
      const rightInstalls = right.metrics.installs ?? 0
      if (leftInstalls !== rightInstalls) return rightInstalls - leftInstalls
    }
    return left.manifest.id.localeCompare(right.manifest.id)
  })
}

/**
 * Verify a downloaded artifact's SHA-256 digest.
 * @param bytes - downloaded artifact bytes.
 * @param expected - lowercase or uppercase hexadecimal SHA-256 digest.
 * @returns true when the digest matches.
 */
export async function verifySetupArtifact(bytes: Uint8Array, expected: string): Promise<boolean> {
  if (!isSha256(expected)) return false
  const digest = await cryptoDigest(bytes)
  return digest.toLowerCase() === expected.toLowerCase()
}

function asRecord(value: unknown, path: string, issues: SetupIssue[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path, message: 'must be an object' })
    return undefined
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string, issues: SetupIssue[]): void {
  requiredStringAt(record, key, `$.${key}`, issues)
}

function requiredStringAt(record: Record<string, unknown>, key: string, path: string, issues: SetupIssue[]): void {
  if (typeof record[key] !== 'string' || record[key].trim().length === 0) issues.push({ path, message: 'must be a non-empty string' })
}

function requiredText(record: Record<string, unknown>, key: string, issues: SetupIssue[]): void {
  const value = record[key]
  if (typeof value === 'string' && value.trim().length > 0) return
  const nested = asRecord(value, `$.${key}`, issues)
  if (nested === undefined) return
  rejectUnknownKeys(nested, ['default', 'zh', 'en'], `$.${key}`, issues)
  requiredStringAt(nested, 'default', `$.${key}.default`, issues)
  for (const language of ['zh', 'en']) {
    if (nested[language] !== undefined && (typeof nested[language] !== 'string' || nested[language].trim().length === 0)) {
      issues.push({ path: `$.${key}.${language}`, message: 'must be a non-empty string when present' })
    }
  }
}

function requiredLiteral(record: Record<string, unknown>, key: string, expected: unknown, issues: SetupIssue[]): void {
  if (record[key] !== expected) issues.push({ path: `$.${key}`, message: `must equal ${JSON.stringify(expected)}` })
}

function requiredOneOf(record: Record<string, unknown>, key: string, expected: readonly string[], issues: SetupIssue[], path = `$.${key}`): void {
  if (typeof record[key] !== 'string' || !expected.includes(record[key])) issues.push({ path, message: `must be one of ${expected.join(', ')}` })
}

function requiredStringArray(record: Record<string, unknown>, key: string, issues: SetupIssue[], path = `$.${key}`, minimum = 0, unique = false): readonly string[] | undefined {
  const value = record[key]
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || item.trim().length === 0) || (unique && new Set(value).size !== value.length)) {
    issues.push({ path, message: 'must be an array of non-empty strings' })
    return undefined
  }
  return value as readonly string[]
}

function requiredEnumStringArray(record: Record<string, unknown>, key: string, expected: readonly string[], issues: SetupIssue[], path = `$.${key}`, minimum = 0, unique = false): void {
  const value = requiredStringArray(record, key, issues, path, minimum, unique)
  if (value !== undefined && value.some(item => !expected.includes(item))) issues.push({ path, message: `must contain only ${expected.join(', ')}` })
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, issues: SetupIssue[]): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!accepted.has(key)) issues.push({ path: `${path}.${key}`, message: 'is not allowed by Setup Registry v1' })
  }
}

function validateSource(value: unknown, issues: SetupIssue[]): void {
  const record = asRecord(value, '$.source', issues)
  if (record === undefined) return
  rejectUnknownKeys(record, ['repository', 'ref', 'commit', 'release'], '$.source', issues)
  requiredUrl(record, 'repository', issues, '$.source.repository')
  requiredStringAt(record, 'ref', '$.source.ref', issues)
  if (record.commit !== undefined && (typeof record.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(record.commit))) issues.push({ path: '$.source.commit', message: 'must be a 40-character commit hash when present' })
  if (record.release !== undefined && (typeof record.release !== 'string' || record.release.trim().length === 0)) issues.push({ path: '$.source.release', message: 'must be a non-empty string when present' })
}

function validateCompatibility(value: unknown, issues: SetupIssue[]): void {
  const record = asRecord(value, '$.compatibility', issues)
  if (record === undefined) return
  rejectUnknownKeys(record, ['dsh', 'surfaces', 'node', 'platforms'], '$.compatibility', issues)
  requiredStringAt(record, 'dsh', '$.compatibility.dsh', issues)
  requiredEnumStringArray(record, 'surfaces', ['cli', 'web', 'desktop'], issues, '$.compatibility.surfaces', 1, true)
  if (record.node !== undefined && (typeof record.node !== 'string' || record.node.trim().length === 0)) issues.push({ path: '$.compatibility.node', message: 'must be a non-empty string when present' })
  if (record.platforms !== undefined) requiredEnumStringArray(record, 'platforms', ['windows-x64', 'windows-arm64', 'any'], issues, '$.compatibility.platforms', 1, true)
}

function validateLicense(value: unknown, issues: SetupIssue[]): void {
  const record = asRecord(value, '$.license', issues)
  if (record === undefined) return
  rejectUnknownKeys(record, ['identifier', 'name', 'url', 'notice', 'redistributable'], '$.license', issues)
  requiredStringAt(record, 'identifier', '$.license.identifier', issues)
  requiredStringAt(record, 'name', '$.license.name', issues)
  if (typeof record.redistributable !== 'boolean') issues.push({ path: '$.license.redistributable', message: 'must be a boolean' })
  if (record.url !== undefined) requiredUrl(record, 'url', issues, '$.license.url')
  if (record.notice !== undefined && typeof record.notice !== 'string') issues.push({ path: '$.license.notice', message: 'must be a string when present' })
}

function validateSignature(value: unknown, issues: SetupIssue[]): void {
  const record = asRecord(value, '$.signature', issues)
  if (record === undefined) return
  rejectUnknownKeys(record, ['status', 'type', 'signer', 'issuer', 'thumbprint', 'timestamp'], '$.signature', issues)
  requiredOneOf(record, 'status', ['valid', 'invalid', 'unsigned', 'unknown'], issues, '$.signature.status')
  if (record.type !== undefined) requiredOneOf(record, 'type', ['authenticode', 'sigstore', 'minisign', 'other'], issues, '$.signature.type')
  for (const key of ['signer', 'issuer', 'thumbprint', 'timestamp']) if (record[key] !== undefined && typeof record[key] !== 'string') issues.push({ path: `$.signature.${key}`, message: 'must be a string when present' })
}

function validateAudit(value: unknown, issues: SetupIssue[]): void {
  const record = asRecord(value, '$.audit', issues)
  if (record === undefined) return
  rejectUnknownKeys(record, ['status', 'auditor', 'checkedAt', 'report', 'checks'], '$.audit', issues)
  requiredOneOf(record, 'status', ['certified', 'reviewed', 'unreviewed', 'rejected'], issues, '$.audit.status')
  requiredStringArray(record, 'checks', issues, '$.audit.checks')
  for (const key of ['auditor', 'report']) if (record[key] !== undefined && typeof record[key] !== 'string') issues.push({ path: `$.audit.${key}`, message: 'must be a string when present' })
  if (record.checkedAt !== undefined && (typeof record.checkedAt !== 'string' || !isIsoDateTime(record.checkedAt))) issues.push({ path: '$.audit.checkedAt', message: 'must be an ISO date-time string when present' })
}

function validateArtifacts(value: unknown, issues: SetupIssue[]): SetupArtifact[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: '$.artifacts', message: 'must be a non-empty array' })
    return undefined
  }
  const artifacts: SetupArtifact[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const record = asRecord(item, `$.artifacts[${index}]`, issues)
    if (record === undefined) return
    requiredStringAt(record, 'id', `$.artifacts[${index}].id`, issues)
    if (typeof record.id === 'string' && ids.has(record.id)) issues.push({ path: `$.artifacts[${index}].id`, message: 'must be unique within $.artifacts' })
    if (typeof record.id === 'string') ids.add(record.id)
    requiredOneOf(record, 'kind', ['in-box', 'package', 'archive', 'installer'], issues, `$.artifacts[${index}].kind`)
    if (record.kind === 'in-box') {
      rejectUnknownKeys(record, ['id', 'kind', 'component', 'platform'], `$.artifacts[${index}]`, issues)
      requiredStringAt(record, 'component', `$.artifacts[${index}].component`, issues)
    } else {
      rejectUnknownKeys(record, ['id', 'kind', 'url', 'sha256', 'fileName', 'bytes', 'platform', 'executable'], `$.artifacts[${index}]`, issues)
      requiredUrl(record, 'url', issues, `$.artifacts[${index}].url`)
      requiredStringAt(record, 'sha256', `$.artifacts[${index}].sha256`, issues)
      if (typeof record.sha256 === 'string' && !isSha256(record.sha256)) issues.push({ path: `$.artifacts[${index}].sha256`, message: 'must be a SHA-256 hexadecimal digest' })
      if (record.fileName !== undefined && (typeof record.fileName !== 'string' || !isSafeFileName(record.fileName))) issues.push({ path: `$.artifacts[${index}].fileName`, message: 'must be a safe basename when present' })
    }
    if (record.bytes !== undefined && (typeof record.bytes !== 'number' || !Number.isSafeInteger(record.bytes) || record.bytes < 0)) issues.push({ path: `$.artifacts[${index}].bytes`, message: 'must be a non-negative safe integer when present' })
    if (record.platform !== undefined) requiredOneOf(record, 'platform', ['windows-x64', 'windows-arm64', 'any'], issues, `$.artifacts[${index}].platform`)
    if (record.executable !== undefined && typeof record.executable !== 'boolean') issues.push({ path: `$.artifacts[${index}].executable`, message: 'must be a boolean when present' })
    artifacts.push(record as unknown as SetupArtifact)
  })
  return artifacts
}

function validateInstall(value: unknown, issues: SetupIssue[]): SetupManifest['install'] | undefined {
  const record = asRecord(value, '$.install', issues)
  if (record === undefined) return undefined
  rejectUnknownKeys(record, ['mode', 'source', 'artifactId', 'bundle', 'profile', 'silentArgs'], '$.install', issues)
  requiredOneOf(record, 'mode', ['profile', 'executable'], issues, '$.install.mode')
  if (record.mode === 'profile') {
    requiredOneOf(record, 'source', ['package', 'in-box'], issues, '$.install.source')
    if (record.source === 'package') requiredStringAt(record, 'artifactId', '$.install.artifactId', issues)
    if (record.source === 'in-box') requiredStringAt(record, 'bundle', '$.install.bundle', issues)
    if (record.profile !== undefined && (typeof record.profile !== 'string' || record.profile.trim().length === 0)) issues.push({ path: '$.install.profile', message: 'must be a non-empty string when present' })
  } else if (record.mode === 'executable') {
    requiredStringAt(record, 'artifactId', '$.install.artifactId', issues)
    if (record.silentArgs !== undefined) requiredStringArray(record, 'silentArgs', issues, '$.install.silentArgs')
  }
  return record as unknown as SetupManifest['install']
}

function requiredUrl(record: Record<string, unknown>, key: string, issues: SetupIssue[], path = `$.${key}`): void {
  if (typeof record[key] !== 'string') {
    issues.push({ path, message: 'must be an https URL' })
    return
  }
  try {
    const url = new URL(record[key])
    if (url.protocol !== 'https:') issues.push({ path, message: 'must use https' })
  } catch {
    issues.push({ path, message: 'must be an https URL' })
  }
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

function isSafeFileName(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !/[<>:"/\\|?*\u0000-\u001f]/.test(value)
}

function isGitHubUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'github.com'
  } catch {
    return false
  }
}

function compareDates(left: string | undefined, right: string | undefined): number {
  const leftTime = left === undefined ? Number.NEGATIVE_INFINITY : Date.parse(left)
  const rightTime = right === undefined ? Number.NEGATIVE_INFINITY : Date.parse(right)
  return (Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime) - (Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime)
}

async function cryptoDigest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto.subtle
  const owned = Uint8Array.from(bytes)
  const digest = await subtle.digest('SHA-256', owned.buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
