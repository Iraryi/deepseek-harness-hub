import type { SetupListing } from '@deepseek-ai/dsh-setup-protocol'

/** Versioned payload served by a maintained Setup catalog. */
export interface SetupRegistryIndex {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly source: string
  readonly entries: readonly SetupListing[]
}

/** Conditional registry response state used by HUB caches. */
export type SetupRegistryFetchResult =
  | { readonly status: 'updated'; readonly index: SetupRegistryIndex; readonly etag?: string }
  | { readonly status: 'not-modified'; readonly etag?: string }

/** Fetch implementation kept injectable for offline and deterministic tests. */
export type SetupRegistryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
