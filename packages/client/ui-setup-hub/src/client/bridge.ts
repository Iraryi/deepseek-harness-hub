import { classifySetupTrust, type SetupManifest } from '@deepseek-ai/dsh-setup-protocol'

interface WebViewMessageEvent {
  readonly data: unknown
}

interface WebViewBridge {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: WebViewMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: WebViewMessageEvent) => void): void
}

interface SetupBridgeWindow extends Window {
  chrome?: { webview?: WebViewBridge }
}

/** Native desktop commands exposed to the dedicated HUB surface. */
export type SetupDesktopCommand = 'open-config' | 'open-hub' | 'open-main'

/** GitHub account summary returned by the native credential owner. */
export interface HubGitHubAccount {
  readonly authenticated: boolean
  readonly avatarUrl?: string
  readonly login?: string
  readonly name?: string
  readonly profileUrl?: string
}

/** Repository metadata used for discovery and starred candidate views. */
export interface HubGitHubRepository {
  readonly archived: boolean
  readonly defaultBranch: string
  readonly description: string
  readonly disabled: boolean
  readonly fork: boolean
  readonly fullName: string
  readonly homepage?: string
  readonly language?: string
  readonly license?: string
  readonly name: string
  readonly owner: string
  readonly ownerAvatarUrl?: string
  readonly private: boolean
  readonly pushedAt?: string
  readonly repositoryUrl: string
  readonly stars: number
  readonly topics: readonly string[]
  readonly updatedAt?: string
}

/** Localized category or description text from the curated community registry. */
export interface HubCommunityText {
  readonly en?: string
  readonly zh?: string
}

/** One curated DSH plugin entry eligible for native Setup preflight. */
export interface HubCommunityPlugin {
  readonly added?: string | null
  readonly category: string
  readonly description?: HubCommunityText | null
  readonly install?: string | null
  readonly name: string
  readonly npm?: string | null
  readonly owner: string
  readonly screenshots?: readonly string[] | null
  readonly stars?: number | null
  readonly url: string
}

/** Curated community registry with live/cache/bundled provenance. */
export interface HubCommunityRegistry {
  readonly categories: Readonly<Record<string, HubCommunityText>>
  readonly count: number
  readonly plugins: readonly HubCommunityPlugin[]
  readonly sourceMode: 'live' | 'cache' | 'bundled'
  readonly sourceUrl: string
  readonly updated?: string
}

/** One dynamic DSHMK taxonomy item and its current result count. */
export interface HubDshmkCount {
  readonly count: number
  readonly id: string
}

/** DSHMK validation evidence bound to one immutable source revision. */
export interface HubDshmkValidation {
  readonly dshVersion: string
  readonly eligible: boolean
  readonly label: string
  readonly level: number
  readonly overall: string
  readonly platform: string
  readonly reason: string
  readonly sourceSha: string
  readonly stages: Readonly<Record<string, { readonly checkedAt?: string; readonly status?: string }>>
  readonly tone: string
  readonly updatedAt: string
  readonly validatorVersion: string
  readonly verified: boolean
}

/** Executable installation candidate published by DSHMK. */
export interface HubDshmkInstallCandidate {
  readonly args?: readonly string[]
  readonly command?: string
  readonly evidence?: Readonly<Record<string, string>>
  readonly executable?: boolean
  readonly source?: string
  readonly target?: string
}

/** Project summary returned by the native paginated DSHMK bridge. */
export interface HubDshmkProject {
  readonly categories: readonly string[]
  readonly category: string
  readonly classificationConfidence?: string
  readonly classificationSignals?: readonly string[]
  readonly classificationSource?: string
  readonly createdAt: string
  readonly defaultBranch: string
  readonly description: string
  readonly forks: number
  readonly fullName: string
  readonly homepage: string
  readonly id: string
  readonly install: {
    readonly candidate: HubDshmkInstallCandidate
    readonly candidates: readonly HubDshmkInstallCandidate[]
    readonly status: string
  }
  readonly installable: boolean
  readonly language: string
  readonly license: string
  readonly matchedTopics?: readonly string[]
  readonly name: string
  readonly openIssues: number
  readonly owner: { readonly avatarUrl: string; readonly login: string }
  readonly projectType: string
  readonly pushedAt: string
  readonly repositoryId: number
  readonly size?: number
  readonly stars: number
  readonly status?: Readonly<Record<string, string>>
  readonly topics: readonly string[]
  readonly updatedAt: string
  readonly url: string
  readonly validation: HubDshmkValidation
  readonly verified: boolean
}

/** One native-filtered page from the live or cached DSHMK catalog. */
export interface HubDshmkCatalogPage {
  readonly categories: readonly HubDshmkCount[]
  readonly generatedAt: string
  readonly items: readonly HubDshmkProject[]
  readonly page: number
  readonly pageSize: number
  readonly projectTypes: readonly HubDshmkCount[]
  readonly sourceMode: 'live' | 'cache' | 'bundled'
  readonly sourceUrl: string
  readonly total: number
  readonly totalPages: number
}

/** Reconstructed DSHMK detail payload with related projects. */
export interface HubDshmkDetail {
  readonly project: HubDshmkProject
  readonly related: readonly HubDshmkProject[]
  readonly sourceMode: 'live' | 'cache' | 'bundled'
  readonly sourceUrl: string
}

/** One artifact that the user may download outside HUB and import locally. */
export interface HubManualDownload {
  readonly bytes?: number
  readonly downloadUrl: string
  readonly fileName: string
  readonly id: string
  readonly kind: 'package' | 'archive' | 'installer'
  readonly repositoryUrl: string
  readonly sha256?: string
}

/** Result of validating and importing one manually downloaded artifact. */
export interface HubManualImportResult {
  readonly bytes?: number
  readonly cancelled: boolean
  readonly fileName?: string
  readonly imported: boolean
  readonly sha256?: string
}

/** Native Setup stage update shown by the HUB progress surface. */
export interface HubInstallProgress {
  readonly detail: string
  readonly downloadedBytes?: number
  readonly manualDownloads?: readonly HubManualDownload[]
  readonly message: string
  readonly percent: number
  readonly stage: 'preflight' | 'download' | 'install' | 'profile' | 'activation' | 'verify' | 'cancelled'
  readonly timestamp: string
  readonly totalBytes?: number
}

/** Verified activation result from a DSHMK one-click Setup. */
export interface HubDshmkInstallResult {
  readonly activeBundles: readonly string[]
  readonly message: string
  readonly packageNames: readonly string[]
  readonly profile: string
  readonly profilePath: string
  readonly repositoryId: number
  readonly status: 'activated'
  readonly verifiedAt: string
}

/** Optional progress observer for a bounded native operation. */
export interface HubRequestOptions {
  readonly onProgress?: (progress: HubInstallProgress) => void
  readonly timeoutMs?: number
}

/** Editable Setup workspace stored in the user's HUB library. */
export interface HubLibraryItem {
  readonly description?: string
  readonly id: string
  readonly name: string
  readonly path: string
  readonly sourceRepository?: string
  readonly updatedAt?: string
  readonly version?: string
}

/** Offline file waiting in the HUB inbox. */
export interface HubOfflineItem {
  readonly bytes: number
  readonly fileName: string
  readonly kind: 'manifest' | 'archive' | 'executable' | 'unknown'
  readonly modifiedAt?: string
  readonly path: string
}

/** Durable record for one Setup installed through HUB. */
export interface HubInstalledItem {
  readonly id: string
  readonly installedAt: string
  readonly kind: string
  readonly name: string
  readonly packageNames: readonly string[]
  readonly profile?: string
  readonly removable: boolean
  readonly sourceRepository?: string
  readonly version?: string
  readonly workspacePath: string
}

/** Initial local state for the dedicated HUB workspace. */
export interface HubSnapshot {
  readonly account: HubGitHubAccount
  readonly installed: readonly HubInstalledItem[]
  readonly library: readonly HubLibraryItem[]
  readonly libraryPath: string
  readonly offline: readonly HubOfflineItem[]
  readonly offlinePath: string
}

/** Generic native operations owned by the dedicated HUB executable. */
export type HubOperation =
  | 'hub-snapshot'
  | 'dshmk-catalog'
  | 'dshmk-detail'
  | 'dshmk-install'
  | 'setup-cancel'
  | 'setup-manual-import'
  | 'setup-open-manual-url'
  | 'app-reload'
  | 'desktop-reload'
  | 'hub-save-preferences'
  | 'community-registry'
  | 'community-prepare-setup'
  | 'github-search'
  | 'github-starred'
  | 'github-login-token'
  | 'github-logout'
  | 'hub-open-path'
  | 'hub-create-draft'
  | 'hub-delete-draft'
  | 'hub-uninstall'

/**
 * Whether the current browser surface is hosted by the desktop launcher.
 * @returns true when the WebView2 message bridge is available.
 */
export function setupBridgeAvailable(): boolean {
  return (window as SetupBridgeWindow).chrome?.webview !== undefined
}

/**
 * Send a non-installation command to the native desktop shell.
 * @param command - CONFIG or normal-Desktop navigation command.
 * @returns true when the WebView2 bridge accepted the command.
 */
export function sendSetupDesktopCommand(command: SetupDesktopCommand): boolean {
  const webview = (window as SetupBridgeWindow).chrome?.webview
  if (webview === undefined) return false
  webview.postMessage({ type: 'dsh-desktop-command', command })
  return true
}

/**
 * Ask the desktop launcher to install one already displayed manifest.
 * @param manifest - validated manifest whose evidence is already visible in HUB.
 * @param onProgress - optional listener for native installation progress updates.
 * @returns the desktop launcher's final installation message.
 */
export function installThroughDesktop(manifest: SetupManifest, onProgress?: (progress: HubInstallProgress) => void): Promise<string> {
  const webview = (window as SetupBridgeWindow).chrome?.webview
  if (webview === undefined) return Promise.reject(new Error('desktop bridge unavailable'))
  const requestId = globalThis.crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      webview.removeEventListener('message', onMessage)
      postSetupCancel(webview)
      reject(new Error('Setup installation timed out'))
    }, 12 * 60 * 1000)
    const onMessage = (event: WebViewMessageEvent): void => {
      if (isRecord(event.data) && event.data.type === 'dsh-setup-progress' && event.data.requestId === requestId) {
        const progress = readInstallProgress(event.data)
        if (progress !== undefined) onProgress?.(progress)
        return
      }
      if (!isRecord(event.data) || event.data.type !== 'dsh-setup-result' || event.data.requestId !== requestId) return
      window.clearTimeout(timer)
      webview.removeEventListener('message', onMessage)
      if (event.data.ok === true) resolve(typeof event.data.message === 'string' ? event.data.message : 'installed')
      else reject(new Error(typeof event.data.message === 'string' ? event.data.message : 'Setup installation failed'))
    }
    webview.addEventListener('message', onMessage)
    webview.postMessage({
      type: 'dsh-setup-install',
      requestId,
      manifest,
      trust: classifySetupTrust(manifest),
    })
  })
}

/**
 * Send a typed request to the native HUB owner.
 * @param operation - operation performed outside the browser sandbox.
 * @param payload - JSON-compatible operation input.
 * @param options - timeout and progress callbacks for the native request.
 * @returns operation-specific response data.
 */
export function requestHubThroughDesktop<T>(
  operation: HubOperation,
  payload: Readonly<Record<string, unknown>> = {},
  options: HubRequestOptions = {},
): Promise<T> {
  const webview = (window as SetupBridgeWindow).chrome?.webview
  if (webview === undefined) return Promise.reject(new Error('desktop bridge unavailable'))
  const requestId = globalThis.crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = options.timeoutMs ?? (operation === 'dshmk-install' || operation === 'community-prepare-setup' ? 30 * 60 * 1000 : 2 * 60 * 1000)
    const timer = window.setTimeout(() => {
      webview.removeEventListener('message', onMessage)
      if (operation === 'dshmk-install' || operation === 'community-prepare-setup') postSetupCancel(webview)
      reject(new Error('HUB request timed out'))
    }, timeout)
    const onMessage = (event: WebViewMessageEvent): void => {
      if (isRecord(event.data) && event.data.type === 'dsh-hub-progress' && event.data.requestId === requestId) {
        const progress = readInstallProgress(event.data)
        if (progress !== undefined) options.onProgress?.(progress)
        return
      }
      if (!isRecord(event.data) || event.data.type !== 'dsh-hub-result' || event.data.requestId !== requestId) return
      window.clearTimeout(timer)
      webview.removeEventListener('message', onMessage)
      if (event.data.ok === true) resolve(event.data.data as T)
      else reject(new Error(typeof event.data.message === 'string' ? event.data.message : 'HUB request failed'))
    }
    webview.addEventListener('message', onMessage)
    webview.postMessage({ type: 'dsh-hub-request', requestId, operation, payload })
  })
}

function readInstallProgress(value: Record<string, unknown>): HubInstallProgress | undefined {
  const stage = value.stage
  const allowed = stage === 'preflight' || stage === 'download' || stage === 'install' || stage === 'profile' || stage === 'activation' || stage === 'verify' || stage === 'cancelled'
  if (!allowed || typeof value.percent !== 'number' || typeof value.message !== 'string') return undefined
  const downloadedBytes = nonNegativeInteger(value.downloadedBytes)
  const manualDownloads = readManualDownloads(value.manualDownloads)
  const totalBytes = nonNegativeInteger(value.totalBytes)
  return {
    detail: typeof value.detail === 'string' ? value.detail : '',
    ...(downloadedBytes === undefined ? {} : { downloadedBytes }),
    ...(manualDownloads === undefined ? {} : { manualDownloads }),
    message: value.message,
    percent: Math.max(0, Math.min(100, value.percent)),
    stage,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : new Date().toISOString(),
    ...(totalBytes === undefined ? {} : { totalBytes }),
  }
}

function readManualDownloads(value: unknown): readonly HubManualDownload[] | undefined {
  if (!Array.isArray(value)) return undefined
  const downloads: HubManualDownload[] = []
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const kind = candidate.kind
    if (kind !== 'package' && kind !== 'archive' && kind !== 'installer') continue
    if (typeof candidate.id !== 'string' || typeof candidate.fileName !== 'string'
      || typeof candidate.downloadUrl !== 'string' || typeof candidate.repositoryUrl !== 'string') continue
    const bytes = nonNegativeInteger(candidate.bytes)
    downloads.push({
      ...(bytes === undefined ? {} : { bytes }),
      downloadUrl: candidate.downloadUrl,
      fileName: candidate.fileName,
      id: candidate.id,
      kind,
      repositoryUrl: candidate.repositoryUrl,
      ...(typeof candidate.sha256 === 'string' ? { sha256: candidate.sha256 } : {}),
    })
  }
  return downloads.length === 0 ? undefined : downloads
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function postSetupCancel(webview: WebViewBridge): void {
  try {
    webview.postMessage({ type: 'dsh-hub-request', requestId: globalThis.crypto.randomUUID(), operation: 'setup-cancel', payload: {} })
  } catch {
    // The owning timeout still settles the browser operation when WebView2 is already closing.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
