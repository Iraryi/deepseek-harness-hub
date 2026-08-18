import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatSetupEvidence, loadSetupManifest, runSetup } from '../src/setup.ts'

const manifest = {
  schemaVersion: 1,
  id: 'dsh-cli-setup',
  name: { default: 'CLI Setup', zh: 'CLI 安装测试' },
  description: 'CLI test',
  version: '1.0.0',
  kind: 'virtual',
  categories: ['test'],
  tags: [],
  source: { repository: 'https://github.com/example/dsh-cli-setup', ref: 'v1.0.0', commit: '0123456789abcdef0123456789abcdef01234567' },
  compatibility: { dsh: '>=0.1.0-rc.5 <0.2.0', surfaces: ['desktop'] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'valid', type: 'sigstore' },
  audit: { status: 'certified', checks: ['manifest'] },
  artifacts: [{ id: 'package', kind: 'package', url: 'https://example.com/package.tgz', sha256: 'a'.repeat(64) }],
  install: { mode: 'profile', source: 'package', artifactId: 'package', profile: 'web' },
  permissions: ['profile-files'],
  network: [],
}

let directory: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('dsh setup', () => {
  it('loads and renders a local certified Setup manifest', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-setup-'))
    const path = join(directory, 'setup.json')
    await writeFile(path, JSON.stringify(manifest))
    const parsed = await loadSetupManifest(path)
    expect(formatSetupEvidence(parsed)).toContain('Trust: certified')
    expect(formatSetupEvidence(parsed)).toContain('License: MIT')
  })

  it('loads a UTF-8 BOM Setup manifest written by Windows tools', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-setup-'))
    const path = join(directory, 'setup.json')
    await writeFile(path, `\uFEFF${JSON.stringify(manifest)}`)
    await expect(loadSetupManifest(path)).resolves.toMatchObject({ id: manifest.id })
  })

  it('prints inspection evidence without installing', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-setup-'))
    const path = join(directory, 'setup.json')
    await writeFile(path, JSON.stringify(manifest))
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await expect(runSetup({ action: 'inspect', manifest: path, acceptSource: false, acceptUnverified: false, silent: false, json: false })).resolves.toBe(0)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('Declared signature: valid'))
  })

  it('requires explicit confirmation for source-only entries', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-setup-'))
    const path = join(directory, 'setup.json')
    await writeFile(path, JSON.stringify({ ...manifest, signature: { status: 'unsigned' }, audit: { status: 'unreviewed', checks: [] } }))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(runSetup({ action: 'install', manifest: path, acceptSource: false, acceptUnverified: false, silent: false, json: false })).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--accept-source'))
  })

  it('verifies a package artifact hash before npm can install it', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-setup-'))
    const path = join(directory, 'setup.json')
    await writeFile(path, JSON.stringify(manifest))
    vi.stubEnv('DSH_HOME', join(directory, 'home'))
    vi.stubEnv('DSH_SETUP_PROGRESS', 'jsonl')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('tampered package', {
      headers: { 'content-length': String(Buffer.byteLength('tampered package')) },
      status: 200,
    })))
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(runSetup({ action: 'install', manifest: path, acceptSource: false, acceptUnverified: false, silent: false, json: false })).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('artifact SHA-256 mismatch'))
    expect(output.mock.calls.map(([value]) => String(value)).join('')).toContain(
      'DSH_SETUP_PROGRESS {"stage":"download","fileName":"package.tgz","downloadedBytes":16,"totalBytes":16,"cached":false}',
    )
  })
})
