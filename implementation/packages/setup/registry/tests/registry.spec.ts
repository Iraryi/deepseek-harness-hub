import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fetchSetupRegistry, listSetupEntries, parseSetupRegistry } from '../src/index.ts'
import type { SetupManifest } from '@deepseek-ai/dsh-setup-protocol'
import type { SetupRegistryIndex } from '../src/types.ts'

const manifest: SetupManifest = {
  schemaVersion: 1,
  id: 'dsh-registry-entry',
  name: 'Registry Entry',
  description: 'Test entry',
  version: '1.0.0',
  kind: 'virtual',
  categories: ['test'],
  tags: [],
  source: { repository: 'https://github.com/example/dsh-registry-entry', ref: 'v1.0.0', commit: '0123456789abcdef0123456789abcdef01234567' },
  compatibility: { dsh: '>=0.1.0-rc.5 <0.2.0', surfaces: ['desktop'] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'valid', type: 'sigstore' },
  audit: { status: 'certified', checks: ['install'] },
  artifacts: [{ id: 'package', kind: 'package', url: 'https://example.com/package.tgz', sha256: 'a'.repeat(64) }],
  install: { mode: 'profile', source: 'package', artifactId: 'package' },
  permissions: [],
  network: [],
}

const index: SetupRegistryIndex = {
  schemaVersion: 1,
  generatedAt: '2026-08-15T00:00:00.000Z',
  source: 'https://example.com/dsh-setups.json',
  entries: [
    { manifest, metrics: { stars: 10, installs: 1 } },
  ],
}

describe('Setup registry', () => {
  it('parses and sorts a maintained index', () => {
    const parsed = parseSetupRegistry(index)
    expect(listSetupEntries(parsed, 'stars')[0]?.manifest.id).toBe('dsh-registry-entry')
  })

  it('uses ETag and preserves a not-modified result', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('if-none-match')).toBe('"old"')
      return new Response(null, { status: 304, headers: { etag: '"old"' } })
    })
    await expect(fetchSetupRegistry('https://example.com/dsh-setups.json', '"old"', fetcher)).resolves.toEqual({ status: 'not-modified', etag: '"old"' })
  })

  it('rejects non-JSON registry responses', async () => {
    const fetcher = async () => new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } })
    await expect(fetchSetupRegistry('https://example.com/dsh-setups.json', undefined, fetcher)).rejects.toThrow('must be JSON')
  })

  it('parses every Setup shipped in the Web catalog', () => {
    const shipped = JSON.parse(readFileSync('apps/web/public/setup/registry.json', 'utf8')) as unknown
    const parsed = parseSetupRegistry(shipped)
    expect(parsed.entries.map(entry => entry.manifest.id)).toEqual([
      'dsh-full-capability-pack',
      'cakeni-harness-pet',
      'yuuu0109-dsh-cache-hit-decimal',
    ])
  })
})
