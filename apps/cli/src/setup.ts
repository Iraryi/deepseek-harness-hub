/**
 * HUB-compatible Setup inspection and installation backend.
 *
 * @module @deepseek-ai/dsh/setup
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { classifySetupTrust, parseSetupManifest, resolveSetupText, type SetupManifest, type SetupRemoteArtifact } from '@deepseek-ai/dsh-setup-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { enableInBoxBundle, installSetupPackage } from './plugin.ts'

const SETUP_PROGRESS_PREFIX = 'DSH_SETUP_PROGRESS '

/** Parsed setup invocation owned by the CLI adapter. */
export interface RunSetupOptions {
  readonly action: 'inspect' | 'install'
  readonly manifest: string
  readonly profile?: string
  readonly acceptSource: boolean
  readonly acceptUnverified: boolean
  readonly silent: boolean
  readonly json: boolean
}

/**
 * Inspect or install a Setup manifest.
 * @param options - parsed Setup command options.
 * @returns process exit code.
 */
export async function runSetup(options: RunSetupOptions): Promise<number> {
  try {
    const manifest = await loadSetupManifest(options.manifest)
    if (options.json) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      process.stdout.write(formatSetupEvidence(manifest))
    }
    if (options.action === 'inspect') return 0
    requireAcceptedTrust(manifest, options)
    if (manifest.audit.status === 'rejected') throw new Error('Setup was rejected by its declared audit and cannot be installed')
    const install = manifest.install
    if (install.mode === 'profile') {
      const profile = options.profile ?? install.profile ?? 'web'
      if (install.source === 'in-box') return enableInBoxBundle(profile, install.bundle)
      const artifact = manifest.artifacts.find(candidate => candidate.id === install.artifactId)
      if (artifact === undefined) throw new Error(`Setup artifact ${JSON.stringify(install.artifactId)} is missing`)
      if (artifact.kind !== 'package' && artifact.kind !== 'archive') throw new Error('profile Setup requires a package or archive artifact')
      const packagePath = await downloadSetupArtifact(artifact)
      return installSetupPackage(profile, packagePath, manifest.permissions.includes('install-scripts'))
    }
    if (process.platform !== 'win32') throw new Error('Executable Setup installation is supported only on Windows')
    const artifact = manifest.artifacts.find(candidate => candidate.id === install.artifactId)
    if (artifact === undefined) throw new Error(`Setup artifact ${JSON.stringify(install.artifactId)} is missing`)
    if (artifact.kind === 'in-box') throw new Error('executable Setup cannot target an in-box component artifact')
    const executable = await downloadSetupArtifact(artifact)
    const signature = verifyAuthenticode(executable)
    enforceDeclaredSignature(manifest, signature)
    process.stdout.write(formatAuthenticodeEvidence(signature))
    const args = options.silent ? install.silentArgs : []
    if (options.silent && args === undefined) throw new Error('Setup declares no reviewed silent arguments')
    const result = spawnSync(executable, args ?? [], { stdio: 'inherit', shell: false })
    if (result.error !== undefined) throw result.error
    return result.status ?? 1
  } catch (error) {
    process.stderr.write(`dsh setup: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/**
 * Load a local or HTTPS Setup manifest.
 * @param location - local path or HTTPS URL.
 * @returns validated Setup manifest.
 */
export async function loadSetupManifest(location: string): Promise<SetupManifest> {
  if (/^https?:\/\//i.test(location)) {
    const url = new URL(location)
    if (url.protocol !== 'https:') throw new Error('remote Setup manifests must use HTTPS')
    const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' })
    if (!response.ok) throw new Error(`manifest request failed with HTTP ${response.status}`)
    return parseSetupManifest(await response.json())
  }
  const source = await readFile(location, 'utf8')
  return parseSetupManifest(JSON.parse(source.replace(/^\uFEFF/, '')))
}

/**
 * Render all source, license, signature, audit, permission, and network claims
 * before installation.
 * @param manifest - validated Setup manifest.
 * @returns human-readable evidence view.
 */
export function formatSetupEvidence(manifest: SetupManifest): string {
  const trust = classifySetupTrust(manifest)
  const artifacts = manifest.artifacts.map(artifact => artifact.kind === 'in-box'
    ? `  - ${artifact.id}: in-box component ${artifact.component}`
    : `  - ${artifact.id}: ${artifact.kind}, SHA-256 ${artifact.sha256}`).join('\n')
  return [
    `Setup: ${resolveSetupText(manifest.name, 'zh')} (${manifest.id})`,
    `Version: ${manifest.version}`,
    `Kind: ${manifest.kind}`,
    `Trust: ${trust}`,
    `Source: ${manifest.source.repository}`,
    `Source ref: ${manifest.source.ref}${manifest.source.commit === undefined ? '' : ` @ ${manifest.source.commit}`}`,
    `License: ${manifest.license.identifier} — ${manifest.license.name}`,
    `Redistributable: ${manifest.license.redistributable ? 'yes' : 'no'}`,
    `Declared signature: ${manifest.signature.status}${manifest.signature.signer === undefined ? '' : ` — ${manifest.signature.signer}`}`,
    `Audit: ${manifest.audit.status}${manifest.audit.auditor === undefined ? '' : ` — ${manifest.audit.auditor}`}`,
    `Compatibility: DSH ${manifest.compatibility.dsh}; ${manifest.compatibility.surfaces.join(', ')}`,
    `Permissions: ${manifest.permissions.length === 0 ? 'none declared' : manifest.permissions.join(', ')}`,
    `Network: ${manifest.network.length === 0 ? 'none declared' : manifest.network.join(', ')}`,
    'Artifacts:',
    artifacts,
    '',
  ].join('\n')
}

function requireAcceptedTrust(manifest: SetupManifest, options: RunSetupOptions): void {
  const trust = classifySetupTrust(manifest)
  if (trust === 'certified') return
  if (trust === 'github-source' && options.acceptSource) return
  if (trust === 'unverified' && options.acceptUnverified) return
  const flag = trust === 'github-source' ? '--accept-source' : '--accept-unverified'
  throw new Error(`${trust} Setup requires explicit ${flag} confirmation`)
}

async function downloadSetupArtifact(artifact: SetupRemoteArtifact): Promise<string> {
  const url = new URL(artifact.url)
  if (url.protocol !== 'https:') throw new Error('Setup artifacts must use HTTPS')
  const fileName = safeFileName(artifact.fileName ?? decodeURIComponent(url.pathname))
  const directory = dshHomePath('setup-cache', 'artifacts', artifact.sha256.toLowerCase())
  const destination = join(directory, fileName)
  await mkdir(directory, { recursive: true })
  if (await exists(destination)) {
    if (await hashFile(destination) === artifact.sha256.toLowerCase()) {
      const cached = await stat(destination)
      emitSetupDownloadProgress(fileName, cached.size, artifact.bytes ?? cached.size, true)
      return destination
    }
    await rm(destination, { force: true })
  }
  const partial = `${destination}.${process.pid}.part`
  await rm(partial, { force: true })
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok || response.body === null) throw new Error(`artifact request failed with HTTP ${response.status}`)
  const headerBytes = parseDownloadBytes(response.headers.get('content-length'))
  const totalBytes = headerBytes ?? artifact.bytes ?? 0
  let downloadedBytes = 0
  let lastReportAt = 0
  let nextReportBytes = 0
  emitSetupDownloadProgress(fileName, 0, totalBytes, false)
  const hash = createHash('sha256')
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      downloadedBytes += chunk.length
      const now = Date.now()
      if (downloadedBytes >= nextReportBytes || now - lastReportAt >= 125) {
        emitSetupDownloadProgress(fileName, downloadedBytes, totalBytes, false)
        nextReportBytes = downloadedBytes + 256 * 1024
        lastReportAt = now
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(response.body, meter, createWriteStream(partial, { flags: 'wx' }))
    emitSetupDownloadProgress(fileName, downloadedBytes, totalBytes === 0 ? downloadedBytes : totalBytes, false)
    const actual = hash.digest('hex')
    if (actual !== artifact.sha256.toLowerCase()) throw new Error(`artifact SHA-256 mismatch: expected ${artifact.sha256}, got ${actual}`)
    await rename(partial, destination)
    return destination
  } finally {
    await rm(partial, { force: true })
  }
}

function emitSetupDownloadProgress(fileName: string, downloadedBytes: number, totalBytes: number, cached: boolean): void {
  if (process.env.DSH_SETUP_PROGRESS !== 'jsonl') return
  process.stdout.write(`${SETUP_PROGRESS_PREFIX}${JSON.stringify({
    stage: 'download', fileName, downloadedBytes, totalBytes, cached,
  })}\n`)
}

function parseDownloadBytes(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined
}

interface AuthenticodeEvidence {
  readonly status: string
  readonly subject?: string
  readonly issuer?: string
  readonly thumbprint?: string
}

function verifyAuthenticode(path: string): AuthenticodeEvidence {
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:DSH_SETUP_PATH',
    '$certificate = $signature.SignerCertificate',
    '[ordered]@{ status = $signature.Status.ToString(); subject = $certificate.Subject; issuer = $certificate.Issuer; thumbprint = $certificate.Thumbprint } | ConvertTo-Json -Compress',
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, DSH_SETUP_PATH: path },
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Authenticode verification failed: ${result.stderr.trim()}`)
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>
  return {
    status: typeof parsed.status === 'string' ? parsed.status : 'UnknownError',
    ...(typeof parsed.subject === 'string' ? { subject: parsed.subject } : {}),
    ...(typeof parsed.issuer === 'string' ? { issuer: parsed.issuer } : {}),
    ...(typeof parsed.thumbprint === 'string' ? { thumbprint: parsed.thumbprint } : {}),
  }
}

function enforceDeclaredSignature(manifest: SetupManifest, actual: AuthenticodeEvidence): void {
  if (manifest.signature.status === 'invalid') throw new Error('manifest declares an invalid digital signature')
  if (manifest.signature.status === 'valid' && actual.status !== 'Valid') throw new Error(`declared valid signature but Windows reports ${actual.status}`)
  if (manifest.signature.thumbprint !== undefined && manifest.signature.thumbprint.toLowerCase() !== actual.thumbprint?.toLowerCase()) {
    throw new Error('Authenticode certificate thumbprint does not match the manifest')
  }
}

function formatAuthenticodeEvidence(evidence: AuthenticodeEvidence): string {
  return [
    `Windows signature: ${evidence.status}`,
    `Signer: ${evidence.subject ?? 'not available'}`,
    `Issuer: ${evidence.issuer ?? 'not available'}`,
    `Thumbprint: ${evidence.thumbprint ?? 'not available'}`,
    '',
  ].join('\n')
}

function safeFileName(value: string): string {
  const candidate = basename(value)
  return candidate.length === 0 || candidate === '.' ? 'setup.exe' : candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
