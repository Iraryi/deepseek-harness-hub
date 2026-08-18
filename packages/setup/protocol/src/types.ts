/** Localized display text used by Setup entries. */
export type SetupLocalizedText = string | {
  readonly default: string
  readonly zh?: string
  readonly en?: string
}

/** Whether the entry is a HUB-generated install view or a real installer. */
export type SetupKind = 'virtual' | 'executable'

/** The trust tier shown by HUB before installation. */
export type SetupTrust = 'certified' | 'github-source' | 'unverified'

/** The artifact's operating-system role. */
export type SetupArtifactKind = 'in-box' | 'package' | 'archive' | 'installer'

/** A component already carried by the signed DSH installation. */
export interface SetupInBoxArtifact {
  readonly id: string
  readonly kind: 'in-box'
  readonly component: string
  readonly platform?: 'windows-x64' | 'windows-arm64' | 'any'
}

/** A normalized, remotely retrievable Setup artifact. */
export interface SetupRemoteArtifact {
  readonly id: string
  readonly kind: Exclude<SetupArtifactKind, 'in-box'>
  readonly url: string
  readonly sha256: string
  readonly fileName?: string
  readonly bytes?: number
  readonly platform?: 'windows-x64' | 'windows-arm64' | 'any'
  readonly executable?: boolean
}

/** Any artifact referenced by a Setup manifest. */
export type SetupArtifact = SetupInBoxArtifact | SetupRemoteArtifact

/** Source provenance for both virtual and executable Setup entries. */
export interface SetupSource {
  readonly repository: string
  readonly ref: string
  readonly commit?: string
  readonly release?: string
}

/** DSH versions and surfaces supported by an entry. */
export interface SetupCompatibility {
  readonly dsh: string
  readonly surfaces: readonly ('cli' | 'web' | 'desktop')[]
  readonly node?: string
  readonly platforms?: readonly ('windows-x64' | 'windows-arm64' | 'any')[]
}

/** The license and attribution shown in the Setup evidence panel. */
export interface SetupLicense {
  readonly identifier: string
  readonly name: string
  readonly url?: string
  readonly notice?: string
  readonly redistributable: boolean
}

/** Digital-signature evidence; unsigned artifacts remain installable only with an explicit warning. */
export interface SetupSignature {
  readonly status: 'valid' | 'invalid' | 'unsigned' | 'unknown'
  readonly type?: 'authenticode' | 'sigstore' | 'minisign' | 'other'
  readonly signer?: string
  readonly issuer?: string
  readonly thumbprint?: string
  readonly timestamp?: string
}

/** Human or automated audit evidence from the maintained Setup library. */
export interface SetupAudit {
  readonly status: 'certified' | 'reviewed' | 'unreviewed' | 'rejected'
  readonly auditor?: string
  readonly checkedAt?: string
  readonly report?: string
  readonly checks: readonly string[]
}

/** Installation action used by HUB after evidence review. */
export type SetupInstall =
  | {
    readonly mode: 'profile'
    readonly source: 'package'
    readonly artifactId: string
    readonly profile?: string
  }
  | {
    readonly mode: 'profile'
    readonly source: 'in-box'
    readonly bundle: string
    readonly profile?: string
  }
  | {
    readonly mode: 'executable'
    readonly artifactId: string
    readonly silentArgs?: readonly string[]
  }

/** A complete, versioned Setup manifest. */
export interface SetupManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: SetupLocalizedText
  readonly description: SetupLocalizedText
  readonly version: string
  readonly kind: SetupKind
  readonly categories: readonly string[]
  readonly tags: readonly string[]
  readonly source: SetupSource
  readonly compatibility: SetupCompatibility
  readonly license: SetupLicense
  readonly signature: SetupSignature
  readonly audit: SetupAudit
  readonly artifacts: readonly SetupArtifact[]
  readonly install: SetupInstall
  readonly permissions: readonly string[]
  readonly network: readonly string[]
}

/** Registry metrics kept separate from maintainer-authored Setup evidence. */
export interface SetupMetrics {
  readonly stars?: number
  readonly installs?: number
  readonly updatedAt?: string
}

/** A catalog item combines a verified manifest with registry-owned ranking data. */
export interface SetupListing {
  readonly manifest: SetupManifest
  readonly metrics: SetupMetrics
}

/** Sort modes supported by HUB catalog views. */
export type SetupSort = 'recommended' | 'stars' | 'installs' | 'updated'

/** A single manifest validation problem. */
export interface SetupIssue {
  readonly path: string
  readonly message: string
}
