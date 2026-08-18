/* oxlint-disable @stylistic/max-len */
/**
 * Maintained and cached Setup catalog support for DSH HUB.
 *
 * @module @deepseek-ai/dsh-setup-registry
 */

import {
  parseSetupManifest,
  sortSetupListings,
  type SetupListing,
  type SetupSort,
} from '@deepseek-ai/dsh-setup-protocol'
import type { SetupRegistryFetch, SetupRegistryFetchResult, SetupRegistryIndex } from './types.ts'

export * from './types.ts'

/** The only registry index version currently accepted by HUB. */
export const SETUP_REGISTRY_SCHEMA_VERSION = 1 as const

/**
 * Parse an untrusted registry response and validate every nested Setup entry.
 * @param value - decoded JSON registry value.
 * @returns a validated registry index.
 */
export function parseSetupRegistry(value: unknown): SetupRegistryIndex {
  if (!isRecord(value)) throw new SetupRegistryError([{ path: '$', message: 'must be an object' }])
  if (value.schemaVersion !== SETUP_REGISTRY_SCHEMA_VERSION) throw new SetupRegistryError([{ path: '$.schemaVersion', message: `must equal ${SETUP_REGISTRY_SCHEMA_VERSION}` }])
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) throw new SetupRegistryError([{ path: '$.generatedAt', message: 'must be an ISO date string' }])
  if (typeof value.source !== 'string' || !isHttps(value.source)) throw new SetupRegistryError([{ path: '$.source', message: 'must be an https URL' }])
  if (!Array.isArray(value.entries)) throw new SetupRegistryError([{ path: '$.entries', message: 'must be an array' }])
  const entries: SetupListing[] = []
  const issues: SetupRegistryIssue[] = []
  value.entries.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.manifest)) {
      issues.push({ path: `$.entries[${index}]`, message: 'must contain a manifest object' })
      return
    }
    try {
      entries.push({
        manifest: parseSetupManifest(entry.manifest),
        metrics: parseMetrics(entry.metrics, `$.entries[${index}].metrics`, issues),
      })
    } catch (error) {
      if (error instanceof Error && 'issues' in error) {
        const nested = (error as { issues?: readonly { path: string; message: string }[] }).issues ?? []
        for (const issue of nested) issues.push({ path: `$.entries[${index}].manifest${issue.path.slice(1)}`, message: issue.message })
      } else {
        issues.push({ path: `$.entries[${index}].manifest`, message: 'could not be parsed' })
      }
    }
  })
  if (issues.length > 0) throw new SetupRegistryError(issues)
  return { schemaVersion: 1, generatedAt: value.generatedAt, source: value.source, entries }
}

/**
 * Fetch a registry with ETag support. A 304 response never destroys the last
 * good local index, which is the offline continuity rule for HUB.
 * @param url - HTTPS registry index URL.
 * @param etag - previously accepted ETag, if any.
 * @param fetcher - fetch implementation, injectable for tests.
 * @returns updated or unchanged registry state.
 */
export async function fetchSetupRegistry(url: string, etag?: string, fetcher: SetupRegistryFetch = fetch): Promise<SetupRegistryFetchResult> {
  if (!isHttps(url)) throw new Error('Setup registry URL must use https')
  const headers = new Headers({ accept: 'application/json' })
  if (etag !== undefined) headers.set('if-none-match', etag)
  const response = await fetcher(url, { headers, redirect: 'error' })
  const responseEtag = response.headers.get('etag') ?? undefined
  if (response.status === 304) {
    const resolvedEtag = responseEtag ?? etag
    return resolvedEtag === undefined ? { status: 'not-modified' } : { status: 'not-modified', etag: resolvedEtag }
  }
  if (!response.ok) throw new Error(`Setup registry request failed with HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Setup registry response must be JSON')
  const index = parseSetupRegistry(await response.json())
  return responseEtag === undefined ? { status: 'updated', index } : { status: 'updated', index, etag: responseEtag }
}

/**
 * Rank entries for a HUB view without mutating the registry order.
 * @param index - validated registry index.
 * @param sort - requested view sort.
 * @returns sorted entries.
 */
export function listSetupEntries(index: SetupRegistryIndex, sort: SetupSort = 'recommended'): SetupListing[] {
  return sortSetupListings(index.entries, sort)
}

/** Registry validation error with stable field paths. */
export class SetupRegistryError extends Error {
  /** Structured validation problems with stable registry field paths. */
  readonly issues: readonly SetupRegistryIssue[]

  constructor(issues: readonly SetupRegistryIssue[]) {
    super(`invalid Setup registry: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`)
    this.name = 'SetupRegistryError'
    this.issues = issues
  }
}

/** A single registry validation problem. */
export interface SetupRegistryIssue {
  readonly path: string
  readonly message: string
}

function parseMetrics(value: unknown, path: string, issues: SetupRegistryIssue[]): SetupListing['metrics'] {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object when present' })
    return {}
  }
  const result: { stars?: number; installs?: number; updatedAt?: string } = {}
  if (value.stars !== undefined) {
    if (!isNonNegativeInteger(value.stars)) issues.push({ path: `${path}.stars`, message: 'must be a non-negative safe integer' })
    else result.stars = value.stars
  }
  if (value.installs !== undefined) {
    if (!isNonNegativeInteger(value.installs)) issues.push({ path: `${path}.installs`, message: 'must be a non-negative safe integer' })
    else result.installs = value.installs
  }
  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) issues.push({ path: `${path}.updatedAt`, message: 'must be an ISO date string' })
    else result.updatedAt = value.updatedAt
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
