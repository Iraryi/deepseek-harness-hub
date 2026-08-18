import { describe, expect, it } from 'vitest'
import {
  classifySetupTrust,
  parseSetupManifest,
  sortSetupListings,
  validateSetupManifest,
} from '../src/index.ts'
import type { SetupManifest } from '../src/types.ts'

const baseManifest: SetupManifest = {
  schemaVersion: 1,
  id: 'dsh-example',
  name: { default: 'Example Setup', en: 'Example Setup', zh: '示例 Setup' },
  description: 'A test Setup',
  version: '1.0.0',
  kind: 'virtual',
  categories: ['developer-tools'],
  tags: ['example'],
  source: {
    repository: 'https://github.com/example/dsh-example',
    ref: 'v1.0.0',
    commit: '0123456789abcdef0123456789abcdef01234567',
  },
  compatibility: { dsh: '>=0.1.0-rc.5 <0.2.0', surfaces: ['cli', 'web', 'desktop'] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'valid', type: 'sigstore', signer: 'example' },
  audit: { status: 'certified', auditor: 'DSH Setup Library', checks: ['manifest', 'install', 'uninstall'] },
  artifacts: [{ id: 'package', kind: 'package', url: 'https://github.com/example/dsh-example/releases/download/v1.0.0/package.tgz', sha256: 'a'.repeat(64) }],
  install: { mode: 'profile', source: 'package', artifactId: 'package', profile: 'web' },
  permissions: ['profile-files'],
  network: ['https://api.example.com'],
}

describe('Setup protocol', () => {
  it('accepts a certified virtual Setup and derives its trust tier', () => {
    const parsed = parseSetupManifest(baseManifest)
    expect(classifySetupTrust(parsed)).toBe('certified')
  })

  it('rejects executable installation for virtual entries', () => {
    const invalid = { ...baseManifest, install: { mode: 'executable', artifactId: 'package' } }
    expect(validateSetupManifest(invalid).some(issue => issue.path === '$.install.mode')).toBe(true)
  })

  it('requires an artifact hash and https URLs', () => {
    const invalid = { ...baseManifest, source: { ...baseManifest.source, repository: 'http://github.com/example/dsh-example' }, artifacts: [{ ...baseManifest.artifacts[0], sha256: 'bad' }] }
    const issues = validateSetupManifest(invalid)
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['$.repository', '$.artifacts[0].sha256']))
  })

  it('requires package installation to name a hashed package artifact', () => {
    const missing = { ...baseManifest, install: { mode: 'profile', source: 'package', artifactId: 'missing' } }
    expect(validateSetupManifest(missing)).toContainEqual({ path: '$.install.artifactId', message: 'must refer to an artifact in $.artifacts' })
    const installer = { ...baseManifest, artifacts: [{ ...baseManifest.artifacts[0], kind: 'installer' }] }
    expect(validateSetupManifest(installer)).toContainEqual({ path: '$.install.artifactId', message: 'must refer to a package or archive artifact' })
  })

  it('accepts an explicit artifact filename and rejects path traversal', () => {
    const named = { ...baseManifest, artifacts: [{ ...baseManifest.artifacts[0], fileName: 'dsh-example-1.0.0.tgz' }] }
    expect(validateSetupManifest(named)).toEqual([])
    const traversal = { ...baseManifest, artifacts: [{ ...baseManifest.artifacts[0], fileName: '../dsh-example.tgz' }] }
    expect(validateSetupManifest(traversal)).toContainEqual({ path: '$.artifacts[0].fileName', message: 'must be a safe basename when present' })
  })

  it('ranks certified entries before source-only entries by default', () => {
    const sourceOnly = { ...baseManifest, id: 'source-only', audit: { ...baseManifest.audit, status: 'unreviewed' as const }, signature: { status: 'unsigned' as const } }
    const result = sortSetupListings([
      { manifest: sourceOnly, metrics: { installs: 100 } },
      { manifest: baseManifest, metrics: { installs: 1 } },
    ], 'recommended')
    expect(result.map(item => item.manifest.id)).toEqual(['dsh-example', 'source-only'])
  })
})
