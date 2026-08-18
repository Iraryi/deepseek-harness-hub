/* oxlint-disable @stylistic/max-len, typescript/use-unknown-in-catch-callback-variable */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconCodeOutline16,
  IconCordisPluginOutline14,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconGlobeOutline14,
  IconLikeOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconUserOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  classifySetupTrust,
  resolveSetupText,
  sortSetupListings,
  type SetupListing,
  type SetupManifest,
  type SetupSort,
  type SetupTrust,
} from '@deepseek-ai/dsh-setup-protocol'
import type { SetupRegistryIndex } from '@deepseek-ai/dsh-setup-registry'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HubGitHubAccount,
  HubGitHubRepository,
  HubCommunityPlugin,
  HubCommunityRegistry,
  HubDshmkCatalogPage,
  HubDshmkDetail,
  HubDshmkInstallResult,
  HubDshmkProject,
  HubInstallProgress,
  HubInstalledItem,
  HubLibraryItem,
  HubManualImportResult,
  HubOfflineItem,
  HubOperation,
  HubRequestOptions,
  HubSnapshot,
} from './bridge.ts'
import {
  communityCategoryCounts,
  communityPageItems,
  communityRepository,
  communitySupportsOneClick,
  visibleCommunityPlugins,
  type CommunitySort,
  type CommunityTimeRange,
} from './community.ts'
import type { SetupHubLocaleKey } from './locales.ts'
import css from './SetupHubSettingsTab.module.css'

/** Catalog and desktop operations supplied by the browser plugin registration. */
export interface SetupHubInjected {
  /** Whether the native WebView2 installation bridge is available. */
  desktopAvailable: boolean
  /** Load and validate the distribution-protected Setup registry. */
  list: () => Promise<SetupRegistryIndex>
  /** Install one manifest after the user-visible evidence review. */
  install: (manifest: SetupManifest, onProgress?: (progress: HubInstallProgress) => void) => Promise<string>
  /** Run a native HUB operation without exposing credentials to the page. */
  requestHub: <T>(operation: HubOperation, payload?: Readonly<Record<string, unknown>>, options?: HubRequestOptions) => Promise<T>
  /** Open the native CONFIG application. */
  openConfig: () => void
  /** Open the independent DSH HUB process from the normal Desktop settings surface. */
  openHub?: (() => void) | undefined
  /** Leave the dedicated HUB surface and return to the normal Desktop UI. */
  leaveHub: () => void
}

/** Backward-compatible name for the Settings registration's injected face. */
export type SetupHubSettingsTabInjected = SetupHubInjected

/** Full component props assembled by the Settings slot renderer. */
export type SetupHubSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.setupHub'>
  & InjectFace<SetupHubInjected>

/** Full component props assembled by the dedicated desktop overlay renderer. */
export type SetupHubDesktopSurfaceProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.setupHub'>
  & InjectFace<SetupHubInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly index: SetupRegistryIndex }

type AsyncState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T }

type InstallState =
  | { readonly status: 'idle' }
  | { readonly status: 'installing' }
  | { readonly status: 'installed'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

type HubSection = 'home' | 'github' | 'catalog' | 'starred' | 'library' | 'offline' | 'installed' | 'builder' | 'account' | 'security'
type TrustFilter = 'all' | SetupTrust
type DiscoverySource = 'dshmk' | 'community' | 'github'
type HubTheme = 'system' | 'light' | 'dark'
type HubDetailEntry = 'button' | 'card'
type HubDetailMode = 'side' | 'modal' | 'full'
type HubDetailContent = 'native' | 'original'

type DshmkInstallSurface =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly project: HubDshmkProject; readonly progress: HubInstallProgress; readonly logs: readonly HubInstallProgress[] }
  | { readonly status: 'success'; readonly project: HubDshmkProject; readonly result: HubDshmkInstallResult; readonly logs: readonly HubInstallProgress[] }
  | { readonly status: 'error'; readonly project: HubDshmkProject; readonly message: string; readonly logs: readonly HubInstallProgress[] }

type CommunityInstallSurface =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly plugin: HubCommunityPlugin; readonly progress: HubInstallProgress; readonly logs: readonly HubInstallProgress[] }
  | { readonly status: 'success'; readonly plugin: HubCommunityPlugin; readonly message: string; readonly logs: readonly HubInstallProgress[] }
  | { readonly status: 'error'; readonly plugin: HubCommunityPlugin; readonly message: string; readonly logs: readonly HubInstallProgress[] }

type ComponentRemovalSurface =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly item: HubInstalledItem; readonly progress: HubInstallProgress }

interface HubPreferences {
  readonly discoverySource: DiscoverySource
  readonly detailContent: HubDetailContent
  readonly detailEntry: HubDetailEntry
  readonly detailMode: HubDetailMode
  readonly pageSize: 12 | 24 | 48 | 96 | 200
  readonly startPage: Extract<HubSection, 'home' | 'github' | 'library' | 'installed'>
  readonly theme: HubTheme
}

const TRUST_KEYS = {
  certified: 'certified',
  'github-source': 'githubSource',
  unverified: 'unverified',
} satisfies Record<SetupTrust, SetupHubLocaleKey>

const SORT_KEYS = {
  recommended: 'recommended',
  stars: 'stars',
  installs: 'installs',
  updated: 'updated',
} satisfies Record<SetupSort, SetupHubLocaleKey>

/** Evidence-first Setup catalog rendered inside the regular Settings page. */
export function SetupHubSettingsTab(props: SetupHubSettingsTabProps): ReactNode {
  return <section className={css.settingsSurface}><DesktopComponentManager {...props} /></section>
}

/** Full-window HUB workspace used by the dedicated Windows executable. */
export function SetupHubDesktopSurface(props: SetupHubDesktopSurfaceProps): ReactNode {
  const preferences = useMemo(readHubPreferences, [])
  const [section, setSection] = useState<HubSection>(preferences.startPage)
  const [snapshotRequest, setSnapshotRequest] = useState(0)
  const [snapshot, setSnapshot] = useState<AsyncState<HubSnapshot>>({ status: 'loading' })
  const [community, setCommunity] = useState<AsyncState<HubCommunityRegistry>>({ status: 'idle' })
  const [github, setGitHub] = useState<AsyncState<readonly HubGitHubRepository[]>>({ status: 'idle' })
  const [starred, setStarred] = useState<AsyncState<readonly HubGitHubRepository[]>>({ status: 'idle' })
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<AsyncState<string>>({ status: 'idle' })
  const [communityInstalls, setCommunityInstalls] = useState<Readonly<Record<string, InstallState>>>({})
  const [communityInstallSurface, setCommunityInstallSurface] = useState<CommunityInstallSurface>({ status: 'idle' })
  const [restartPending, setRestartPending] = useState(readDesktopRestartPending)
  const [restartAction, setRestartAction] = useState<AsyncState<string>>({ status: 'idle' })
  const [restartPrompt, setRestartPrompt] = useState<string>()
  const [restartTransition, setRestartTransition] = useState(false)
  const [componentRemoval, setComponentRemoval] = useState<ComponentRemovalSurface>({ status: 'idle' })

  useHubTheme(preferences.theme)

  useEffect(() => {
    let current = true
    setSnapshot({ status: 'loading' })
    void props.requestHub<HubSnapshot>('hub-snapshot').then(
      (value) => { if (current) setSnapshot({ status: 'ready', data: value }) },
      (error) => { if (current) setSnapshot({ status: 'error', message: errorMessage(error) }) },
    )
    return () => { current = false }
  }, [props.requestHub, snapshotRequest])

  const account = snapshot.status === 'ready' ? snapshot.data.account : { authenticated: false }

  useEffect(() => {
    if (!account.authenticated) return
    let current = true
    setStarred({ status: 'loading' })
    void props.requestHub<readonly HubGitHubRepository[]>('github-starred').then(
      (value) => { if (current) setStarred({ status: 'ready', data: value }) },
      (error) => { if (current) setStarred({ status: 'error', message: errorMessage(error) }) },
    )
    return () => { current = false }
  }, [account.authenticated, props.requestHub])

  const refreshSnapshot = (): void => { setSnapshotRequest(value => value + 1) }
  const markDesktopRestartPending = (): void => {
    setRestartPending(true)
    try { window.localStorage.setItem('dshHub.desktopRestartPending', '1') } catch { /* Browser storage can be unavailable in hardened WebView profiles. */ }
  }
  const restartDesktop = async (): Promise<void> => {
    if (restartAction.status === 'loading') return
    const startedAt = Date.now()
    setRestartAction({ status: 'loading' })
    setRestartTransition(true)
    try {
      await props.requestHub<Record<string, unknown>>('desktop-reload')
      await waitForMinimumDuration(startedAt, 720)
      setRestartTransition(false)
      setRestartPending(false)
      try { window.localStorage.removeItem('dshHub.desktopRestartPending') } catch { /* Browser storage can be unavailable in hardened WebView profiles. */ }
      setRestartAction({ status: 'ready', data: props.t('desktopRestartApplied') })
    } catch (error) {
      setRestartTransition(false)
      setRestartAction({ status: 'error', message: errorMessage(error) })
      throw error
    }
  }
  const loadCommunity = (): void => {
    setCommunity({ status: 'loading' })
    void props.requestHub<HubCommunityRegistry>('community-registry').then(
      (value) => { setCommunity({ status: 'ready', data: value }) },
      (error) => { setCommunity({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const searchGitHub = (value: string = query): void => {
    setGitHub({ status: 'loading' })
    void props.requestHub<readonly HubGitHubRepository[]>('github-search', { query: value }).then(
      (repositories) => { setGitHub({ status: 'ready', data: repositories }) },
      (error) => { setGitHub({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const openSection = (next: HubSection): void => {
    setSection(next)
  }
  const loadStarred = (): void => {
    setStarred({ status: 'loading' })
    void props.requestHub<readonly HubGitHubRepository[]>('github-starred').then(
      (repositories) => { setStarred({ status: 'ready', data: repositories }) },
      (error) => { setStarred({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const login = (token: string): void => {
    setAction({ status: 'loading' })
    void props.requestHub<HubGitHubAccount>('github-login-token', { token }).then(
      (value) => {
        setAction({ status: 'ready', data: value.login ?? props.t('signedIn') })
        setStarred({ status: 'idle' })
        refreshSnapshot()
      },
      (error) => { setAction({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const logout = (): void => {
    setAction({ status: 'loading' })
    void props.requestHub<Record<string, never>>('github-logout').then(
      () => {
        setAction({ status: 'idle' })
        setStarred({ status: 'idle' })
        refreshSnapshot()
      },
      (error) => { setAction({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const openPath = (path: string): void => {
    void props.requestHub<Record<string, never>>('hub-open-path', { path }).catch((error) => {
      setAction({ status: 'error', message: errorMessage(error) })
    })
  }
  const createDraft = (repository?: HubGitHubRepository): void => {
    setAction({ status: 'loading' })
    void props.requestHub<HubLibraryItem>('hub-create-draft', repository === undefined ? {} : { repository }).then(
      (item) => {
        setAction({ status: 'ready', data: item.path })
        refreshSnapshot()
        setSection('library')
      },
      (error) => { setAction({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const installCommunity = (plugin: HubCommunityPlugin): void => {
    const initial: HubInstallProgress = {
      detail: plugin.install ?? plugin.npm ?? plugin.url,
      message: props.t('communitySetupPreflight'),
      percent: 4,
      stage: 'preflight',
      timestamp: new Date().toISOString(),
    }
    setCommunityInstalls(current => ({ ...current, [plugin.url]: { status: 'installing' } }))
    setCommunityInstallSurface({ status: 'running', plugin, progress: initial, logs: [initial] })
    void props.requestHub<SetupManifest>('community-prepare-setup', { url: plugin.url }, {
      onProgress: (progress) => {
        setCommunityInstallSurface(current => current.status !== 'running' || current.plugin.url !== plugin.url
          ? current
          : { ...current, progress, logs: [...current.logs, progress].slice(-12) })
      },
    }).then(
      manifest => props.install(manifest, (progress) => {
        setCommunityInstallSurface(current => current.status !== 'running' || current.plugin.url !== plugin.url
          ? current
          : { ...current, progress, logs: [...current.logs, progress].slice(-12) })
      }),
    ).then(
      (message) => {
        setCommunityInstalls(current => ({ ...current, [plugin.url]: { status: 'installed', message } }))
        setCommunityInstallSurface(current => ({ status: 'success', plugin, message, logs: current.status === 'running' ? current.logs : [] }))
        markDesktopRestartPending()
        refreshSnapshot()
      },
      (error) => {
        const message = errorMessage(error)
        setCommunityInstalls(current => ({ ...current, [plugin.url]: { status: 'error', message } }))
        setCommunityInstallSurface(current => ({ status: 'error', plugin, message, logs: current.status === 'running' ? current.logs : [] }))
      },
    )
  }
  const cancelCommunityInstall = (): void => {
    if (communityInstallSurface.status !== 'running') return
    void props.requestHub<{ readonly cancelled: boolean }>('setup-cancel').catch(() => undefined)
  }
  const deleteDraft = (item: HubLibraryItem): void => {
    if (!window.confirm(props.t('deleteDraftConfirm').replace('{name}', item.name))) return
    setAction({ status: 'loading' })
    void props.requestHub<Record<string, never>>('hub-delete-draft', { id: item.id }).then(
      () => { setAction({ status: 'idle' }); refreshSnapshot() },
      (error) => { setAction({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const uninstall = (item: HubInstalledItem): void => {
    if (!window.confirm(props.t('uninstallConfirm').replace('{name}', item.name))) return
    setComponentRemoval({ status: 'running', item, progress: initialComponentRemovalProgress(item, props.t) })
    setAction({ status: 'loading' })
    void props.requestHub<Record<string, never>>('hub-uninstall', { id: item.id }, {
      onProgress: (progress) => {
        setComponentRemoval(current => current.status === 'running' && current.item.id === item.id
          ? { ...current, progress }
          : current)
      },
    }).then(
      () => {
        setComponentRemoval({ status: 'idle' })
        setAction({ status: 'ready', data: props.t('componentRemoved') })
        markDesktopRestartPending()
        setRestartPrompt(item.name)
        refreshSnapshot()
      },
      (error) => {
        setComponentRemoval({ status: 'idle' })
        setAction({ status: 'error', message: errorMessage(error) })
      },
    )
  }

  const content = (() => {
    if (section === 'catalog') return <CatalogWorkspace {...props} display="desktop" onInstalled={() => { markDesktopRestartPending(); refreshSnapshot() }} />
    if (snapshot.status === 'loading' || snapshot.status === 'idle') return <HubLoading t={props.t} />
    if (snapshot.status === 'error') return <HubFailure message={snapshot.message} onRetry={refreshSnapshot} t={props.t} />
    const data = snapshot.data
    if (section === 'home') return (
      <HomeView
        data={data}
        onCreate={() => { createDraft() }}
        onNavigate={openSection}
        onOpenPath={openPath}
        starred={starred}
        t={props.t}
      />
    )
    if (section === 'github') return (
      <GitHubView
        community={community}
        communityInstalls={communityInstalls}
        desktopAvailable={props.desktopAvailable}
        query={query}
        repositories={github}
        onCreate={createDraft}
        onInstall={installCommunity}
        onLoadCommunity={loadCommunity}
        onQuery={setQuery}
        onSearch={searchGitHub}
        initialSource={preferences.discoverySource}
        detailContent={preferences.detailContent}
        detailEntry={preferences.detailEntry}
        detailMode={preferences.detailMode}
        installedIds={new Set(data.installed.map(item => item.id))}
        onInstalled={() => { markDesktopRestartPending(); refreshSnapshot() }}
        onRestartDesktop={restartDesktop}
        pageSize={preferences.pageSize}
        requestHub={props.requestHub}
        t={props.t}
      />
    )
    if (section === 'starred') return (
      <StarredView
        account={data.account}
        repositories={starred}
        onCreate={createDraft}
        onOpenAccount={() => { openSection('account') }}
        onRefresh={loadStarred}
        t={props.t}
      />
    )
    if (section === 'library') return (
      <LibraryView data={data} onCreate={() => { createDraft() }} onDelete={deleteDraft} onOpenPath={openPath} t={props.t} />
    )
    if (section === 'offline') return <OfflineView data={data} onOpenPath={openPath} t={props.t} />
    if (section === 'installed') return <InstalledView data={data} onOpenPath={openPath} onUninstall={uninstall} t={props.t} />
    if (section === 'builder') return <BuilderView data={data} onCreate={() => { createDraft() }} onOpenPath={openPath} t={props.t} />
    if (section === 'account') return <AccountView account={data.account} action={action} onLogin={login} onLogout={logout} t={props.t} />
    return <SecurityView data={data} t={props.t} />
  })()

  const counts = snapshot.status === 'ready' ? {
    installed: snapshot.data.installed.length,
    library: snapshot.data.library.length,
    offline: snapshot.data.offline.length,
    starred: starred.status === 'ready' ? starred.data.length : undefined,
  } : { installed: undefined, library: undefined, offline: undefined, starred: undefined }

  return (
    <section className={css.desktopSurface} aria-label={props.t('hubTitle')}>
      <header className={css.appHeader}>
        <div className={css.brand}>
          <span className={css.brandMark}><IconCordisPluginOutline14 size={18} /></span>
          <span><strong>{props.t('hubTitle')}</strong><small>{props.t('brandTagline')}</small></span>
        </div>
        {account.authenticated ? (
          <button className={css.accountPill} type="button" onClick={() => { openSection('starred') }}>
            {account.avatarUrl === undefined ? <IconUserOutline16 size={16} /> : <img alt="" src={account.avatarUrl} />}
            <span>{account.login}</span>
          </button>
        ) : null}
        <div className={css.headerActions}>
          {restartPending ? <button className={css.restartDesktopButton} type="button" data-busy={restartAction.status === 'loading' || undefined} disabled={restartAction.status === 'loading'} onClick={() => { void restartDesktop().catch(() => undefined) }}><IconRefreshOutline16 size={16} />{restartAction.status === 'loading' ? props.t('restartingDesktop') : props.t('restartDesktop')}</button> : null}
          <button type="button" onClick={props.openConfig} disabled={!props.desktopAvailable}><IconSettingsOutline16 size={16} />{props.t('openConfig')}</button>
          <button type="button" onClick={props.leaveHub}>{props.t('returnToDesktop')}</button>
        </div>
      </header>
      <div className={css.hubShell}>
        <FunctionNavigation active={section} counts={counts} onSelect={openSection} t={props.t} />
        <main className={css.hubMain} data-section={section}>{content}</main>
      </div>
      {action.status === 'error' ? <div className={css.toast} role="alert"><IconWarningOutline16 size={16} />{action.message}</div> : null}
      {restartAction.status === 'error' ? <div className={css.toast} role="alert"><IconWarningOutline16 size={16} />{restartAction.message}</div> : null}
      {restartAction.status === 'ready' ? <div className={css.toast} role="status"><IconCheckOutline16 size={16} />{restartAction.data}</div> : null}
      <ComponentRemovalProgress surface={componentRemoval} t={props.t} />
      {restartPrompt === undefined ? null : <RestartDecisionDialog name={restartPrompt} onLater={() => { setRestartPrompt(undefined) }} onRestart={() => { setRestartPrompt(undefined); void restartDesktop().catch(() => undefined) }} t={props.t} />}
      <RestartTransition active={restartTransition} t={props.t} />
      {communityInstallSurface.status === 'idle' ? null : (
        <SetupProgressSurface
          error={communityInstallSurface.status === 'error' ? communityInstallSurface.message : undefined}
          icon={<CommunityOwnerAvatar owner={communityInstallSurface.plugin.owner} />}
          logs={communityInstallSurface.logs}
          name={communityInstallSurface.plugin.name}
          onActivate={restartDesktop}
          onCancel={cancelCommunityInstall}
          onClose={() => { setCommunityInstallSurface({ status: 'idle' }) }}
          onRetry={() => { installCommunity(communityInstallSurface.plugin) }}
          progress={communityInstallSurface.status === 'running' ? communityInstallSurface.progress : undefined}
          reference={communityInstallSurface.plugin.install ?? communityInstallSurface.plugin.npm ?? communityInstallSurface.plugin.url}
          requestHub={props.requestHub}
          status={communityInstallSurface.status}
          subtitle={communityInstallSurface.plugin.owner || communityInstallSurface.plugin.url}
          successDetail={communityInstallSurface.status === 'success' ? communityInstallSurface.message : undefined}
          t={props.t}
        />
      )}
    </section>
  )
}

function FunctionNavigation(props: {
  readonly active: HubSection
  readonly counts: { readonly installed: number | undefined; readonly library: number | undefined; readonly offline: number | undefined; readonly starred: number | undefined }
  readonly onSelect: (section: HubSection) => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const primary: readonly [HubSection, SetupHubLocaleKey, ReactNode, number | undefined][] = [
    ['home', 'navHome', <IconPanelLeftOutline16 size={16} key="home" />, undefined],
    ['github', 'navGitHub', <IconGlobeOutline14 size={16} key="github" />, undefined],
    ['catalog', 'navCatalog', <IconCordisPluginOutline14 size={16} key="catalog" />, undefined],
    ['starred', 'navStarred', <IconLikeOutline16 size={16} key="starred" />, props.counts.starred],
  ]
  const workspace: readonly [HubSection, SetupHubLocaleKey, ReactNode, number | undefined][] = [
    ['library', 'navLibrary', <IconFolderOpenOutline16 size={16} key="library" />, props.counts.library],
    ['offline', 'navOffline', <IconDownloadOutline16 size={16} key="offline" />, props.counts.offline],
    ['installed', 'navInstalled', <IconCheckOutline16 size={16} key="installed" />, props.counts.installed],
    ['builder', 'navBuilder', <IconCodeOutline16 size={16} key="builder" />, undefined],
  ]
  const system: readonly [HubSection, SetupHubLocaleKey, ReactNode, number | undefined][] = [
    ['account', 'navAccount', <IconUserOutline16 size={16} key="account" />, undefined],
    ['security', 'navSecurity', <IconWarningOutline16 size={16} key="security" />, undefined],
  ]
  return (
    <aside className={css.functionNav} aria-label={props.t('functionArea')}>
      <div className={css.navGroup}><p>{props.t('explore')}</p>{primary.map(item => <FunctionNavButton key={item[0]} item={item} {...props} />)}</div>
      <div className={css.navGroup}><p>{props.t('myWorkspace')}</p>{workspace.map(item => <FunctionNavButton key={item[0]} item={item} {...props} />)}</div>
      <div className={css.navGroup}><p>{props.t('systemArea')}</p>{system.map(item => <FunctionNavButton key={item[0]} item={item} {...props} />)}</div>
    </aside>
  )
}

function FunctionNavButton(props: {
  readonly active: HubSection
  readonly item: readonly [HubSection, SetupHubLocaleKey, ReactNode, number | undefined]
  readonly onSelect: (section: HubSection) => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [section, key, icon, count] = props.item
  return (
    <button type="button" aria-current={props.active === section ? 'page' : undefined} data-active={props.active === section || undefined} data-section={section} onClick={() => { props.onSelect(section) }}>
      {icon}<span>{props.t(key)}</span>{count === undefined ? null : <b>{count}</b>}
    </button>
  )
}

function HomeView(props: {
  readonly data: HubSnapshot
  readonly onCreate: () => void
  readonly onNavigate: (section: HubSection) => void
  readonly onOpenPath: (path: string) => void
  readonly starred: AsyncState<readonly HubGitHubRepository[]>
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const starredCount = props.starred.status === 'ready' ? props.starred.data.length : 0
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('homeEyebrow')} title={props.t('homeTitle')} description={props.t('homeIntro')} />
      <div className={css.metricGrid}>
        <MetricCard value={props.data.library.length} label={props.t('libraryDrafts')} onClick={() => { props.onNavigate('library') }} />
        <MetricCard value={props.data.offline.length} label={props.t('offlineWaiting')} onClick={() => { props.onNavigate('offline') }} />
        <MetricCard value={starredCount} label={props.t('githubStarred')} onClick={() => { props.onNavigate('starred') }} />
        <MetricCard value={props.data.installed.length} label={props.t('installedSetups')} onClick={() => { props.onNavigate('installed') }} />
      </div>
      <section className={css.quickActions}>
        <SectionHeading title={props.t('quickActions')} description={props.t('quickActionsBody')} />
        <div className={css.actionGrid}>
          <ActionTile icon={<IconSearchOutline16 size={18} />} title={props.t('searchGitHub')} body={props.t('searchGitHubBody')} onClick={() => { props.onNavigate('github') }} />
          <ActionTile icon={<IconPlusOutline16 size={18} />} title={props.t('createBlank')} body={props.t('createBlankBody')} onClick={props.onCreate} />
          <ActionTile icon={<IconFolderOpenOutline16 size={18} />} title={props.t('openLibrary')} body={props.data.libraryPath} onClick={() => { props.onOpenPath(props.data.libraryPath) }} />
          <ActionTile icon={<IconDownloadOutline16 size={18} />} title={props.t('openOffline')} body={props.data.offlinePath} onClick={() => { props.onOpenPath(props.data.offlinePath) }} />
        </div>
      </section>
      <div className={css.homeColumns}>
        <PreviewList title={props.t('continueEditing')} empty={props.t('noLibraryDrafts')}>
          {props.data.library.slice(0, 4).map(item => (
            <PreviewRow key={item.id} title={item.name} meta={[item.version, item.sourceRepository].filter(Boolean).join(' · ')} onClick={() => { props.onOpenPath(item.path) }} />
          ))}
        </PreviewList>
        <PreviewList title={props.t('recentlyInstalled')} empty={props.t('noInstalled')}>
          {props.data.installed.slice(0, 4).map(item => (
            <PreviewRow key={item.id} title={item.name} meta={formatDate(item.installedAt, resolveLanguage())} onClick={() => { props.onNavigate('installed') }} />
          ))}
        </PreviewList>
      </div>
    </div>
  )
}

function GitHubView(props: {
  readonly community: AsyncState<HubCommunityRegistry>
  readonly communityInstalls: Readonly<Record<string, InstallState>>
  readonly desktopAvailable: boolean
  readonly query: string
  readonly repositories: AsyncState<readonly HubGitHubRepository[]>
  readonly onCreate: (repository: HubGitHubRepository) => void
  readonly onInstall: (plugin: HubCommunityPlugin) => void
  readonly onLoadCommunity: () => void
  readonly onQuery: (value: string) => void
  readonly onSearch: (query?: string) => void
  readonly initialSource: DiscoverySource
  readonly detailContent: HubDetailContent
  readonly detailEntry: HubDetailEntry
  readonly detailMode: HubDetailMode
  readonly installedIds: ReadonlySet<string>
  readonly onInstalled: () => void
  readonly onRestartDesktop: () => Promise<void>
  readonly pageSize: HubPreferences['pageSize']
  readonly requestHub: SetupHubDesktopSurfaceProps['requestHub']
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [source, setSource] = useState<DiscoverySource>(props.initialSource)
  const submit = (event: FormEvent): void => { event.preventDefault(); props.onSearch() }
  useEffect(() => {
    if (source === 'dshmk') return
    if (source === 'community' && props.community.status === 'idle') props.onLoadCommunity()
    if (source === 'github' && props.repositories.status === 'idle') props.onSearch('')
  }, [props.community.status, props.onLoadCommunity, props.onSearch, props.repositories.status, source])
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('githubEyebrow')} title={props.t('githubTitle')} description={props.t('githubIntro')} />
      <div className={css.discoveryTabs} role="tablist" aria-label={props.t('discoverySource')}>
        <button type="button" role="tab" aria-selected={source === 'dshmk'} data-active={source === 'dshmk' || undefined} onClick={() => { setSource('dshmk') }}><IconCheckOutline16 size={16} />{props.t('dshmkDiscovery')}</button>
        <button type="button" role="tab" aria-selected={source === 'community'} data-active={source === 'community' || undefined} onClick={() => { setSource('community') }}><IconCheckOutline16 size={16} />{props.t('curatedDiscovery')}</button>
        <button type="button" role="tab" aria-selected={source === 'github'} data-active={source === 'github' || undefined} onClick={() => { setSource('github'); if (props.repositories.status === 'idle') props.onSearch('') }}><IconGlobeOutline14 size={16} />{props.t('globalGitHub')}</button>
      </div>
      {source === 'dshmk' ? (
        <DshmkDiscovery
          desktopAvailable={props.desktopAvailable}
          detailContent={props.detailContent}
          detailEntry={props.detailEntry}
          detailMode={props.detailMode}
          installedIds={props.installedIds}
          onInstalled={props.onInstalled}
          onRestartDesktop={props.onRestartDesktop}
          pageSize={props.pageSize}
          requestHub={props.requestHub}
          t={props.t}
        />
      ) : source === 'community' ? (
        <CommunityDiscovery
          desktopAvailable={props.desktopAvailable}
          installs={props.communityInstalls}
          onCreate={(plugin) => { props.onCreate(communityRepository(plugin)) }}
          onInstall={props.onInstall}
          onRetry={props.onLoadCommunity}
          state={props.community}
          t={props.t}
        />
      ) : (
        <>
          <form className={css.githubSearch} onSubmit={submit}>
            <label className={css.searchBox}><IconSearchOutline16 size={16} /><input value={props.query} onChange={(event) => { props.onQuery(event.currentTarget.value) }} placeholder={props.t('githubSearchPlaceholder')} aria-label={props.t('githubSearchPlaceholder')} /></label>
            <button type="submit"><IconSearchOutline16 size={16} />{props.t('search')}</button>
          </form>
          <CandidateNotice t={props.t} />
          <RepositoryState state={props.repositories} empty={props.t('githubEmpty')} onCreate={props.onCreate} onRetry={() => { props.onSearch() }} t={props.t} />
        </>
      )}
    </div>
  )
}

function DshmkDiscovery(props: {
  readonly desktopAvailable: boolean
  readonly detailContent: HubDetailContent
  readonly detailEntry: HubDetailEntry
  readonly detailMode: HubDetailMode
  readonly installedIds: ReadonlySet<string>
  readonly onInstalled: () => void
  readonly onRestartDesktop: () => Promise<void>
  readonly pageSize: HubPreferences['pageSize']
  readonly requestHub: SetupHubDesktopSurfaceProps['requestHub']
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState('all')
  const [category, setCategory] = useState('all')
  const [projectType, setProjectType] = useState('all')
  const [validation, setValidation] = useState('all')
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<HubPreferences['pageSize']>(props.pageSize)
  const [requestVersion, setRequestVersion] = useState(0)
  const [catalog, setCatalog] = useState<AsyncState<HubDshmkCatalogPage>>({ status: 'loading' })
  const [selected, setSelected] = useState<HubDshmkProject | undefined>()
  const [detail, setDetail] = useState<AsyncState<HubDshmkDetail>>({ status: 'idle' })
  const [installSurface, setInstallSurface] = useState<DshmkInstallSurface>({ status: 'idle' })
  const scrollPosition = useRef(0)

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      setCatalog({ status: 'loading' })
      void props.requestHub<HubDshmkCatalogPage>('dshmk-catalog', { category, page, pageSize, projectType, query, searchScope, sort, validation }).then(
        (value) => {
          if (!current) return
          if (!isDshmkCatalogPage(value)) {
            setCatalog({ status: 'error', message: props.t('catalogMalformed') })
            return
          }
          setCatalog({ status: 'ready', data: value })
          if (value.page !== page) setPage(value.page)
        },
        (error) => { if (current) setCatalog({ status: 'error', message: errorMessage(error) }) },
      )
    }, query.length === 0 ? 0 : 220)
    return () => { current = false; window.clearTimeout(timer) }
  }, [category, page, pageSize, projectType, props.requestHub, query, requestVersion, searchScope, sort, validation])

  const resetPage = (action: () => void): void => { action(); setPage(1) }
  const openDetail = (project: HubDshmkProject): void => {
    const host = document.querySelector<HTMLElement>('main[data-section="github"]')
    scrollPosition.current = host?.scrollTop ?? 0
    setSelected(project)
    setDetail({ status: 'loading' })
    void props.requestHub<HubDshmkDetail>('dshmk-detail', { repositoryId: project.repositoryId }).then(
      (value) => { setDetail({ status: 'ready', data: value }) },
      (error) => { setDetail({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const closeDetail = (): void => {
    setSelected(undefined)
    setDetail({ status: 'idle' })
    window.requestAnimationFrame(() => {
      const host = document.querySelector<HTMLElement>('main[data-section="github"]')
      if (host !== null) host.scrollTop = scrollPosition.current
    })
  }
  const installProject = (project: HubDshmkProject): void => {
    const initial: HubInstallProgress = { detail: project.install.candidate.command ?? '', message: props.t('setupStagePreflightBody'), percent: 4, stage: 'preflight', timestamp: new Date().toISOString() }
    setInstallSurface({ status: 'running', project, progress: initial, logs: [initial] })
    void props.requestHub<HubDshmkInstallResult>('dshmk-install', { repositoryId: project.repositoryId }, {
      onProgress: (progress) => {
        setInstallSurface(current => current.status !== 'running' || current.project.repositoryId !== project.repositoryId
          ? current
          : { ...current, progress, logs: [...current.logs, progress].slice(-12) })
      },
    }).then(
      (result) => {
        setInstallSurface(current => ({ status: 'success', project, result, logs: current.status === 'running' ? current.logs : [] }))
        props.onInstalled()
      },
      (error) => {
        setInstallSurface(current => ({ status: 'error', project, message: errorMessage(error), logs: current.status === 'running' ? current.logs : [] }))
      },
    )
  }
  const cancelInstall = (): void => {
    if (installSurface.status !== 'running') return
    void props.requestHub<{ readonly cancelled: boolean }>('setup-cancel').catch(() => undefined)
  }
  const changePageSize = (value: string): void => {
    const next = Number(value)
    if (next !== 12 && next !== 24 && next !== 48 && next !== 96 && next !== 200) return
    setPageSize(next)
    setPage(1)
    void props.requestHub<Record<string, never>>('hub-save-preferences', { pageSize: next }).catch(() => undefined)
  }

  const data = catalog.status === 'ready' ? catalog.data : undefined
  const categoryOptions = [{ value: 'all', label: props.t('allCategories') }, ...(data?.categories.map(item => ({ value: item.id, label: `${dshmkCategoryLabel(item.id, resolveLanguage())} · ${item.count}` })) ?? [])]
  const typeOptions = [{ value: 'all', label: props.t('allProjectTypes') }, ...(data?.projectTypes.map(item => ({ value: item.id, label: `${dshmkTypeLabel(item.id, resolveLanguage())} · ${item.count}` })) ?? [])]
  const sourceKey: SetupHubLocaleKey = data?.sourceMode === 'cache' ? 'registry_cache' : data?.sourceMode === 'bundled' ? 'registry_bundled' : 'registry_live'

  return (
    <section className={css.dshmkWorkspace}>
      <div className={css.dshmkHero}>
        <div>
          <span className={css.marketSource} data-mode={data?.sourceMode ?? 'live'}>{props.t(sourceKey)}</span>
          <strong>{props.t('dshmkCatalogTitle')}</strong>
          <p>{props.t('dshmkCatalogBody')}</p>
        </div>
        <dl>
          <div><dt>{props.t('dshmkProjects')}</dt><dd>{data?.total ?? '—'}</dd></div>
          <div><dt>{props.t('dshmkGenerated')}</dt><dd>{formatDate(data?.generatedAt, resolveLanguage(), 'UTC')}</dd></div>
          <div><dt>{props.t('pageSize')}</dt><dd>{pageSize}</dd></div>
        </dl>
      </div>
      <div className={css.dshmkToolbar}>
        <label className={css.searchBox}><IconSearchOutline16 size={16} /><input value={query} onChange={(event) => { resetPage(() => { setQuery(event.currentTarget.value) }) }} placeholder={props.t('dshmkSearchPlaceholder')} aria-label={props.t('dshmkSearchPlaceholder')} /></label>
        <ChoiceMenu label={props.t('sortLabel')} value={sort} options={[
          { value: 'recommended', label: props.t('recommended') }, { value: 'stars', label: props.t('stars') },
          { value: 'updated', label: props.t('updated') }, { value: 'newest', label: props.t('newest') }, { value: 'name', label: props.t('nameSort') },
        ]} onChange={(value) => { resetPage(() => { setSort(value) }) }} />
        <DshmkFilterMenu
          category={category}
          categoryOptions={categoryOptions}
          onCategory={(value) => { resetPage(() => { setCategory(value) }) }}
          onPageSize={changePageSize}
          onProjectType={(value) => { resetPage(() => { setProjectType(value) }) }}
          onReset={() => {
            setCategory('all')
            setProjectType('all')
            setValidation('all')
            setSearchScope('all')
            setPageSize(props.pageSize)
            setPage(1)
          }}
          onSearchScope={(value) => { resetPage(() => { setSearchScope(value) }) }}
          onValidation={(value) => { resetPage(() => { setValidation(value) }) }}
          pageSize={pageSize}
          projectType={projectType}
          searchScope={searchScope}
          t={props.t}
          typeOptions={typeOptions}
          validation={validation}
        />
        <button className={css.refreshButton} type="button" onClick={() => { setRequestVersion(value => value + 1) }} aria-label={props.t('retry')} title={props.t('retry')}><IconRefreshOutline16 size={16} /></button>
      </div>
      {catalog.status === 'loading' || catalog.status === 'idle' ? <HubLoading t={props.t} compact /> : null}
      {catalog.status === 'error' ? <HubFailure message={catalog.message} onRetry={() => { setRequestVersion(value => value + 1) }} t={props.t} /> : null}
      {data !== undefined ? (
        <>
          <div className={css.resultSummary}><span>{props.t('showingResults').replace('{count}', String(data.total))}</span><span>{props.t('dshmkAttribution')}</span></div>
          {data.items.length === 0 ? <EmptyState title={props.t('communityEmpty')} body={props.t('tryAnotherSearch')} /> : (
            <div className={css.dshmkGrid}>{data.items.map(project => (
              <DshmkCard
                key={project.repositoryId}
                busy={installSurface.status === 'running' && installSurface.project.repositoryId === project.repositoryId}
                desktopAvailable={props.desktopAvailable}
                detailEntry={props.detailEntry}
                installed={props.installedIds.has(`dshmk-${project.repositoryId}`) || installSurface.status === 'success' && installSurface.project.repositoryId === project.repositoryId}
                onInstall={installProject}
                onOpen={openDetail}
                project={project}
                t={props.t}
              />
            ))}</div>
          )}
          <DshmkPagination current={data.page} total={data.totalPages} onPage={setPage} t={props.t} />
        </>
      ) : null}
      {selected === undefined ? null : (
        <DshmkDetailSurface
          content={props.detailContent}
          detail={detail}
          installed={props.installedIds.has(`dshmk-${selected.repositoryId}`) || installSurface.status === 'success' && installSurface.project.repositoryId === selected.repositoryId}
          mode={props.detailMode}
          onClose={closeDetail}
          onInstall={installProject}
          onOpenRelated={openDetail}
          project={selected}
          t={props.t}
        />
      )}
      {installSurface.status === 'idle' ? null : (
        <SetupProgressSurface
          error={installSurface.status === 'error' ? installSurface.message : undefined}
          icon={<DshmkProjectIcon project={installSurface.project} />}
          logs={installSurface.logs}
          name={installSurface.project.name}
          onActivate={props.onRestartDesktop}
          onCancel={cancelInstall}
          onClose={() => { setInstallSurface({ status: 'idle' }) }}
          onRetry={() => { installProject(installSurface.project) }}
          progress={installSurface.status === 'running' ? installSurface.progress : undefined}
          reference={installSurface.project.install.candidate.command ?? props.t('localBuildRequired')}
          requestHub={props.requestHub}
          status={installSurface.status}
          subtitle={installSurface.project.fullName}
          successDetail={installSurface.status === 'success' ? `${installSurface.result.message} ${props.t('activeBundles')}: ${installSurface.result.activeBundles.join(', ')}` : undefined}
          t={props.t}
        />
      )}
    </section>
  )
}

function DshmkCard(props: {
  readonly busy: boolean
  readonly desktopAvailable: boolean
  readonly detailEntry: HubDetailEntry
  readonly installed: boolean
  readonly onInstall: (project: HubDshmkProject) => void
  readonly onOpen: (project: HubDshmkProject) => void
  readonly project: HubDshmkProject
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const project = props.project
  const body = (
    <>
      <div className={css.communityTop}>
        <DshmkProjectIcon project={project} />
        <div><strong>{project.name}</strong><span>{project.fullName}</span></div>
        <b>★ {project.stars}</b>
      </div>
      <p>{project.description || props.t('noDescription')}</p>
      <div className={css.cardTags}>{project.categories.slice(0, 4).map(tag => <i key={tag}>{dshmkCategoryLabel(tag, resolveLanguage())}</i>)}</div>
      <div className={css.dshmkEvidenceRow}>
        <span data-verified={project.verified || undefined}><IconCheckOutline16 size={14} />{project.validation.label || project.validation.overall}</span>
        <span>{dshmkTypeLabel(project.projectType, resolveLanguage())}</span>
        <span>{project.language || props.t('unknown')}</span>
      </div>
    </>
  )
  return (
    <article className={css.dshmkCard}>
      {props.detailEntry === 'card'
        ? <button className={css.dshmkCardBody} data-clickable="true" type="button" onClick={() => { props.onOpen(project) }}>{body}</button>
        : <div className={css.dshmkCardBody}>{body}</div>}
      <div className={css.communityActions}>
        <a href={project.url} target="_blank" rel="noreferrer" onClick={(event) => { event.stopPropagation() }}>{props.t('viewRepository')} <IconRightUpOutline14 /></a>
        {props.detailEntry === 'button' ? <button className={css.secondaryAction} type="button" onClick={() => { props.onOpen(project) }}><IconDataOutline16 size={15} />{props.t('details')}</button> : null}
        <button type="button" data-busy={props.busy || undefined} disabled={!props.desktopAvailable || !project.installable || props.busy || props.installed} onClick={() => { props.onInstall(project) }}>
          {props.busy ? <IconRefreshOutline16 size={15} /> : props.installed ? <IconCheckOutline16 size={15} /> : <IconDownloadOutline16 size={15} />}
          {props.busy ? props.t('installing') : props.installed ? props.t('installedShort') : project.installable ? props.t('oneClickSetup') : props.t('localBuildRequired')}
        </button>
      </div>
    </article>
  )
}

function DshmkProjectIcon({ project }: { readonly project: HubDshmkProject }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed || project.owner.avatarUrl.length === 0) return <span className={css.communityAvatar} aria-hidden="true"><IconCordisPluginOutline14 size={18} /></span>
  return <img className={css.communityAvatar} src={project.owner.avatarUrl} alt="" loading="lazy" onError={() => { setFailed(true) }} />
}

function DshmkFilterMenu(props: {
  readonly category: string
  readonly categoryOptions: readonly { readonly label: string; readonly value: string }[]
  readonly onCategory: (value: string) => void
  readonly onPageSize: (value: string) => void
  readonly onProjectType: (value: string) => void
  readonly onReset: () => void
  readonly onSearchScope: (value: string) => void
  readonly onValidation: (value: string) => void
  readonly pageSize: HubPreferences['pageSize']
  readonly projectType: string
  readonly searchScope: string
  readonly t: SetupHubDesktopSurfaceProps['t']
  readonly typeOptions: readonly { readonly label: string; readonly value: string }[]
  readonly validation: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const activeCount = [props.category !== 'all', props.projectType !== 'all', props.validation !== 'all', props.searchScope !== 'all'].filter(Boolean).length
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => { if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div className={css.dshmkFilterMenu} ref={root} data-open={open || undefined}>
      <button className={css.filterTrigger} type="button" aria-expanded={open} onClick={() => { setOpen(value => !value) }}><IconSettingsOutline16 size={16} /><span>{props.t('filters')}</span>{activeCount === 0 ? null : <b>{activeCount}</b>}</button>
      <div className={css.filterPopover} role="dialog" aria-label={props.t('filters')}>
        <header><div><strong>{props.t('filterTitle')}</strong><span>{props.t('filterIntro')}</span></div><button type="button" onClick={props.onReset}>{props.t('resetFilters')}</button></header>
        <FilterChoiceGroup label={props.t('searchScope')} value={props.searchScope} options={[
          { value: 'all', label: props.t('searchEverywhere') }, { value: 'name', label: props.t('searchName') }, { value: 'owner', label: props.t('searchOwner') },
          { value: 'description', label: props.t('searchDescription') }, { value: 'language', label: props.t('searchLanguage') }, { value: 'topics', label: props.t('searchTags') },
        ]} onChange={props.onSearchScope} />
        <FilterChoiceGroup label={props.t('communityCategories')} value={props.category} options={props.categoryOptions} onChange={props.onCategory} />
        <FilterChoiceGroup label={props.t('projectType')} value={props.projectType} options={props.typeOptions} onChange={props.onProjectType} />
        <FilterChoiceGroup label={props.t('validationFilter')} value={props.validation} options={[
          { value: 'all', label: props.t('allValidation') }, { value: 'verified', label: props.t('verifiedOnly') },
          { value: 'installable', label: props.t('installableOnly') }, { value: 'local', label: props.t('localBuildOnly') },
        ]} onChange={props.onValidation} />
        <FilterChoiceGroup label={props.t('pageSize')} value={String(props.pageSize)} options={[12, 24, 48, 96, 200].map(value => ({ value: String(value), label: `${value} / ${props.t('page')}` }))} onChange={props.onPageSize} />
      </div>
    </div>
  )
}

function FilterChoiceGroup(props: { readonly label: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly label: string; readonly value: string }[]; readonly value: string }): ReactNode {
  return <section className={css.filterChoiceGroup}><strong>{props.label}</strong><div>{props.options.map(option => <button type="button" key={option.value} data-active={option.value === props.value || undefined} onClick={() => { props.onChange(option.value) }}>{option.label}{option.value === props.value ? <IconCheckOutline16 size={14} /> : null}</button>)}</div></section>
}

function DshmkPagination(props: { readonly current: number; readonly onPage: (page: number) => void; readonly t: SetupHubDesktopSurfaceProps['t']; readonly total: number }): ReactNode {
  if (props.total <= 1) return null
  return (
    <nav className={css.pagination} aria-label={props.t('pagination')}>
      <button type="button" disabled={props.current <= 1} onClick={() => { props.onPage(1) }}>{props.t('firstPage')}</button>
      <button type="button" disabled={props.current <= 1} onClick={() => { props.onPage(props.current - 1) }}>{props.t('previousPage')}</button>
      {communityPageItems(props.current, props.total).map((item, index) => item === '…' ? <span key={`gap-${index}`}>…</span> : <button type="button" key={item} aria-current={item === props.current ? 'page' : undefined} data-active={item === props.current || undefined} onClick={() => { props.onPage(item) }}>{item}</button>)}
      <button type="button" disabled={props.current >= props.total} onClick={() => { props.onPage(props.current + 1) }}>{props.t('nextPage')}</button>
      <button type="button" disabled={props.current >= props.total} onClick={() => { props.onPage(props.total) }}>{props.t('lastPage')}</button>
    </nav>
  )
}

function DshmkDetailSurface(props: {
  readonly content: HubDetailContent
  readonly detail: AsyncState<HubDshmkDetail>
  readonly installed: boolean
  readonly mode: HubDetailMode
  readonly onClose: () => void
  readonly onInstall: (project: HubDshmkProject) => void
  readonly onOpenRelated: (project: HubDshmkProject) => void
  readonly project: HubDshmkProject
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const project = props.detail.status === 'ready' ? props.detail.data.project : props.project
  return (
    <div className={css.detailBackdrop} data-mode={props.mode} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && props.mode !== 'full') props.onClose() }}>
      <section className={css.dshmkDetailSurface} data-mode={props.mode} role="dialog" aria-modal="true" aria-label={project.name}>
        <header className={css.dshmkDetailHeader}>
          <div className={css.communityTop}><DshmkProjectIcon project={project} /><div><strong>{project.name}</strong><span>{project.fullName}</span></div></div>
          <div><a href={project.url} target="_blank" rel="noreferrer">{props.t('viewRepository')} <IconRightUpOutline14 /></a><button type="button" onClick={props.onClose} aria-label={props.t('closeDetails')}>×</button></div>
        </header>
        {props.content === 'original' ? (
          <div className={css.originalDetail}><iframe title={project.name} src={`https://dshmk.com/plugins/${project.repositoryId}`} sandbox="allow-forms allow-popups allow-same-origin allow-scripts" /><a href={`https://dshmk.com/plugins/${project.repositoryId}`} target="_blank" rel="noreferrer">{props.t('openOriginal')} <IconRightUpOutline14 /></a></div>
        ) : props.detail.status === 'loading' || props.detail.status === 'idle' ? <HubLoading t={props.t} compact />
          : props.detail.status === 'error' ? <HubFailure message={props.detail.message} onRetry={() => { props.onOpenRelated(props.project) }} t={props.t} />
            : <DshmkNativeDetail detail={props.detail.data} installed={props.installed} onInstall={props.onInstall} onOpenRelated={props.onOpenRelated} t={props.t} />}
      </section>
    </div>
  )
}

function DshmkNativeDetail(props: {
  readonly detail: HubDshmkDetail
  readonly installed: boolean
  readonly onInstall: (project: HubDshmkProject) => void
  readonly onOpenRelated: (project: HubDshmkProject) => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const project = props.detail.project
  const stages = Object.entries(project.validation.stages)
  return (
    <div className={css.dshmkDetailContent}>
      <div className={css.dshmkDetailLead}>
        <div><span>{dshmkCategoryLabel(project.category, resolveLanguage())}</span><h2>{project.name}</h2><p>{project.description || props.t('noDescription')}</p></div>
        <button type="button" disabled={!project.installable || props.installed} onClick={() => { props.onInstall(project) }}><IconDownloadOutline16 size={17} />{props.installed ? props.t('installedShort') : project.installable ? props.t('oneClickSetup') : props.t('localBuildRequired')}</button>
      </div>
      <div className={css.dshmkMetricGrid}>
        <article><span>{props.t('stars')}</span><strong>{project.stars}</strong></article>
        <article><span>{props.t('license')}</span><strong>{project.license || 'NOASSERTION'}</strong></article>
        <article><span>{props.t('validationEvidence')}</span><strong>{project.validation.label || project.validation.overall}</strong></article>
        <article><span>{props.t('sourceCommit')}</span><strong>{project.validation.sourceSha.slice(0, 12) || props.t('notPinned')}</strong></article>
      </div>
      <section className={css.installReference}>
        <div><span>{props.t('installReference')}</span><strong>{project.install.candidate.evidence?.heading ?? project.install.status}</strong></div>
        <code>{project.install.candidate.command ?? props.t('localBuildRequired')}</code>
        <small>{project.install.candidate.evidence?.source ?? 'dshmk'} · {project.install.candidate.evidence?.pattern ?? project.validation.platform}</small>
      </section>
      <div className={css.dshmkDetailColumns}>
        <section><h3>{props.t('validationEvidence')}</h3><div className={css.validationStages}>{stages.map(([id, stage]) => <div key={id}><IconCheckOutline16 size={15} /><span>{humanizeIdentifier(id)}</span><b>{stage.status ?? 'unknown'}</b></div>)}</div></section>
        <section><h3>{props.t('sourceCertificate')}</h3><dl><div><dt>{props.t('source')}</dt><dd>{project.fullName}</dd></div><div><dt>{props.t('projectType')}</dt><dd>{dshmkTypeLabel(project.projectType, resolveLanguage())}</dd></div><div><dt>{props.t('updated')}</dt><dd>{formatDate(project.updatedAt, resolveLanguage())}</dd></div><div><dt>{props.t('compatibility')}</dt><dd>{project.validation.dshVersion || 'DSH'}</dd></div></dl></section>
      </div>
      <section className={css.relatedProjects}><h3>{props.t('relatedProjects')}</h3><div>{props.detail.related.map(item => <button key={item.repositoryId} type="button" onClick={() => { props.onOpenRelated(item) }}><DshmkProjectIcon project={item} /><span><strong>{item.name}</strong><small>★ {item.stars} · {dshmkCategoryLabel(item.category, resolveLanguage())}</small></span></button>)}</div></section>
    </div>
  )
}

function SetupProgressSurface(props: {
  readonly error?: string | undefined
  readonly icon: ReactNode
  readonly logs: readonly HubInstallProgress[]
  readonly name: string
  readonly onActivate?: (() => Promise<void>) | undefined
  readonly onCancel: () => void
  readonly onClose: () => void
  readonly onRetry: () => void
  readonly progress?: HubInstallProgress | undefined
  readonly reference: string
  readonly requestHub: SetupHubDesktopSurfaceProps['requestHub']
  readonly status: 'running' | 'success' | 'error'
  readonly subtitle: string
  readonly successDetail?: string | undefined
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [activation, setActivation] = useState<AsyncState<string>>({ status: 'idle' })
  const [manualExpanded, setManualExpanded] = useState(false)
  const [manualImport, setManualImport] = useState<AsyncState<HubManualImportResult>>({ status: 'idle' })
  const running = props.status === 'running'
  const success = props.status === 'success'
  const progress = running ? props.progress : props.logs[props.logs.length - 1]
  const stageOrder: readonly HubInstallProgress['stage'][] = ['preflight', 'download', 'install', 'profile', 'activation', 'verify']
  const currentIndex = progress === undefined ? -1 : stageOrder.indexOf(progress.stage)
  const downloadedBytes = progress?.stage === 'download' ? progress.downloadedBytes : undefined
  const totalBytes = progress?.stage === 'download' ? progress.totalBytes : undefined
  const downloadPercent = downloadedBytes === undefined || totalBytes === undefined || totalBytes <= 0
    ? undefined
    : Math.max(0, Math.min(100, downloadedBytes * 100 / totalBytes))
  const manualDownloads = running && progress?.stage === 'download' ? progress.manualDownloads ?? [] : []
  useEffect(() => {
    setActivation({ status: 'idle' })
    setManualExpanded(false)
    setManualImport({ status: 'idle' })
  }, [props.name, props.status])
  const activateDesktop = (): void => {
    if (props.onActivate === undefined || activation.status === 'loading') return
    setActivation({ status: 'loading' })
    void props.onActivate().then(
      () => { setActivation({ status: 'ready', data: props.t('desktopReloadRequested') }) },
      (error) => { setActivation({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const openManualUrl = (downloadId: string, target: 'download' | 'repository'): void => {
    setManualImport({ status: 'idle' })
    void props.requestHub<Record<string, never>>('setup-open-manual-url', { downloadId, target }).catch((error) => {
      setManualImport({ status: 'error', message: errorMessage(error) })
    })
  }
  const importManualDownload = (downloadId: string): void => {
    if (manualImport.status === 'loading') return
    setManualImport({ status: 'loading' })
    void props.requestHub<HubManualImportResult>('setup-manual-import', { downloadId }, { timeoutMs: 15 * 60 * 1000 }).then(
      (result) => { setManualImport(result.cancelled ? { status: 'idle' } : { status: 'ready', data: result }) },
      (error) => { setManualImport({ status: 'error', message: errorMessage(error) }) },
    )
  }
  return (
    <div className={css.setupBackdrop} role="presentation">
      <section className={css.setupProgressSurface} role="dialog" aria-modal="true" aria-label={props.t('setupProgressTitle')}>
        <header>{props.icon}<div><span>{props.t('setupProgressTitle')}</span><strong>{props.name}</strong><small>{props.subtitle}</small></div>{running ? null : <button type="button" onClick={props.onClose} aria-label={props.t('close')}>×</button>}</header>
        <div className={css.setupDeclaration}><span>{props.t('installReference')}</span><code>{props.reference}</code></div>
        <ol className={css.setupStages}>{stageOrder.map((stage, index) => <li key={stage} data-active={index === currentIndex || undefined} data-complete={index < currentIndex || success || undefined}><span>{index < currentIndex || success ? <IconCheckOutline16 size={15} /> : index + 1}</span><div><strong>{props.t(setupStageTitle(stage))}</strong><small>{props.t(setupStageBody(stage))}</small></div></li>)}</ol>
        <div className={css.setupProgressBar} aria-label={props.t('setupProgressTitle')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? (success ? 100 : 0)} role="progressbar"><span style={{ width: `${progress?.percent ?? (success ? 100 : 0)}%` }} /></div>
        {downloadedBytes === undefined ? null : (
          <div className={css.setupDownloadProgress}>
            <div className={css.setupDownloadSummary}><strong>{props.t('downloadProgress')}</strong>{manualDownloads.length === 0 ? null : <button type="button" onClick={() => { setManualExpanded(value => !value) }}>{props.t('manualDownload')}</button>}<span>{totalBytes !== undefined && totalBytes > 0 ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} · ${Math.round(downloadPercent ?? 0)}%` : `${formatBytes(downloadedBytes)} · ${props.t('downloadTotalUnknown')}`}</span></div>
            <div className={css.setupDownloadBar} data-indeterminate={downloadPercent === undefined || undefined} aria-label={props.t('downloadProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent === undefined ? undefined : Math.round(downloadPercent)} role="progressbar"><span style={downloadPercent === undefined ? undefined : { width: `${downloadPercent}%` }} /></div>
          </div>
        )}
        {!manualExpanded || manualDownloads.length === 0 ? null : (
          <section className={css.manualDownloadPanel} aria-label={props.t('manualDownloadTitle')}>
            <header><div><strong>{props.t('manualDownloadTitle')}</strong><span>{props.t('manualDownloadBody')}</span></div><button type="button" onClick={() => { setManualExpanded(false) }} aria-label={props.t('close')}>×</button></header>
            <div className={css.manualDownloadList}>{manualDownloads.map(download => (
              <article key={download.id}>
                <div><strong>{download.fileName}</strong><span>{download.bytes === undefined ? props.t('downloadSizeUnknown') : formatBytes(download.bytes)}</span></div>
                <dl><div><dt>{props.t('downloadAddress')}</dt><dd>{download.downloadUrl}</dd></div><div><dt>{props.t('repositoryAddress')}</dt><dd>{download.repositoryUrl}</dd></div>{download.sha256 === undefined ? null : <div><dt>SHA-256</dt><dd>{download.sha256}</dd></div>}</dl>
                <footer><button type="button" onClick={() => { openManualUrl(download.id, 'download') }}><IconDownloadOutline16 size={15} />{props.t('openDownload')}</button><button type="button" onClick={() => { openManualUrl(download.id, 'repository') }}><IconRightUpOutline14 />{props.t('openRepository')}</button><button type="button" data-busy={manualImport.status === 'loading' || undefined} disabled={manualImport.status === 'loading'} onClick={() => { importManualDownload(download.id) }}><IconFolderOpenOutline16 size={15} />{manualImport.status === 'loading' ? props.t('validatingManualFile') : props.t('selectDownloadedFile')}</button></footer>
              </article>
            ))}</div>
            {manualImport.status === 'ready' ? <p role="status">{props.t('manualImportComplete').replace('{file}', manualImport.data.fileName ?? props.t('unknown'))}</p> : null}
            {manualImport.status === 'error' ? <p role="alert">{manualImport.message}</p> : null}
          </section>
        )}
        <div className={css.setupLog}>
          <strong>{success ? props.t('installationComplete') : props.status === 'error' ? props.t('installationFailed') : progress?.message ?? props.t('setupProgressBody')}</strong>
          {props.error === undefined ? null : <p role="alert">{props.error}</p>}
          {props.logs.slice(-5).map((entry, index) => <p key={`${entry.timestamp}-${index}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.detail || entry.message}</span></p>)}
          {success && props.successDetail !== undefined ? <p><span>{props.successDetail}</span></p> : null}
          {activation.status === 'ready' ? <p><span>{activation.data}</span></p> : null}
          {activation.status === 'error' ? <p role="alert">{props.t('desktopReloadFailed')}: {activation.message}</p> : null}
        </div>
        <footer>
          {running ? <button className={css.dangerButton} type="button" onClick={props.onCancel}>{props.t('cancelInstall')}</button> : null}
          {props.status === 'error' ? <button type="button" onClick={props.onRetry}><IconRefreshOutline16 size={15} />{props.t('retryInstall')}</button> : null}
          {success && props.onActivate !== undefined ? <button type="button" data-busy={activation.status === 'loading' || undefined} disabled={activation.status === 'loading'} onClick={activateDesktop}><IconRefreshOutline16 size={15} />{activation.status === 'loading' ? props.t('reloadingDesktop') : props.t('reloadDesktop')}</button> : null}
          {!running ? <button type="button" onClick={props.onClose}>{props.t('close')}</button> : null}
        </footer>
      </section>
    </div>
  )
}

function ChoiceMenu(props: { readonly label: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly label: string; readonly value: string }[]; readonly value: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = props.options.find(option => option.value === props.value) ?? props.options[0]
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => { if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div className={css.choiceMenu} ref={root} data-open={open || undefined}>
      <button type="button" aria-expanded={open} onClick={() => { setOpen(value => !value) }}><span><small>{props.label}</small><strong>{selected?.label ?? props.value}</strong></span><b>⌄</b></button>
      <div className={css.choicePopover} role="listbox" aria-label={props.label}>{props.options.map(option => <button type="button" key={option.value} role="option" aria-selected={option.value === props.value} data-active={option.value === props.value || undefined} onClick={() => { props.onChange(option.value); setOpen(false) }}>{option.label}{option.value === props.value ? <IconCheckOutline16 size={15} /> : null}</button>)}</div>
    </div>
  )
}

function setupStageTitle(stage: HubInstallProgress['stage']): SetupHubLocaleKey {
  if (stage === 'preflight') return 'setupStagePreflight'
  if (stage === 'download') return 'setupStageDownload'
  if (stage === 'install') return 'setupStageInstall'
  if (stage === 'profile') return 'setupStageProfile'
  if (stage === 'activation') return 'setupStageActivation'
  return 'setupStageVerify'
}

function setupStageBody(stage: HubInstallProgress['stage']): SetupHubLocaleKey {
  if (stage === 'preflight') return 'setupStagePreflightBody'
  if (stage === 'download') return 'setupStageDownloadBody'
  if (stage === 'install') return 'setupStageInstallBody'
  if (stage === 'profile') return 'setupStageProfileBody'
  if (stage === 'activation') return 'setupStageActivationBody'
  return 'setupStageVerifyBody'
}

function dshmkCategoryLabel(value: string, language: 'zh' | 'en'): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    development: ['开发工具', 'Development'], ui: ['界面增强', 'UI'], data: ['数据与知识', 'Data'],
    'agent-session': ['Agent 与会话', 'Agent & session'], security: ['安全', 'Security'], 'model-mcp': ['模型与 MCP', 'Model & MCP'],
  }
  return labels[value]?.[language === 'zh' ? 0 : 1] ?? humanizeIdentifier(value)
}

function dshmkTypeLabel(value: string, language: 'zh' | 'en'): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    plugin: ['插件', 'Plugin'], skill: ['Skill', 'Skill'], collection: ['合集', 'Collection'], directory: ['目录', 'Directory'], channel: ['渠道', 'Channel'], application: ['应用', 'Application'], infrastructure: ['基础设施', 'Infrastructure'], unknown: ['未知', 'Unknown'],
  }
  return labels[value]?.[language === 'zh' ? 0 : 1] ?? humanizeIdentifier(value)
}

function humanizeIdentifier(value: string): string { return value.split('-').filter(Boolean).map(part => (part[0] ?? '').toLocaleUpperCase() + part.slice(1)).join(' ') || '—' }

function CommunityDiscovery(props: {
  readonly desktopAvailable: boolean
  readonly installs: Readonly<Record<string, InstallState>>
  readonly onCreate: (plugin: HubCommunityPlugin) => void
  readonly onInstall: (plugin: HubCommunityPlugin) => void
  readonly onRetry: () => void
  readonly state: AsyncState<HubCommunityRegistry>
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CommunitySort>('recommended')
  const [timeRange, setTimeRange] = useState<CommunityTimeRange>('all')
  const [page, setPage] = useState(1)
  const language = resolveLanguage()
  const registry = props.state.status === 'ready' ? props.state.data : undefined
  const visible = useMemo(() => registry === undefined ? [] : visibleCommunityPlugins(registry, { category, language, query, sort, timeRange }), [category, language, query, registry, sort, timeRange])
  const counts = useMemo(() => registry === undefined ? new Map<string, number>() : communityCategoryCounts(registry), [registry])
  const pageSize = 18
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const pagePlugins = visible.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize)
  useEffect(() => { setPage(1) }, [category, query, sort, timeRange])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])

  if (props.state.status === 'idle' || props.state.status === 'loading') return <HubLoading t={props.t} compact />
  if (props.state.status === 'error') return <HubFailure message={props.state.message} onRetry={props.onRetry} t={props.t} />
  return (
    <>
      <div className={css.marketHero}>
        <div><span className={css.marketSource} data-mode={props.state.data.sourceMode}>{props.t(`registry_${props.state.data.sourceMode}`)}</span><strong>{props.t('communityCatalogTitle')}</strong><p>{props.t('communityCatalogBody')}</p></div>
        <dl><div><dt>{props.t('communityEntries')}</dt><dd>{props.state.data.count}</dd></div><div><dt>{props.t('communityCategories')}</dt><dd>{Object.keys(props.state.data.categories).length}</dd></div><div><dt>{props.t('registryUpdated')}</dt><dd>{formatDate(props.state.data.updated, language)}</dd></div></dl>
      </div>
      <div className={css.communityFilters}>
        <label className={css.searchBox}><IconSearchOutline16 size={16} /><input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} placeholder={props.t('communitySearchPlaceholder')} aria-label={props.t('communitySearchPlaceholder')} /></label>
        <label><span>{props.t('sortLabel')}</span><select value={sort} onChange={(event) => { setSort(event.currentTarget.value as CommunitySort) }} onWheel={(event) => { event.currentTarget.blur() }}><option value="recommended">{props.t('recommended')}</option><option value="stars">{props.t('stars')}</option><option value="newest">{props.t('newest')}</option><option value="name">{props.t('nameSort')}</option></select></label>
        <label><span>{props.t('publishedWithin')}</span><select value={timeRange} onChange={(event) => { setTimeRange(event.currentTarget.value as CommunityTimeRange) }} onWheel={(event) => { event.currentTarget.blur() }}><option value="all">{props.t('allTime')}</option><option value="week">{props.t('lastWeek')}</option><option value="month">{props.t('lastMonth')}</option><option value="quarter">{props.t('lastQuarter')}</option><option value="year">{props.t('lastYear')}</option></select></label>
      </div>
      <div className={css.categoryChips} aria-label={props.t('communityCategories')}>
        <button type="button" data-active={category === 'all' || undefined} onClick={() => { setCategory('all') }}>{props.t('allCategories')} <b>{props.state.data.plugins.length}</b></button>
        {Object.entries(props.state.data.categories).map(([id, text]) => <button type="button" key={id} data-active={category === id || undefined} onClick={() => { setCategory(id) }}>{text[language] ?? text.en ?? id} <b>{counts.get(id) ?? 0}</b></button>)}
      </div>
      <div className={css.resultSummary}><span>{props.t('showingResults').replace('{count}', String(visible.length))}</span><span>{props.t('communityAttribution')}</span></div>
      {pagePlugins.length === 0 ? <EmptyState title={props.t('communityEmpty')} body={props.t('tryAnotherSearch')} /> : (
        <div className={css.communityGrid}>{pagePlugins.map(plugin => <CommunityCard key={plugin.url} desktopAvailable={props.desktopAvailable} install={props.installs[plugin.url] ?? { status: 'idle' }} onCreate={props.onCreate} onInstall={props.onInstall} plugin={plugin} t={props.t} />)}</div>
      )}
      {totalPages > 1 ? <Pagination current={Math.min(page, totalPages)} total={totalPages} onPage={setPage} t={props.t} /> : null}
    </>
  )
}

function CommunityCard(props: {
  readonly desktopAvailable: boolean
  readonly install: InstallState
  readonly onCreate: (plugin: HubCommunityPlugin) => void
  readonly onInstall: (plugin: HubCommunityPlugin) => void
  readonly plugin: HubCommunityPlugin
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const plugin = props.plugin
  const installable = communitySupportsOneClick(plugin)
  const busy = props.install.status === 'installing'
  const installed = props.install.status === 'installed'
  return (
    <article className={css.communityCard}>
      <div className={css.communityTop}><CommunityOwnerAvatar owner={plugin.owner} /><div><strong>{plugin.name}</strong><span>{plugin.owner}</span></div><b>★ {plugin.stars ?? 0}</b></div>
      <p>{plugin.description?.[resolveLanguage()] ?? plugin.description?.en ?? props.t('noDescription')}</p>
      <div className={css.communityMeta}><span>{plugin.category}</span>{typeof plugin.npm === 'string' && plugin.npm.trim().length > 0 ? <span>npm</span> : null}<span>{formatDate(plugin.added ?? undefined, resolveLanguage())}</span></div>
      <div className={css.communityEvidence}><IconCheckOutline16 size={14} /><span>{installable ? props.t('nativePreflight') : props.t('localBuildRequired')}</span></div>
      {props.install.status === 'error' ? <p className={css.cardError} role="alert">{props.install.message}</p> : null}
      {installed ? <p className={css.cardSuccess}><IconCheckOutline16 size={14} />{props.t('installed')}</p> : null}
      <div className={css.communityActions}>
        <a href={plugin.url} target="_blank" rel="noreferrer">{props.t('viewRepository')} <IconRightUpOutline14 /></a>
        {!installable ? <button type="button" onClick={() => { props.onCreate(plugin) }}><IconCodeOutline16 size={15} />{props.t('buildLocalSetup')}</button> : <><button className={css.secondaryAction} type="button" onClick={() => { props.onCreate(plugin) }}>{props.t('advancedBuild')}</button><button type="button" data-busy={busy || undefined} disabled={!props.desktopAvailable || busy || installed} onClick={() => { props.onInstall(plugin) }}>{busy ? <IconRefreshOutline16 size={15} /> : installed ? <IconCheckOutline16 size={15} /> : <IconDownloadOutline16 size={15} />}{busy ? props.t('preparingSetup') : installed ? props.t('installedShort') : props.t('oneClickSetup')}</button></>}
      </div>
    </article>
  )
}

function CommunityOwnerAvatar(props: { readonly owner: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed || props.owner.length === 0) {
    return <span className={css.communityAvatar} aria-hidden="true"><IconCordisPluginOutline14 size={18} /></span>
  }
  return <img className={css.communityAvatar} src={`https://github.com/${encodeURIComponent(props.owner)}.png?size=96`} alt="" loading="lazy" onError={() => { setFailed(true) }} />
}

function Pagination(props: { readonly current: number; readonly onPage: (page: number) => void; readonly t: SetupHubDesktopSurfaceProps['t']; readonly total: number }): ReactNode {
  return <nav className={css.pagination} aria-label={props.t('pagination')}><button type="button" disabled={props.current <= 1} onClick={() => { props.onPage(props.current - 1) }}>{props.t('previousPage')}</button>{communityPageItems(props.current, props.total).map((item, index) => item === '…' ? <span key={`gap-${index}`}>…</span> : <button type="button" key={item} aria-current={item === props.current ? 'page' : undefined} data-active={item === props.current || undefined} onClick={() => { props.onPage(item) }}>{item}</button>)}<button type="button" disabled={props.current >= props.total} onClick={() => { props.onPage(props.current + 1) }}>{props.t('nextPage')}</button></nav>
}

function StarredView(props: {
  readonly account: HubGitHubAccount
  readonly repositories: AsyncState<readonly HubGitHubRepository[]>
  readonly onCreate: (repository: HubGitHubRepository) => void
  readonly onOpenAccount: () => void
  readonly onRefresh: () => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('starredEyebrow')} title={props.t('starredTitle')} description={props.t('starredIntro')} />
      {props.account.authenticated ? <CandidateNotice t={props.t} /> : null}
      {props.account.authenticated
        ? <RepositoryState state={props.repositories} empty={props.t('starredEmpty')} onCreate={props.onCreate} onRetry={props.onRefresh} t={props.t} />
        : <div className={css.accountPrompt}><IconUserOutline16 size={24} /><strong>{props.t('loginRequired')}</strong><span>{props.t('loginRequiredBody')}</span><button type="button" onClick={props.onOpenAccount}>{props.t('openAccountArea')}</button></div>}
    </div>
  )
}

function AccountView(props: {
  readonly account: HubGitHubAccount
  readonly action: AsyncState<string>
  readonly onLogin: (token: string) => void
  readonly onLogout: () => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('accountEyebrow')} title={props.t('accountTitle')} description={props.t('accountIntro')} />
      <GitHubAccountPanel {...props} />
      <div className={css.accountBenefits}>
        <article><IconLikeOutline16 size={18} /><div><strong>{props.t('accountStarsTitle')}</strong><span>{props.t('accountStarsBody')}</span></div></article>
        <article><IconDataOutline16 size={18} /><div><strong>{props.t('accountPrivacyTitle')}</strong><span>{props.t('accountPrivacyBody')}</span></div></article>
        <article><IconCheckOutline16 size={18} /><div><strong>{props.t('accountScopeTitle')}</strong><span>{props.t('accountScopeBody')}</span></div></article>
      </div>
    </div>
  )
}

function GitHubAccountPanel(props: {
  readonly account: HubGitHubAccount
  readonly action: AsyncState<string>
  readonly onLogin: (token: string) => void
  readonly onLogout: () => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const [token, setToken] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (token.trim().length === 0) return
    props.onLogin(token.trim())
    setToken('')
  }
  if (props.account.authenticated) {
    return (
      <div className={css.accountCard}>
        {props.account.avatarUrl === undefined ? <span className={css.accountAvatar}><IconUserOutline16 size={20} /></span> : <img className={css.accountAvatar} alt="" src={props.account.avatarUrl} />}
        <div><strong>{props.account.name ?? props.account.login}</strong><span>@{props.account.login} · {props.t('credentialProtected')}</span></div>
        {props.account.profileUrl === undefined ? null : <a href={props.account.profileUrl} target="_blank" rel="noreferrer">GitHub <IconRightUpOutline14 /></a>}
        <button type="button" onClick={props.onLogout}>{props.t('logout')}</button>
      </div>
    )
  }
  return (
    <form className={css.loginCard} onSubmit={submit}>
      <div><IconUserOutline16 size={18} /><span><strong>{props.t('githubLogin')}</strong><small>{props.t('githubLoginBody')}</small></span></div>
      <label><span>{props.t('tokenLabel')}</span><input type="password" autoComplete="off" value={token} onChange={(event) => { setToken(event.currentTarget.value) }} placeholder="github_pat_…" /></label>
      <button type="submit" disabled={token.trim().length === 0 || props.action.status === 'loading'}>{props.action.status === 'loading' ? props.t('signingIn') : props.t('signIn')}</button>
      <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{props.t('createToken')} <IconRightUpOutline14 /></a>
    </form>
  )
}

function CandidateNotice({ t }: { readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return <div className={css.candidateNotice}><IconWarningOutline16 size={17} /><div><strong>{t('candidateTitle')}</strong><span>{t('candidateBody')}</span></div></div>
}

function RepositoryState(props: {
  readonly empty: string
  readonly onCreate: (repository: HubGitHubRepository) => void
  readonly onRetry: () => void
  readonly state: AsyncState<readonly HubGitHubRepository[]>
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  if (props.state.status === 'idle') return <EmptyState title={props.t('searchReady')} body={props.t('searchReadyBody')} />
  if (props.state.status === 'loading') return <HubLoading t={props.t} compact />
  if (props.state.status === 'error') return <HubFailure message={props.state.message} onRetry={props.onRetry} t={props.t} />
  if (props.state.data.length === 0) return <EmptyState title={props.empty} body={props.t('tryAnotherSearch')} />
  return <div className={css.repositoryGrid}>{props.state.data.map(repository => <RepositoryCard key={repository.fullName} repository={repository} onCreate={props.onCreate} t={props.t} />)}</div>
}

function RepositoryCard(props: {
  readonly onCreate: (repository: HubGitHubRepository) => void
  readonly repository: HubGitHubRepository
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  const repo = props.repository
  return (
    <article className={css.repositoryCard}>
      <div className={css.repositoryTop}>
        {repo.ownerAvatarUrl === undefined ? <span className={css.repoAvatar}><IconGlobeOutline14 size={17} /></span> : <img className={css.repoAvatar} alt="" src={repo.ownerAvatarUrl} />}
        <div><strong>{repo.name}</strong><span>{repo.owner}</span></div>
        <b>★ {repo.stars}</b>
      </div>
      <p>{repo.description || props.t('noDescription')}</p>
      <div className={css.repoTopics}>{repo.topics.slice(0, 5).map(topic => <span key={topic}>{topic}</span>)}</div>
      <dl>
        <div><dt>{props.t('license')}</dt><dd>{repo.license ?? props.t('unknown')}</dd></div>
        <div><dt>{props.t('language')}</dt><dd>{repo.language ?? '—'}</dd></div>
        <div><dt>{props.t('updated')}</dt><dd>{formatDate(repo.updatedAt, resolveLanguage())}</dd></div>
      </dl>
      <div className={css.repoActions}>
        <a href={repo.repositoryUrl} target="_blank" rel="noreferrer">{props.t('viewRepository')} <IconRightUpOutline14 /></a>
        <button type="button" onClick={() => { props.onCreate(repo) }}><IconCodeOutline16 size={15} />{props.t('buildLocalSetup')}</button>
      </div>
    </article>
  )
}

function LibraryView(props: {
  readonly data: HubSnapshot
  readonly onCreate: () => void
  readonly onDelete: (item: HubLibraryItem) => void
  readonly onOpenPath: (path: string) => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('libraryEyebrow')} title={props.t('libraryTitle')} description={props.t('libraryIntro')} actions={<><button type="button" onClick={() => { props.onOpenPath(props.data.libraryPath) }}><IconFolderOpenOutline16 size={16} />{props.t('openFolder')}</button><button type="button" onClick={props.onCreate}><IconPlusOutline16 size={16} />{props.t('createBlank')}</button></>} />
      {props.data.library.length === 0 ? <EmptyState title={props.t('noLibraryDrafts')} body={props.t('noLibraryDraftsBody')} /> : (
        <div className={css.itemList}>{props.data.library.map(item => (
          <article className={css.itemRow} key={item.id}>
            <span className={css.itemIcon}><IconCodeOutline16 size={18} /></span>
            <div><strong>{item.name}</strong><span>{[item.version, item.sourceRepository].filter(Boolean).join(' · ') || item.id}</span><code>{item.path}</code></div>
            <button type="button" onClick={() => { void copyText(item.path) }}>{props.t('copyPath')}</button>
            <button type="button" onClick={() => { props.onOpenPath(item.path) }}><IconEditOutline16 size={15} />{props.t('edit')}</button>
            <button className={css.dangerButton} type="button" onClick={() => { props.onDelete(item) }}><IconTrashOutline16 size={15} />{props.t('delete')}</button>
          </article>
        ))}</div>
      )}
    </div>
  )
}

function OfflineView(props: { readonly data: HubSnapshot; readonly onOpenPath: (path: string) => void; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('offlineEyebrow')} title={props.t('offlineTitle')} description={props.t('offlineIntro')} actions={<button type="button" onClick={() => { props.onOpenPath(props.data.offlinePath) }}><IconFolderOpenOutline16 size={16} />{props.t('openFolder')}</button>} />
      {props.data.offline.length === 0 ? <EmptyState title={props.t('offlineEmpty')} body={props.t('offlineEmptyBody')} /> : (
        <div className={css.itemList}>{props.data.offline.map(item => <OfflineRow key={item.path} item={item} onOpenPath={props.onOpenPath} t={props.t} />)}</div>
      )}
    </div>
  )
}

function OfflineRow(props: { readonly item: HubOfflineItem; readonly onOpenPath: (path: string) => void; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return (
    <article className={css.itemRow}>
      <span className={css.itemIcon}><IconDownloadOutline16 size={18} /></span>
      <div><strong>{props.item.fileName}</strong><span>{props.t(`offlineKind_${props.item.kind}`)} · {formatBytes(props.item.bytes)} · {formatDate(props.item.modifiedAt, resolveLanguage())}</span><code>{props.item.path}</code></div>
      <button type="button" onClick={() => { void copyText(props.item.path) }}>{props.t('copyPath')}</button>
      <button type="button" onClick={() => { props.onOpenPath(props.item.path) }}><IconFolderOpenOutline16 size={15} />{props.t('showInFolder')}</button>
    </article>
  )
}

function InstalledView(props: {
  readonly data: HubSnapshot
  readonly onOpenPath: (path: string) => void
  readonly onUninstall: (item: HubInstalledItem) => void
  readonly t: SetupHubDesktopSurfaceProps['t']
}): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('installedEyebrow')} title={props.t('installedTitle')} description={props.t('installedIntro')} />
      {props.data.installed.length === 0 ? <EmptyState title={props.t('noInstalled')} body={props.t('noInstalledBody')} /> : (
        <div className={css.itemList}>{props.data.installed.map(item => (
          <article className={css.itemRow} key={item.id}>
            <span className={css.itemIcon}><IconCheckOutline16 size={18} /></span>
            <div><strong>{item.name}</strong><span>{[item.version, item.profile, formatDate(item.installedAt, resolveLanguage())].filter(Boolean).join(' · ')}</span><code>{item.workspacePath}</code></div>
            <button type="button" onClick={() => { void copyText(item.workspacePath) }}>{props.t('copyPath')}</button>
            <button type="button" onClick={() => { props.onOpenPath(item.workspacePath) }}><IconEditOutline16 size={15} />{props.t('editSetup')}</button>
            <button className={css.dangerButton} type="button" disabled={!item.removable} title={item.removable ? undefined : props.t('externalUninstall')} onClick={() => { props.onUninstall(item) }}><IconTrashOutline16 size={15} />{props.t('uninstall')}</button>
          </article>
        ))}</div>
      )}
    </div>
  )
}

function DesktopComponentManager(props: SetupHubSettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [snapshot, setSnapshot] = useState<AsyncState<HubSnapshot>>({ status: 'loading' })
  const [action, setAction] = useState<AsyncState<string>>({ status: 'idle' })
  const [restartPending, setRestartPending] = useState(readDesktopRestartPending)
  const [restartPrompt, setRestartPrompt] = useState<string>()
  const [restartTransition, setRestartTransition] = useState(false)
  const [componentRemoval, setComponentRemoval] = useState<ComponentRemovalSurface>({ status: 'idle' })
  useEffect(() => {
    let current = true
    setSnapshot({ status: 'loading' })
    void props.requestHub<HubSnapshot>('hub-snapshot').then(
      (value) => { if (current) setSnapshot({ status: 'ready', data: value }) },
      (error) => { if (current) setSnapshot({ status: 'error', message: errorMessage(error) }) },
    )
    return () => { current = false }
  }, [props.requestHub, request])
  const refresh = (): void => { setRequest(value => value + 1) }
  const markRestartPending = (): void => {
    setRestartPending(true)
    try { window.localStorage.setItem('dshHub.desktopRestartPending', '1') } catch { /* Browser storage can be unavailable in hardened WebView profiles. */ }
  }
  const restartApplication = async (): Promise<void> => {
    if (restartTransition) return
    setRestartPrompt(undefined)
    setRestartTransition(true)
    setAction({ status: 'loading' })
    try {
      await props.requestHub<Record<string, unknown>>('app-reload')
      setRestartPending(false)
      try { window.localStorage.removeItem('dshHub.desktopRestartPending') } catch { /* Browser storage can be unavailable in hardened WebView profiles. */ }
    } catch (error) {
      setRestartTransition(false)
      setAction({ status: 'error', message: errorMessage(error) })
    }
  }
  const openPath = (path: string): void => {
    setAction({ status: 'loading' })
    void props.requestHub<Record<string, never>>('hub-open-path', { path }).then(
      () => { setAction({ status: 'idle' }) },
      (error) => { setAction({ status: 'error', message: errorMessage(error) }) },
    )
  }
  const uninstall = (item: HubInstalledItem): void => {
    if (!window.confirm(props.t('uninstallConfirm').replace('{name}', item.name))) return
    setComponentRemoval({ status: 'running', item, progress: initialComponentRemovalProgress(item, props.t) })
    setAction({ status: 'loading' })
    void props.requestHub<Record<string, never>>('hub-uninstall', { id: item.id }, {
      onProgress: (progress) => {
        setComponentRemoval(current => current.status === 'running' && current.item.id === item.id
          ? { ...current, progress }
          : current)
      },
    }).then(
      () => {
        setComponentRemoval({ status: 'idle' })
        setAction({ status: 'ready', data: props.t('componentRemoved') })
        markRestartPending()
        setRestartPrompt(item.name)
        refresh()
      },
      (error) => {
        setComponentRemoval({ status: 'idle' })
        setAction({ status: 'error', message: errorMessage(error) })
      },
    )
  }
  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <HubLoading t={props.t} />
  if (snapshot.status === 'error') return <HubFailure message={snapshot.message} onRetry={refresh} t={props.t} />
  const data = snapshot.data
  return (
    <div className={css.componentManager}>
      <PageHeader
        eyebrow={props.t('componentEyebrow')}
        title={props.t('componentTitle')}
        description={props.t('componentIntro')}
        actions={<>{restartPending ? <button className={css.restartDesktopButton} type="button" onClick={() => { void restartApplication() }}><IconRefreshOutline16 size={16} />{props.t('restartDesktop')}</button> : null}<button type="button" onClick={refresh}><IconRefreshOutline16 size={16} />{props.t('refreshComponents')}</button>{props.openHub === undefined ? null : <button type="button" onClick={props.openHub}><IconCordisPluginOutline14 size={16} />{props.t('openHub')}</button>}</>}
      />
      <div className={css.componentSummary}>
        <article><strong>{data.installed.length}</strong><span>{props.t('installedComponents')}</span></article>
        <article><strong>{data.library.length}</strong><span>{props.t('preparedComponents')}</span></article>
        <article><strong>{data.offline.length}</strong><span>{props.t('offlineComponents')}</span></article>
      </div>
      <section className={css.componentSection}>
        <SectionHeading title={props.t('installedComponents')} description={props.t('installedComponentsBody')} />
        {data.installed.length === 0 ? <EmptyState title={props.t('noInstalled')} body={props.t('noInstalledBody')} /> : <div className={css.componentRows}>{data.installed.map(item => (
          <article key={item.id}>
            <span className={css.itemIcon}><IconCheckOutline16 size={18} /></span>
            <div><strong>{item.name}</strong><small>{[item.version, item.profile, formatDate(item.installedAt, resolveLanguage())].filter(Boolean).join(' · ')}</small><code>{item.workspacePath}</code></div>
            <button type="button" onClick={() => { void copyText(item.workspacePath) }}>{props.t('copyPath')}</button>
            <button type="button" onClick={() => { openPath(item.workspacePath) }}><IconEditOutline16 size={15} />{props.t('aiEditComponent')}</button>
            <button className={css.dangerButton} type="button" disabled={!item.removable} title={item.removable ? undefined : props.t('externalUninstall')} onClick={() => { uninstall(item) }}><IconTrashOutline16 size={15} />{props.t('uninstall')}</button>
          </article>
        ))}</div>}
      </section>
      <section className={css.componentSection}>
        <SectionHeading title={props.t('preparedComponents')} description={props.t('preparedComponentsBody')} />
        {data.library.length === 0 && data.offline.length === 0 ? <EmptyState title={props.t('noPreparedComponents')} body={props.t('noPreparedComponentsBody')} /> : <div className={css.componentRows}>
          {data.library.map(item => <article key={item.id}><span className={css.itemIcon}><IconCodeOutline16 size={18} /></span><div><strong>{item.name}</strong><small>{[item.version, item.sourceRepository].filter(Boolean).join(' · ') || item.id}</small><code>{item.path}</code></div><button type="button" onClick={() => { void copyText(item.path) }}>{props.t('copyPath')}</button><button type="button" onClick={() => { openPath(item.path) }}><IconEditOutline16 size={15} />{props.t('aiEditComponent')}</button></article>)}
          {data.offline.map(item => <article key={item.path}><span className={css.itemIcon}><IconDownloadOutline16 size={18} /></span><div><strong>{item.fileName}</strong><small>{props.t(`offlineKind_${item.kind}`)} · {formatBytes(item.bytes)}</small><code>{item.path}</code></div><button type="button" onClick={() => { void copyText(item.path) }}>{props.t('copyPath')}</button><button type="button" onClick={() => { openPath(item.path) }}><IconFolderOpenOutline16 size={15} />{props.t('showInFolder')}</button></article>)}
        </div>}
      </section>
      <aside className={css.aiComponentHint}><IconCodeOutline16 size={22} /><div><strong>{props.t('aiComponentTitle')}</strong><span>{props.t('aiComponentBody')}</span><code>{data.libraryPath}</code></div></aside>
      {action.status === 'error' ? <div className={css.inlineError} role="alert">{action.message}</div> : null}
      {action.status === 'ready' ? <div className={css.inlineSuccess} role="status">{action.data}</div> : null}
      <ComponentRemovalProgress surface={componentRemoval} t={props.t} />
      {restartPrompt === undefined ? null : <RestartDecisionDialog name={restartPrompt} onLater={() => { setRestartPrompt(undefined) }} onRestart={() => { void restartApplication() }} t={props.t} />}
      <RestartTransition active={restartTransition} t={props.t} />
    </div>
  )
}

function initialComponentRemovalProgress(item: HubInstalledItem, t: SetupHubDesktopSurfaceProps['t']): HubInstallProgress {
  return {
    detail: item.name,
    message: t('componentRemovingInitial').replace('{name}', item.name),
    percent: 3,
    stage: 'preflight',
    timestamp: new Date().toISOString(),
  }
}

function ComponentRemovalProgress(props: { readonly surface: ComponentRemovalSurface; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  if (props.surface.status === 'idle') return null
  const percent = Math.max(0, Math.min(100, props.surface.progress.percent))
  return (
    <div className={css.componentProgressBackdrop} role="presentation">
      <section className={css.componentProgressCard} role="status" aria-live="polite">
        <span className={css.componentProgressSpinner} aria-hidden="true"><span /></span>
        <div className={css.componentProgressCopy}>
          <small>{props.t('componentRemovingStage')}</small>
          <h2>{props.t('componentRemovingTitle')}</h2>
          <p>{props.surface.progress.message || props.t('componentRemovingInitial').replace('{name}', props.surface.item.name)}</p>
          <code>{props.surface.progress.detail || props.surface.item.name}</code>
        </div>
        <div className={css.componentProgressBar} aria-label={props.t('componentRemovingTitle')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} role="progressbar"><span style={{ width: `${percent}%` }} /></div>
        <footer><span>{props.surface.item.name}</span><strong>{percent}%</strong></footer>
      </section>
    </div>
  )
}

function RestartDecisionDialog(props: { readonly name: string; readonly onLater: () => void; readonly onRestart: () => void; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return (
    <div className={css.restartPromptBackdrop} role="presentation">
      <section className={css.restartPrompt} role="dialog" aria-modal="true" aria-labelledby="dsh-restart-prompt-title">
        <span className={css.restartPromptIcon}><IconRefreshOutline16 size={22} /></span>
        <div><h2 id="dsh-restart-prompt-title">{props.t('componentRestartTitle')}</h2><p>{props.t('componentRestartBody').replace('{name}', props.name)}</p></div>
        <footer><button type="button" onClick={props.onLater}>{props.t('restartLater')}</button><button type="button" onClick={props.onRestart}>{props.t('restartNow')}</button></footer>
      </section>
    </div>
  )
}

function RestartTransition(props: { readonly active: boolean; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  if (!props.active) return null
  return <div className={css.restartTransition} role="status" aria-live="assertive"><span aria-hidden="true" /><strong>{props.t('restartTransition')}</strong></div>
}

function BuilderView(props: { readonly data: HubSnapshot; readonly onCreate: () => void; readonly onOpenPath: (path: string) => void; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('builderEyebrow')} title={props.t('builderTitle')} description={props.t('builderIntro')} />
      <div className={css.builderHero}>
        <span><IconCodeOutline16 size={30} /></span>
        <div><h2>{props.t('aiEditingTitle')}</h2><p>{props.t('aiEditingBody')}</p><code>{props.data.libraryPath}</code></div>
        <button type="button" onClick={props.onCreate}><IconPlusOutline16 size={16} />{props.t('createBlank')}</button>
        <button type="button" onClick={() => { props.onOpenPath(props.data.libraryPath) }}><IconFolderOpenOutline16 size={16} />{props.t('openLibrary')}</button>
      </div>
      <div className={css.builderSteps}>
        <BuilderStep number="01" title={props.t('builderStep1')} body={props.t('builderStep1Body')} />
        <BuilderStep number="02" title={props.t('builderStep2')} body={props.t('builderStep2Body')} />
        <BuilderStep number="03" title={props.t('builderStep3')} body={props.t('builderStep3Body')} />
      </div>
    </div>
  )
}

function BuilderStep(props: { readonly body: string; readonly number: string; readonly title: string }): ReactNode {
  return <article><b>{props.number}</b><div><strong>{props.title}</strong><span>{props.body}</span></div></article>
}

function SecurityView(props: { readonly data: HubSnapshot; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return (
    <div className={css.page}>
      <PageHeader eyebrow={props.t('securityEyebrow')} title={props.t('securityTitle')} description={props.t('securityIntro')} />
      <div className={css.securityGrid}>
        <SecurityCard title={props.t('securityCredential')} body={props.t('securityCredentialBody')} value={props.data.account.authenticated ? props.t('protected') : props.t('notStored')} />
        <SecurityCard title={props.t('securityCatalog')} body={props.t('securityCatalogBody')} value={props.t('manifestValidated')} />
        <SecurityCard title={props.t('securityCandidates')} body={props.t('securityCandidatesBody')} value={props.t('notInstallableByDefault')} />
        <SecurityCard title={props.t('securityOffline')} body={props.t('securityOfflineBody')} value={`${props.data.offline.length} ${props.t('items')}`} />
      </div>
      <div className={css.policyList}>
        <h2>{props.t('trustPipeline')}</h2>
        <ol><li>{props.t('trustStep1')}</li><li>{props.t('trustStep2')}</li><li>{props.t('trustStep3')}</li><li>{props.t('trustStep4')}</li></ol>
      </div>
    </div>
  )
}

function SecurityCard(props: { readonly body: string; readonly title: string; readonly value: string }): ReactNode {
  return <article><IconCheckOutline16 size={18} /><div><strong>{props.title}</strong><span>{props.body}</span><b>{props.value}</b></div></article>
}

function CatalogWorkspace(props: SetupHubInjected & PropsLocale<'settings.setupHub'> & { readonly display: 'desktop' | 'settings'; readonly onInstalled?: (() => void) | undefined }): ReactNode {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SetupSort>('recommended')
  const [category, setCategory] = useState('all')
  const [trustFilter, setTrustFilter] = useState<TrustFilter>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set())
  const [installs, setInstalls] = useState<Readonly<Record<string, InstallState>>>({})
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const language = resolveLanguage()

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => props.list()).then(
      (index) => { if (current) setState({ status: 'ready', index }) },
      (error) => { if (current) setState({ status: 'error', message: errorMessage(error) }) },
    )
    return () => { current = false }
  }, [props.list, request])

  const categories = useMemo(() => {
    if (state.status !== 'ready') return []
    const counts = new Map<string, number>()
    for (const { manifest } of state.index.entries) for (const item of manifest.categories) counts.set(item, (counts.get(item) ?? 0) + 1)
    return [...counts].sort(([left], [right]) => left.localeCompare(right))
  }, [state])
  const listings = useMemo(() => {
    if (state.status !== 'ready') return []
    const normalized = query.trim().toLocaleLowerCase()
    return sortSetupListings(state.index.entries.filter(({ manifest }) => {
      if (category !== 'all' && !manifest.categories.includes(category)) return false
      if (trustFilter !== 'all' && classifySetupTrust(manifest) !== trustFilter) return false
      if (normalized.length === 0) return true
      return [resolveSetupText(manifest.name, language), resolveSetupText(manifest.description, language), ...manifest.categories, ...manifest.tags, manifest.source.repository]
        .some(value => value.toLocaleLowerCase().includes(normalized))
    }), sort)
  }, [category, language, query, sort, state, trustFilter])

  useEffect(() => {
    if (listings.length === 0) setSelectedId(undefined)
    else if (selectedId === undefined || !listings.some(item => item.manifest.id === selectedId)) setSelectedId(listings[0]?.manifest.id)
  }, [listings, selectedId])
  const selected = listings.find(item => item.manifest.id === selectedId)
  const retry = (): void => { setState({ status: 'loading' }); setRequest(value => value + 1) }
  const startInstall = (manifest: SetupManifest): void => {
    setInstalls(current => ({ ...current, [manifest.id]: { status: 'installing' } }))
    void props.install(manifest).then(
      (message) => { setInstalls(current => ({ ...current, [manifest.id]: { status: 'installed', message } })); props.onInstalled?.() },
      (error) => { setInstalls(current => ({ ...current, [manifest.id]: { status: 'error', message: errorMessage(error) } })) },
    )
  }
  return (
    <div className={css.catalogWorkspace} data-display={props.display}>
      <main className={css.catalogPane}>
        <div className={css.catalogHeader}>
          <div><p className={css.eyebrow}>{props.t('catalogEyebrow')}</p><h1>{props.display === 'desktop' ? props.t('catalogTitle') : props.t('settingsTitle')}</h1><p className={css.catalogIntro}>{props.t('catalogIntro')}</p></div>
          {state.status === 'ready' ? <div className={css.catalogStats}><span><strong>{state.index.entries.length}</strong>{props.t('setups')}</span><span><strong>{countTrust(state.index.entries, 'certified')}</strong>{props.t('certifiedShort')}</span><span><strong>{countKinds(state.index.entries, 'executable')}</strong>{props.t('exeShort')}</span></div> : null}
        </div>
        <div className={css.discoveryBar}>
          <label className={css.searchBox}><IconSearchOutline16 size={16} /><input type="search" value={query} placeholder={props.t('search')} aria-label={props.t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} /></label>
          <div className={css.sortGroup}>{(Object.keys(SORT_KEYS) as SetupSort[]).map(item => <button key={item} type="button" data-active={sort === item || undefined} onClick={() => { setSort(item) }}>{props.t(SORT_KEYS[item])}</button>)}</div>
          <button className={css.refreshButton} type="button" onClick={retry} aria-label={props.t('retry')}><IconRefreshOutline16 size={16} /></button>
        </div>
        {state.status === 'ready' ? <div className={css.filterRows}>
          <div className={css.compactFilters}><FilterButton active={category === 'all'} onClick={() => { setCategory('all') }}>{props.t('allCategories')}</FilterButton>{categories.map(([item]) => <FilterButton key={item} active={category === item} onClick={() => { setCategory(item) }}>{item}</FilterButton>)}</div>
          <div className={css.compactFilters}><FilterButton active={trustFilter === 'all'} onClick={() => { setTrustFilter('all') }}>{props.t('allTrust')}</FilterButton>{(Object.keys(TRUST_KEYS) as SetupTrust[]).map(trust => <FilterButton key={trust} active={trustFilter === trust} onClick={() => { setTrustFilter(trust) }}>{props.t(TRUST_KEYS[trust])}</FilterButton>)}</div>
        </div> : null}
        {state.status === 'loading' ? <CatalogLoading t={props.t} /> : null}
        {state.status === 'error' ? <HubFailure message={state.message} onRetry={retry} t={props.t} /> : null}
        {state.status === 'ready' && listings.length === 0 ? <p className={css.empty}>{props.t('empty')}</p> : null}
        {state.status === 'ready' ? <div className={css.cards} role="list">{listings.map(listing => <SetupCard key={listing.manifest.id} active={listing.manifest.id === selectedId} language={language} listing={listing} onSelect={() => { setSelectedId(listing.manifest.id) }} t={props.t} />)}</div> : null}
      </main>
      <SetupDetails
        accepted={accepted}
        desktopAvailable={props.desktopAvailable}
        installState={selected === undefined ? { status: 'idle' } : installs[selected.manifest.id] ?? { status: 'idle' }}
        language={language}
        listing={selected}
        onAccepted={(manifestId, checked) => { setAccepted((current) => { const next = new Set(current); if (checked) next.add(manifestId); else next.delete(manifestId); return next }) }}
        onInstall={startInstall}
        t={props.t}
      />
    </div>
  )
}

function PageHeader(props: { readonly actions?: ReactNode; readonly description: string; readonly eyebrow: string; readonly title: string }): ReactNode {
  return <header className={css.pageHeader}><div><p>{props.eyebrow}</p><h1>{props.title}</h1><span>{props.description}</span></div>{props.actions === undefined ? null : <div className={css.pageActions}>{props.actions}</div>}</header>
}

function MetricCard(props: { readonly label: string; readonly onClick: () => void; readonly value: number }): ReactNode {
  return <button className={css.metricCard} type="button" onClick={props.onClick}><strong>{props.value}</strong><span>{props.label}</span></button>
}

function SectionHeading(props: { readonly description: string; readonly title: string }): ReactNode {
  return <div className={css.sectionHeading}><h2>{props.title}</h2><p>{props.description}</p></div>
}

function ActionTile(props: { readonly body: string; readonly icon: ReactNode; readonly onClick: () => void; readonly title: string }): ReactNode {
  return <button type="button" className={css.actionTile} onClick={props.onClick}><span>{props.icon}</span><div><strong>{props.title}</strong><small>{props.body}</small></div></button>
}

function PreviewList(props: { readonly children: ReactNode; readonly empty: string; readonly title: string }): ReactNode {
  const empty = Array.isArray(props.children) && props.children.length === 0
  return <section className={css.previewList}><h2>{props.title}</h2>{empty ? <p>{props.empty}</p> : props.children}</section>
}

function PreviewRow(props: { readonly meta: string; readonly onClick: () => void; readonly title: string }): ReactNode {
  return <button type="button" onClick={props.onClick}><span><strong>{props.title}</strong><small>{props.meta || '—'}</small></span><IconRightUpOutline14 size={10} /></button>
}

function EmptyState(props: { readonly body: string; readonly title: string }): ReactNode {
  return <div className={css.emptyState}><IconDataOutline16 size={24} /><strong>{props.title}</strong><span>{props.body}</span></div>
}

function HubLoading({ compact, t }: { readonly compact?: boolean; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return <div className={css.hubLoading} data-compact={compact || undefined}><IconRefreshOutline16 size={22} /><strong>{t('loadingHub')}</strong><span>{t('loadingHubBody')}</span></div>
}

function HubFailure(props: { readonly message: string; readonly onRetry: () => void; readonly t: SetupHubDesktopSurfaceProps['t'] }): ReactNode {
  return <div className={css.failure} role="alert"><IconWarningOutline16 size={20} /><div><strong>{props.t('loadError')}</strong><span>{props.message}</span></div><button type="button" onClick={props.onRetry}>{props.t('retry')}</button></div>
}

function FilterButton(props: { readonly active: boolean; readonly children: ReactNode; readonly onClick: () => void }): ReactNode {
  return <button type="button" data-active={props.active || undefined} onClick={props.onClick}>{props.children}</button>
}

function SetupCard(props: { readonly active: boolean; readonly language: 'zh' | 'en'; readonly listing: SetupListing; readonly onSelect: () => void; readonly t: SetupHubSettingsTabProps['t'] }): ReactNode {
  const { manifest, metrics } = props.listing
  const trust = classifySetupTrust(manifest)
  return (
    <button type="button" className={css.card} data-active={props.active || undefined} onClick={props.onSelect} role="listitem">
      <span className={css.cardTopline}><span className={css.setupIcon} data-kind={manifest.kind}><IconCordisPluginOutline14 size={16} /></span><span className={css.cardBadges}><span data-trust={trust}>{props.t(TRUST_KEYS[trust])}</span><span>{props.t(manifest.kind)}</span></span></span>
      <strong className={css.cardTitle}>{resolveSetupText(manifest.name, props.language)}</strong>
      <span className={css.cardDescription}>{resolveSetupText(manifest.description, props.language)}</span>
      <span className={css.cardTags}>{manifest.tags.slice(0, 3).map(tag => <i key={tag}>{tag}</i>)}</span>
      <span className={css.cardFooter}><span>★ {metrics.stars ?? 0}</span><span>{props.t('installsValue')}: {metrics.installs ?? 0}</span><span>{manifest.version}</span></span>
    </button>
  )
}

function SetupDetails(props: {
  readonly accepted: ReadonlySet<string>
  readonly desktopAvailable: boolean
  readonly installState: InstallState
  readonly language: 'zh' | 'en'
  readonly listing: SetupListing | undefined
  readonly onAccepted: (manifestId: string, checked: boolean) => void
  readonly onInstall: (manifest: SetupManifest) => void
  readonly t: SetupHubSettingsTabProps['t']
}): ReactNode {
  if (props.listing === undefined) return <aside className={css.detailPane}><div className={css.detailEmpty}><IconCordisPluginOutline14 size={24} /><span>{props.t('selectSetup')}</span></div></aside>
  const { manifest, metrics } = props.listing
  const trust = classifySetupTrust(manifest)
  const acceptedSource = trust === 'certified' || props.accepted.has(manifest.id)
  const installing = props.installState.status === 'installing'
  return (
    <aside className={css.detailPane} aria-label={props.t('evidencePanel')}>
      <div className={css.detailHeader}><span className={css.detailIcon}><IconCordisPluginOutline14 size={22} /></span><div><p>{props.t(manifest.kind)}</p><h2>{resolveSetupText(manifest.name, props.language)}</h2><span>{manifest.version}</span></div></div>
      <p className={css.detailDescription}>{resolveSetupText(manifest.description, props.language)}</p>
      <div className={css.trustBanner} data-trust={trust}>{trust === 'certified' ? <IconCheckOutline16 size={18} /> : <IconWarningOutline16 size={18} />}<div><strong>{props.t(TRUST_KEYS[trust])}</strong><span>{props.t(`${TRUST_KEYS[trust]}Body`)}</span></div></div>
      <EvidenceSection title={props.t('sourceCertificate')}><Evidence label={props.t('source')} value={manifest.source.repository} link={manifest.source.repository} /><Evidence label={props.t('sourceRef')} value={manifest.source.ref} /><Evidence label={props.t('sourceCommit')} value={manifest.source.commit ?? props.t('notPinned')} mono /><Evidence label={props.t('license')} value={`${manifest.license.identifier} · ${manifest.license.name}`} link={manifest.license.url} /><Evidence label={props.t('redistribution')} value={props.t(manifest.license.redistributable ? 'redistributable' : 'notRedistributable')} /></EvidenceSection>
      <EvidenceSection title={props.t('securityStatement')}><Evidence label={props.t('signature')} value={[manifest.signature.status, manifest.signature.type, manifest.signature.signer].filter(Boolean).join(' · ')} /><Evidence label={props.t('audit')} value={[manifest.audit.status, manifest.audit.auditor, manifest.audit.checkedAt].filter(Boolean).join(' · ')} link={manifest.audit.report} /><Evidence label={props.t('auditChecks')} value={manifest.audit.checks.join(' · ')} /><Evidence label={props.t('compatibility')} value={`DSH ${manifest.compatibility.dsh} · ${manifest.compatibility.surfaces.join(', ')}`} /></EvidenceSection>
      <EvidenceSection title={props.t('installationStatement')}><Evidence label={props.t('permissions')} value={manifest.permissions.length === 0 ? props.t('none') : manifest.permissions.join('；')} /><Evidence label={props.t('network')} value={manifest.network.length === 0 ? props.t('none') : manifest.network.join('；')} /><Evidence label={props.t('artifacts')} value={manifest.artifacts.map(renderArtifact).join('；')} mono /><Evidence label={props.t('catalogMetrics')} value={`★ ${metrics.stars ?? 0} · ${props.t('installsValue')} ${metrics.installs ?? 0} · ${formatDate(metrics.updatedAt, props.language)}`} /></EvidenceSection>
      {trust !== 'certified' ? <label className={css.acceptance}><input type="checkbox" checked={props.accepted.has(manifest.id)} onChange={(event) => { props.onAccepted(manifest.id, event.currentTarget.checked) }} /><span><strong>{props.t('acceptTitle')}</strong>{props.t('acceptSource')}</span></label> : null}
      <div className={css.installArea}>
        <button type="button" className={css.installButton} data-busy={installing || undefined} disabled={!props.desktopAvailable || !acceptedSource || installing} onClick={() => { props.onInstall(manifest) }}>{installing ? <IconRefreshOutline16 size={17} /> : <IconDownloadOutline16 size={17} />}{installing ? props.t('installing') : props.t(manifest.kind === 'executable' ? 'installExecutable' : 'install')}</button>
        {!props.desktopAvailable ? <span className={css.installHint}>{props.t('desktopOnly')}</span> : null}
        {!acceptedSource ? <span className={css.installHint}>{props.t('acceptRequired')}</span> : null}
        {props.installState.status === 'installed' ? <span className={css.installSuccess}><IconCheckOutline16 size={16} />{props.t('installed')}</span> : null}
        {props.installState.status === 'error' ? <span className={css.installError} role="alert"><IconWarningOutline16 size={16} />{props.t('installError')}: {props.installState.message}</span> : null}
      </div>
    </aside>
  )
}

function EvidenceSection(props: { readonly children: ReactNode; readonly title: string }): ReactNode { return <section className={css.evidenceSection}><h3>{props.title}</h3><dl>{props.children}</dl></section> }

function Evidence(props: { readonly label: string; readonly link?: string | undefined; readonly mono?: boolean; readonly value: string }): ReactNode {
  const value = props.value.length === 0 ? '—' : props.value
  return <div><dt>{props.label}</dt><dd data-mono={props.mono || undefined}>{props.link === undefined ? value : <a href={props.link} target="_blank" rel="noreferrer">{value}<IconRightUpOutline14 size={9} /></a>}</dd></div>
}

function CatalogLoading({ t }: { readonly t: SetupHubSettingsTabProps['t'] }): ReactNode { return <div className={css.loading}><span /><span /><span /><p>{t('loading')}</p></div> }

function countTrust(entries: readonly SetupListing[], trust: SetupTrust): number { return entries.filter(entry => classifySetupTrust(entry.manifest) === trust).length }
function countKinds(entries: readonly SetupListing[], kind: SetupManifest['kind']): number { return entries.filter(entry => entry.manifest.kind === kind).length }
function readDesktopRestartPending(): boolean {
  try { return window.localStorage.getItem('dshHub.desktopRestartPending') === '1' } catch { return false }
}
async function waitForMinimumDuration(startedAt: number, durationMs: number): Promise<void> {
  const remaining = durationMs - (Date.now() - startedAt)
  if (remaining > 0) await new Promise((resolve) => { window.setTimeout(resolve, remaining) })
}
function readHubPreferences(): HubPreferences {
  const params = new URLSearchParams(window.location.search)
  const themeValue = params.get('dshHubTheme')
  const startValue = params.get('dshHubStart')
  const pageSizeValue = Number(params.get('dshHubPageSize'))
  const detailModeValue = params.get('dshHubDetailMode')
  const detailContentValue = params.get('dshHubDetailContent')
  const detailEntryValue = params.get('dshHubDetailEntry')
  return {
    discoverySource: params.get('dshHubDiscovery') === 'github' ? 'github' : params.get('dshHubDiscovery') === 'community' ? 'community' : 'dshmk',
    detailContent: detailContentValue === 'original' ? 'original' : 'native',
    detailEntry: detailEntryValue === 'card' ? 'card' : 'button',
    detailMode: detailModeValue === 'modal' || detailModeValue === 'full' ? detailModeValue : 'side',
    pageSize: pageSizeValue === 12 || pageSizeValue === 48 || pageSizeValue === 96 || pageSizeValue === 200 ? pageSizeValue : 24,
    startPage: startValue === 'github' || startValue === 'library' || startValue === 'installed' ? startValue : 'home',
    theme: themeValue === 'light' || themeValue === 'dark' ? themeValue : 'system',
  }
}

function useHubTheme(theme: HubTheme): void {
  useEffect(() => {
    const body = document.body
    const root = document.documentElement
    const hadDarkTheme = body.hasAttribute('data-ds-dark-theme')
    const previousColorScheme = root.style.colorScheme
    const media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      if (theme === 'system' && media === undefined) return
      const dark = theme === 'dark' || (theme === 'system' && media?.matches === true)
      root.style.colorScheme = dark ? 'dark' : 'light'
      body.toggleAttribute('data-ds-dark-theme', dark)
    }
    apply()
    if (theme === 'system' && media !== undefined) media.addEventListener('change', apply)
    return () => {
      if (theme === 'system' && media !== undefined) media.removeEventListener('change', apply)
      root.style.colorScheme = previousColorScheme
      body.toggleAttribute('data-ds-dark-theme', hadDarkTheme)
    }
  }, [theme])
}

function resolveLanguage(): 'zh' | 'en' { return document.documentElement.lang.toLocaleLowerCase().startsWith('zh') ? 'zh' : 'en' }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function isDshmkCatalogPage(value: unknown): value is HubDshmkCatalogPage {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.categories) || !value.categories.every(isDshmkCount)) return false
  if (!Array.isArray(value.projectTypes) || !value.projectTypes.every(isDshmkCount)) return false
  if (!Array.isArray(value.items) || !value.items.every(isDshmkProject)) return false
  if (!isFiniteNumber(value.page) || !isFiniteNumber(value.pageSize) || !isFiniteNumber(value.total) || !isFiniteNumber(value.totalPages)) return false
  return typeof value.generatedAt === 'string'
    && (value.sourceMode === 'live' || value.sourceMode === 'cache' || value.sourceMode === 'bundled')
    && typeof value.sourceUrl === 'string'
}

function isDshmkCount(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && isFiniteNumber(value.count)
}

function isDshmkProject(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.owner) || !isRecord(value.install) || !isRecord(value.validation)) return false
  if (!isRecord(value.install.candidate) || !Array.isArray(value.install.candidates)) return false
  if (!isRecord(value.validation.stages)) return false
  return isFiniteNumber(value.repositoryId)
    && isFiniteNumber(value.stars)
    && typeof value.name === 'string'
    && typeof value.fullName === 'string'
    && typeof value.url === 'string'
    && typeof value.description === 'string'
    && typeof value.projectType === 'string'
    && typeof value.language === 'string'
    && typeof value.owner.avatarUrl === 'string'
    && typeof value.owner.login === 'string'
    && typeof value.install.status === 'string'
    && typeof value.validation.label === 'string'
    && typeof value.validation.overall === 'string'
    && typeof value.validation.sourceSha === 'string'
    && typeof value.installable === 'boolean'
    && typeof value.verified === 'boolean'
    && isStringArray(value.categories)
    && isStringArray(value.topics)
}

function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isStringArray(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }

function formatDate(value: string | undefined, language: 'zh' | 'en', timeZone?: string): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(date)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function copyText(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value) } catch { window.prompt('Copy path', value) }
}

function renderArtifact(artifact: SetupManifest['artifacts'][number]): string {
  if (artifact.kind === 'in-box') return `${artifact.id}: ${artifact.component}`
  return `${artifact.id}: ${artifact.kind} · SHA-256 ${artifact.sha256}`
}
