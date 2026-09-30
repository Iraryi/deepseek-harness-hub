/** Desktop management wire messages. Native handlers own validation and persistence. */

/** Management pages accepted by the parent settings entry. */
export type ManagementSection = 'overview' | 'mobile' | 'enhancements'

/** Native operations consumed by these pages; adding an operation also requires a real native handler. */
export type ManagementOperation = 'manager-status' | 'enhancements-read' | 'enhancements-save' | 'desktop-reload'
  | 'mobile-status' | 'mobile-start' | 'mobile-stop' | 'mobile-pair' | 'mobile-revoke' | 'config-dirty'

/** Rejects on transport or operation failure; resolves with the operation response, without an envelope. */
export type ManagementRequest = <T>(
  operation: ManagementOperation,
  payload?: Readonly<Record<string, unknown>>,
) => Promise<T>

/** Read-only manager-status facts. Known action IDs: enhancements, desktop-reload, mobile. Unknown capabilities are display-only. */
export interface ManagerStatus {
  schemaVersion: 1
  distribution: 'full' | 'overlay'
  launcherVersion: string
  runtimeVersion: string
  runtimePath: string
  nodePath: string
  dataPath: string
  homePath: string
  desktopUrl: string
  desktopReachable: boolean
  hubReady: boolean
  checks: ReadonlyArray<{ id: string; label: string; status: 'ok' | 'warning' | 'error'; detail: string }>
  capabilities: ReadonlyArray<{ id: string; label: string; available: boolean; detail: string }>
}

/** Persisted native-injected enhancements; conversationWidth is 0 (upstream default) or an integer from 640 to 2000 pixels. */
export interface EnhancementValues {
  schemaVersion: 1
  enabled: boolean
  conversationWidth: number
  plainTextPaste: boolean
  showSessionIds: boolean
}

/** enhancements-read response; revision is an opaque optimistic-concurrency token. */
export interface EnhancementsSnapshot {
  values: EnhancementValues
  revision: string
  restartRequired?: boolean
}

/** enhancements-save sends the complete values plus the last read/saved revision; rejects conflicts without overwriting. */
export type EnhancementsSavePayload = Readonly<{ values: EnhancementValues; revision: string }>

/** enhancements-save response; native injection takes effect only after a separate explicit desktop-reload request. */
export interface EnhancementsSaveResult extends EnhancementsSnapshot {
  restartRequired: true
}

/** Device granted full DSH access; timestamps are ISO UTC, and revocation does not cancel already accepted jobs. */
export interface MobileDevice {
  id: string
  name: string
  pairedAt: string
  lastSeen: string
  expiresAt: string
}

/** Relay state returned by mobile-start/stop/revoke; no upstream credentials or pairing secrets are exposed. */
export interface MobileRelayStatus {
  running: boolean
  bindAddress: string | null
  port: number | null
  url: string | null
  upstreamUrl: string | null
  transport: 'http-trusted-lan'
  devices: ReadonlyArray<MobileDevice>
  pairingExpiresAt: string | null
}

/** mobile-status adds native availability and local interface discovery to relay state; only RFC1918 IPv4 interfaces may be selected. */
export interface MobileStatus extends MobileRelayStatus {
  interfaces: ReadonlyArray<{ address: string; name: string }>
  available: boolean
  reason: string
}

/** mobile-start requires HTTP consent; port 0 requests an ephemeral port, otherwise 1..65535. Native code owns DSH authentication. */
export type MobileStartPayload = Readonly<{ bindAddress: string; port: number; trustedLanConsent: true }>

/** mobile-pair replaces a 120-second single-use grant. Keep the secret-fragment URL in component memory only; never log or persist it. */
export interface MobilePairing {
  url: string
  expiresAt: string
}

/** mobile-revoke invalidates the device and its open relay connections, not previously accepted DSH jobs. */
export type MobileRevokePayload = Readonly<{ deviceId: string }>

/** config-dirty controls the native close confirmation; reset to false when the enhancement editor unmounts. */
export type ManagementDirtyPayload = Readonly<{ dirty: boolean }>

/** Parent supplies the transport and current page; no bridge or localization registration is performed here. */
export interface ManagementCenterProps {
  section: ManagementSection
  request: ManagementRequest
  chinese: boolean
  /** Register the parent's navigation/close guard; saving cannot be interrupted, and dirty departure requires discard confirmation. */
  registerLeaveGuard?: (guard: () => Promise<boolean>) => () => void
}
