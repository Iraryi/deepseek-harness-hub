/* oxlint-disable @stylistic/max-len */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SetupHubDesktopSurface, SetupHubSettingsTab, type SetupHubSettingsTabProps,
} from '../src/client/SetupHubSettingsTab.tsx'
import type { HubInstallProgress } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

const manifest = {
  schemaVersion: 1 as const,
  id: 'dsh-hub-test', name: 'Hub Test', description: 'Evidence display', version: '1.0.0', kind: 'virtual' as const,
  categories: ['test'], tags: [], source: { repository: 'https://github.com/example/hub-test', ref: 'main' },
  compatibility: { dsh: '>=0.1.0', surfaces: ['desktop' as const] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'unknown' as const }, audit: { status: 'reviewed' as const, checks: ['manifest'] },
  artifacts: [{ id: 'bundle', kind: 'in-box' as const, component: '@example/hub-test' }],
  install: { mode: 'profile' as const, source: 'in-box' as const, bundle: '@example/hub-test' },
  permissions: ['profile'], network: [],
}

const t = ((key: keyof typeof zh): string => zh[key]) as SetupHubSettingsTabProps['t']
const runtimeProps = {
  useSessions: () => undefined,
  useSessionPendingInteraction: () => undefined,
  useWorkspaces: () => undefined,
} as unknown as Pick<SetupHubSettingsTabProps, 'useSessions' | 'useSessionPendingInteraction' | 'useWorkspaces'>

const emptySnapshot = {
  account: { authenticated: false }, installed: [], library: [], offline: [],
  libraryPath: 'C:\\hub\\library', offlinePath: 'C:\\hub\\offline',
}

const communityRegistry = {
  categories: { ui: { zh: 'UI 增强', en: 'UI Enhancements' } },
  count: 1,
  plugins: [{
    added: '2026-08-16', category: 'ui', description: { zh: '精选插件' }, name: 'dsh-market-test',
    npm: null, owner: 'example', stars: 88, url: 'https://github.com/example/dsh-market-test',
  }],
  sourceMode: 'bundled' as const,
  sourceUrl: 'https://awesome-dsh-plugin.com/plugins.json',
  updated: '2026-08-16',
}

const dshmkProject = {
  categories: ['ui'], category: 'ui', createdAt: '2026-08-01T00:00:00Z', defaultBranch: 'main', description: 'DSHMK project', forks: 3,
  fullName: 'example/dshmk-project', homepage: '', id: '101', install: {
    candidate: { args: ['plugin', '--profile', 'web', 'add', 'example-dshmk'], command: 'dsh plugin --profile web add example-dshmk', executable: true, source: 'npm', target: 'example-dshmk' },
    candidates: [], status: 'ready',
  }, installable: true, installMode: 'one-click' as const, language: 'TypeScript', license: 'MIT', name: 'dshmk-project', openIssues: 1,
  owner: { avatarUrl: 'https://github.com/example.png?size=96', login: 'example' }, projectType: 'plugin', pushedAt: '2026-08-15T00:00:00Z',
  repositoryId: 101, stars: 120, topics: ['deepseek-harness'], updatedAt: '2026-08-15T00:00:00Z', url: 'https://github.com/example/dshmk-project',
  validation: { dshVersion: '>=0.1.0', eligible: true, label: 'Verified', level: 3, overall: 'verified', platform: 'web', reason: '', sourceSha: '1234567890123456789012345678901234567890', stages: { source: { status: 'passed' } }, tone: 'success', updatedAt: '2026-08-15T00:00:00Z', validatorVersion: '1', verified: true }, verified: true,
}

const dshmkUnpinnedProject = {
  ...dshmkProject, id: '105', installMode: 'one-click-unpinned' as const, name: 'unpinned-project', repositoryId: 105,
  fullName: 'example/unpinned-project', install: {
    candidate: { args: ['plugin', '--profile', 'web', 'add', 'github:example/unpinned-project'], command: 'dsh plugin --profile web add github:example/unpinned-project', executable: true, source: 'github', target: 'example/unpinned-project' },
    candidates: [], status: 'recognized',
  }, validation: { ...dshmkProject.validation, overall: 'capability-pending', sourceSha: '', verified: false },
}

const dshmkCatalog = {
  categories: [{ count: 1, id: 'ui' }], generatedAt: '2026-08-16T16:07:23Z', items: [dshmkProject], page: 1, pageSize: 24,
  projectTypes: [{ count: 1, id: 'plugin' }], sourceMode: 'bundled' as const, sourceUrl: 'https://dshmk.com/catalog.json', total: 1, totalPages: 1,
}

const dshmkReferenceProject = {
  ...dshmkProject, id: '102', installable: false, installMode: 'reference' as const, name: 'reference-project', repositoryId: 102,
  install: { candidate: { args: ['plugin', '--profile', 'web', 'add', 'reference-project'], command: 'dsh plugin --profile web add reference-project', executable: false, source: 'readme', target: 'reference-project' }, candidates: [], status: 'recognized' },
}

const dshmkAmbiguousProject = {
  ...dshmkProject, id: '103', installable: false, installMode: 'ambiguous' as const, name: 'ambiguous-project', repositoryId: 103,
  install: { candidate: {}, candidates: [
    { args: ['plugin', '--profile', 'web', 'add', 'candidate-a'], command: 'dsh plugin --profile web add candidate-a', executable: true, source: 'readme', target: 'candidate-a' },
    { args: ['plugin', '--profile', 'web', 'add', 'candidate-b'], command: 'dsh plugin --profile web add candidate-b', executable: true, source: 'readme', target: 'candidate-b' },
  ], status: 'ambiguous' },
}

const dshmkLocalProject = {
  ...dshmkProject, id: '104', installable: false, installMode: 'local' as const, name: 'local-project', repositoryId: 104,
  install: { candidate: {}, candidates: [], status: 'unavailable' },
}

function hubRequest(responses: Readonly<Record<string, unknown>> = {}) {
  return vi.fn(async (operation: string) => responses[operation] ?? (operation === 'dshmk-catalog' ? dshmkCatalog : operation === 'dshmk-detail' ? { project: dshmkProject, related: [], sourceMode: 'bundled', sourceUrl: 'https://dshmk.com/catalog.json' } : emptySnapshot)) as unknown as SetupHubSettingsTabProps['requestHub']
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SetupHubSettingsTab', () => {
  it('filters settings inventory and retains its search on refresh failure', async () => {
    let rejectScan: (error: Error) => void = () => {}
    let calls = 0
    const requestHub = vi.fn(() => {
      if (++calls > 1) return new Promise((_resolve, reject) => { rejectScan = reject })
      return Promise.resolve({ ...emptySnapshot, installed: [
        { id: 'external', name: 'External plugin', kind: 'plugin', profile: 'web', homePath: 'D:\\external', origin: 'profile', inventoryState: 'present', packageNames: [], workspacePath: '', installedAt: '', removable: false },
        { id: 'owned', name: 'Owned plugin', kind: 'plugin', profile: 'web', origin: 'hub', inventoryState: 'missing', packageNames: [], workspacePath: '', installedAt: '', removable: false },
      ] })
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubSettingsTab {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '', source: '', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)
    await screen.findByText('External plugin')
    const sourceButton = screen.getByRole('button', { name: new RegExp(zh.inventorySourceFilter) })
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.click(sourceButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(sourceButton)
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.click(sourceButton)
    fireEvent.click(screen.getByRole('option', { name: zh.inventoryOriginProfile }))
    expect(document.activeElement).toBe(sourceButton)
    expect(screen.queryByText('Owned plugin')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: zh.inventorySearch }), { target: { value: 'External' } })
    fireEvent.click(screen.getByRole('button', { name: zh.refreshComponents }))
    expect((screen.getByRole('button', { name: zh.inventoryRefreshing }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { rejectScan(new Error('read failed')) })
    expect(screen.getByRole('alert').textContent).toContain('read failed')
    expect(screen.getByText('External plugin')).toBeTruthy()
    expect(screen.queryByText('Owned plugin')).toBeNull()
    expect((screen.getByRole('textbox', { name: zh.inventorySearch }) as HTMLInputElement).value).toBe('External')
    fireEvent.click(screen.getByRole('button', { name: zh.inventoryReset }))
    expect(screen.getByText('Owned plugin')).toBeTruthy()
  })

  it.each([true, false])('copies diagnostic metadata with a selectable fallback (clipboard=%s)', async (clipboardAvailable) => {
    const writeText = vi.fn(async () => { if (!clipboardAvailable) throw new Error('Clipboard blocked') })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const requestHub = hubRequest({ 'hub-snapshot': { ...emptySnapshot, installed: [{ id: 'external', name: 'External plugin', kind: 'plugin', origin: 'profile', inventoryState: 'present', componentPath: 'D:\\isolated\\package.json', packageNames: ['demo'], workspacePath: '', installedAt: '', removable: false }] } })
    render(<SetupHubSettingsTab {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '', source: '', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)
    await screen.findByText('External plugin')
    fireEvent.click(screen.getByRole('button', { name: zh.inventoryDiagnostic }))
    if (clipboardAvailable) expect(await screen.findByRole('status')).toHaveProperty('textContent', zh.inventoryDiagnosticCopied)
    else expect((await screen.findByRole('textbox', { name: zh.inventoryDiagnostic }) as HTMLTextAreaElement).value).toContain('not-verified')
    expect(writeText.mock.calls[0]).toBeDefined()
    expect(requestHub).toHaveBeenCalledTimes(1)
  })
  it('keeps inventory and search visible during failed rescans and reconciles a later removal', async () => {
    let rejectScan: (error: Error) => void = () => {}
    let calls = 0
    const requestHub = vi.fn((operation: string) => {
      if (operation !== 'hub-snapshot') return Promise.resolve({})
      calls++
      if (calls === 2) return new Promise((_resolve, reject) => { rejectScan = reject })
      return Promise.resolve({ ...emptySnapshot, installed: calls > 2 ? [] : [{ id: 'external', name: 'External plugin', version: '1', kind: 'plugin', profile: 'web', origin: 'profile', inventoryState: 'present', packageNames: ['external-plugin'], workspacePath: '', installedAt: '', removable: false }] })
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '', source: '', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)
    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(within(screen.getByRole('complementary', { name: zh.functionArea })).getByRole('button', { name: new RegExp(zh.navInstalled) }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.inventorySearch }), { target: { value: 'External' } })
    fireEvent.click(screen.getByRole('button', { name: zh.inventoryRefresh }))
    expect((await screen.findByRole('button', { name: zh.inventoryRefreshing }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('External plugin')).toBeTruthy()
    await act(async () => { rejectScan(new Error('profile unavailable')) })
    expect((screen.getByRole('textbox', { name: zh.inventorySearch }) as HTMLInputElement).value).toBe('External')
    expect(screen.getByRole('alert').textContent).toContain('profile unavailable')
    expect(screen.getByText('External plugin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.inventoryRefresh }))
    await waitFor(() => { expect(screen.queryByText('External plugin')).toBeNull() })
    expect((screen.getByRole('textbox', { name: zh.inventorySearch }) as HTMLInputElement).value).toBe('External')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('shows external profile components and scan failures without inventing Setup editing or uninstall support', async () => {
    const componentPath = 'D:\\isolated\\profiles\\web\\package.json'
    const requestHub = hubRequest({ 'hub-snapshot': {
      ...emptySnapshot,
      installed: [{ id: 'external', name: 'External plugin', version: '1.2.0', kind: 'plugin', profile: 'web', origin: 'profile', inventoryState: 'present', componentPath, packageNames: ['external-plugin'], workspacePath: '', installedAt: '', removable: false }],
      inventoryWarnings: [{ path: 'D:\\isolated\\profiles\\broken\\package.json', message: 'Invalid JSON' }],
    } })
    render(<SetupHubSettingsTab {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)
    expect(await screen.findByText('External plugin')).toBeTruthy()
    expect(within(screen.getByText('External plugin').closest('article')!).getByText(new RegExp(zh.inventoryOriginProfile))).toBeTruthy()
    expect(screen.getByText(new RegExp(zh.inventoryPresent))).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Invalid JSON')
    expect((screen.getByRole('button', { name: zh.uninstall }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.openProfile }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('hub-open-path', { path: componentPath }) })
  })
  it('forces online refresh without hiding the catalog and preserves it after a failure', async () => {
    let failRefresh: (error: Error) => void = () => {}
    const requestHub = vi.fn((operation: string, payload?: Readonly<Record<string, unknown>>) => {
      if (operation === 'dshmk-catalog' && payload?.refresh === true) {
        return new Promise((_resolve, reject) => { failRefresh = reject })
      }
      return hubRequest()(operation as never, payload)
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)
    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByText(dshmkProject.name)
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    await screen.findByText(zh.catalogRefreshing)
    expect(requestHub).toHaveBeenCalledWith('dshmk-catalog', expect.objectContaining({ refresh: true, page: 1 }))
    expect(screen.getByText(dshmkProject.name)).toBeTruthy()
    await act(async () => { failRefresh(new Error('network unavailable')) })
    expect(await screen.findByText('network unavailable')).toBeTruthy()
    expect(screen.getByText(zh.catalogCachedNotice)).toBeTruthy()
    expect(screen.getByText(zh.catalogDiagnostics).closest('details')?.open).toBe(false)
    expect(screen.getAllByRole('button', { name: zh.retry })).toHaveLength(1)
    expect(screen.getByText(dshmkProject.name)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: zh.dshmkSearchPlaceholder }), { target: { value: 'test' } })
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('dshmk-catalog', expect.objectContaining({ query: 'test', refresh: false })) })
  })
  it('manages installed and prepared components instead of opening another market', async () => {
    const openHub = vi.fn()
    const list: SetupHubSettingsTabProps['list'] = vi.fn(async () => ({ schemaVersion: 1 as const, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [{ manifest, metrics: {} }] }))
    const requestHub = hubRequest({
      'hub-snapshot': {
        ...emptySnapshot,
        installed: [{ id: 'installed-test', installedAt: '2026-08-17T00:00:00Z', kind: 'virtual', name: 'Installed Test', packageNames: ['installed-test'], profile: 'web', removable: true, workspacePath: 'C:\\hub\\installed-test' }],
        library: [{ id: 'draft-test', name: 'Draft Test', path: 'C:\\hub\\library\\draft-test', version: '0.1.0' }],
      },
    })
    render(<SetupHubSettingsTab {...runtimeProps} desktopAvailable list={list} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} openHub={openHub} leaveHub={() => {}} t={t} />)
    expect(await screen.findByRole('heading', { name: zh.componentTitle })).toBeTruthy()
    expect(screen.getByText('Installed Test')).toBeTruthy()
    expect(screen.getByText('Draft Test')).toBeTruthy()
    expect(screen.queryByText(zh.catalogTitle)).toBeNull()
    expect(list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.openHub }))
    expect(openHub).toHaveBeenCalledOnce()
  })

  it('offers restart choices after uninstalling a Desktop component', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const snapshot = {
      ...emptySnapshot,
      installed: [{ id: 'installed-test', installedAt: '2026-08-17T00:00:00Z', kind: 'virtual', name: 'Installed Test', packageNames: ['installed-test'], profile: 'web', removable: true, workspacePath: 'C:\\hub\\installed-test' }],
    }
    let completeUninstall: ((value: Record<string, never>) => void) | undefined
    const requestHub = vi.fn((operation: string, _payload?: Readonly<Record<string, unknown>>, options?: { readonly onProgress?: (progress: HubInstallProgress) => void }) => {
      if (operation === 'hub-snapshot') return Promise.resolve(snapshot)
      if (operation === 'hub-uninstall') {
        queueMicrotask(() => {
          options?.onProgress?.({ detail: 'C:\\Users\\test\\.dsh\\profiles\\web', message: '依赖已移除，正在更新 Web Profile。', percent: 72, stage: 'profile', timestamp: '2026-08-18T00:00:00.000Z' })
        })
        return new Promise<Record<string, never>>((resolve) => { completeUninstall = resolve })
      }
      if (operation === 'app-reload') return Promise.resolve({ requested: true })
      return Promise.resolve(emptySnapshot)
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubSettingsTab {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-17T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} openHub={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByText('Installed Test')
    fireEvent.click(screen.getByRole('button', { name: zh.uninstall }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('hub-uninstall', { id: 'installed-test' }, expect.objectContaining({ onProgress: expect.any(Function) })) })
    expect(await screen.findByRole('heading', { name: zh.componentRemovingTitle })).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('progressbar', { name: zh.componentRemovingTitle }).getAttribute('aria-valuenow')).toBe('72') })
    await act(async () => { completeUninstall?.({}); await Promise.resolve() })
    expect(await screen.findByRole('dialog', { name: zh.componentRestartTitle })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.restartNow })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.restartLater }))
    expect(screen.queryByRole('dialog', { name: zh.componentRestartTitle })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.restartDesktop }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('app-reload') })
    expect(screen.getByText(zh.restartTransition)).toBeTruthy()
  })

  it('presents native CONFIG and Desktop exits on the dedicated HUB surface', async () => {
    const openConfig = vi.fn()
    const leaveHub = vi.fn()
    const requestHub = hubRequest({
      'config-read': { target: 'hub', revision: 'test', values: { Theme: 'system', WindowChrome: 'system' } },
      'community-registry': communityRegistry,
      'dshmk-live-metadata': {
        '101': {
          fetchedAt: '2026-08-21T00:00:00.000Z', githubStars: 135, githubUpdatedAt: '2026-08-20T00:00:00Z',
          githubPushedAt: '2026-08-20T00:00:00Z', npmPackage: 'example-dshmk', npmVersion: '1.2.3', status: 'fresh',
          validationStale: true,
        },
      },
      'github-search': [],
    })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [{ manifest, metrics: {} }] })} install={async () => 'ok'} requestHub={requestHub} openConfig={openConfig} leaveHub={leaveHub} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    expect(screen.getByRole('button', { name: zh.navGitHub })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(zh.navLibrary) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByRole('heading', { name: zh.githubTitle })
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('dshmk-catalog', expect.objectContaining({ page: 1, pageSize: 24 })) })
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('dshmk-live-metadata', { repositoryIds: [101] }) })
    expect(await screen.findByText('dshmk-project')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText(/135/)).toBeTruthy() })
    await waitFor(() => { expect(screen.getByText(zh.sourceUpdatedSinceValidation)).toBeTruthy() })
    expect(screen.getByText('Aug 16, 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh.curatedDiscovery }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('community-registry') })
    expect(await screen.findByText('dsh-market-test')).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh.curatedDiscovery }).querySelector('img')).toBeNull()
    const communityAvatar = document.querySelector<HTMLImageElement>('img[src="https://github.com/example.png?size=96"]')
    expect(communityAvatar).toBeTruthy()
    fireEvent.error(communityAvatar!)
    expect(document.querySelector<HTMLImageElement>('img[src="https://github.com/example.png?size=96"]')).toBeNull()
    expect(screen.queryByText('候选项目先发现，清单证据后安装')).toBeNull()
    expect(screen.queryByText('HUB 展示声明；它不替维护者或用户做信任决定。')).toBeNull()
    expect(screen.queryByLabelText(zh.tokenLabel)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: zh.globalGitHub }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('github-search', { query: '' }) })
    fireEvent.click(screen.getByRole('button', { name: zh.navCatalog }))
    await screen.findByRole('heading', { name: zh.catalogTitle })
    expect(screen.getAllByText('Hub Test')).toHaveLength(2)
    fireEvent.click(within(screen.getByRole('complementary', { name: zh.functionArea })).getByRole('button', { name: zh.openConfig }))
    await screen.findByRole('heading', { name: zh.configTitle })
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.configStandalone }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.configStandalone }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('config-open', { target: 'hub' }) })
    expect(openConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.returnToDesktop }))
    await waitFor(() => { expect(leaveHub).toHaveBeenCalledOnce() })
  })

  it('uses a neutral plugin glyph when a curated entry has no GitHub owner icon', async () => {
    const registry = {
      ...communityRegistry,
      plugins: [{ ...communityRegistry.plugins[0], name: 'dsh-', owner: '' }],
    }
    const requestHub = hubRequest({ 'community-registry': registry })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    fireEvent.click(screen.getByRole('tab', { name: zh.curatedDiscovery }))
    const pluginName = await screen.findByText('dsh-')
    expect(pluginName.closest('article')?.querySelector('img')).toBeNull()
    expect(pluginName.closest('article')?.querySelector('span[aria-hidden="true"] svg')).toBeTruthy()
  })

  it('runs curated one-click installs inside the shared Setup progress surface', async () => {
    const installableRegistry = { ...communityRegistry, plugins: [{ ...communityRegistry.plugins[0], npm: '@example/dsh-market-test' }] }
    const requestHub = hubRequest({ 'community-registry': installableRegistry, 'community-prepare-setup': manifest })
    const install = vi.fn(async (_manifest, onProgress?: (progress: typeof progressUpdate) => void) => {
      onProgress?.(progressUpdate)
      return 'installed and activated'
    })
    const progressUpdate = { detail: '@example/dsh-market-test', message: '正在安装精选插件', percent: 64, stage: 'install' as const, timestamp: '2026-08-16T00:00:00Z' }
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={install} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    fireEvent.click(screen.getByRole('tab', { name: zh.curatedDiscovery }))
    await screen.findByText('dsh-market-test')
    fireEvent.click(screen.getByRole('button', { name: zh.oneClickSetup }))
    expect(await screen.findByRole('dialog', { name: zh.setupProgressTitle })).toBeTruthy()
    expect(await screen.findByText(zh.installationComplete)).toBeTruthy()
    expect(screen.getByText('installed and activated')).toBeTruthy()
    expect(install).toHaveBeenCalledWith(manifest, expect.any(Function))
    expect(screen.getByRole('button', { name: zh.restartDesktop })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.reloadDesktop }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('desktop-reload') })
    expect(await screen.findByText(zh.desktopReloadRequested)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh.close }).at(-1)!)
    expect(screen.queryByRole('button', { name: zh.restartDesktop })).toBeNull()
  })

  it('shows byte-level download progress while preparing a curated Setup', async () => {
    const installableRegistry = { ...communityRegistry, plugins: [{ ...communityRegistry.plugins[0], npm: '@example/dsh-market-test' }] }
    const progressUpdate = {
      detail: 'dsh-market-test.tgz · 512 KB / 1.00 MB', downloadedBytes: 512 * 1024,
      manualDownloads: [{ id: 'asset-1', fileName: 'dsh-market-test.tgz', kind: 'package' as const, downloadUrl: 'https://registry.npmjs.org/@example/dsh-market-test/-/dsh-market-test-1.0.0.tgz', repositoryUrl: 'https://github.com/example/dsh-market-test', sha256: 'a'.repeat(64), bytes: 1024 * 1024 }],
      message: '正在下载并校验插件资产。', percent: 34, stage: 'download' as const,
      timestamp: '2026-08-17T00:00:00Z', totalBytes: 1024 * 1024,
    }
    const requestHub = vi.fn((operation: string, _payload?: Readonly<Record<string, unknown>>, options?: { readonly onProgress?: (progress: typeof progressUpdate) => void }) => {
      if (operation === 'hub-snapshot') return Promise.resolve(emptySnapshot)
      if (operation === 'dshmk-catalog') return Promise.resolve(dshmkCatalog)
      if (operation === 'community-registry') return Promise.resolve(installableRegistry)
      if (operation === 'community-prepare-setup') {
        queueMicrotask(() => { options?.onProgress?.(progressUpdate) })
        return new Promise(() => undefined)
      }
      if (operation === 'setup-open-manual-url') return Promise.resolve({})
      if (operation === 'setup-manual-import') return Promise.resolve({ cancelled: false, imported: true, fileName: 'dsh-market-test.tgz', bytes: 1024 * 1024, sha256: 'a'.repeat(64) })
      return Promise.resolve({})
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    fireEvent.click(screen.getByRole('tab', { name: zh.curatedDiscovery }))
    await screen.findByText('dsh-market-test')
    fireEvent.click(screen.getByRole('button', { name: zh.oneClickSetup }))
    expect(await screen.findByText(zh.downloadProgress)).toBeTruthy()
    expect(screen.getByText('512.0 KB / 1.0 MB · 50%')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: zh.downloadProgress }).getAttribute('aria-valuenow')).toBe('50')
    fireEvent.click(screen.getByRole('button', { name: zh.manualDownload }))
    expect(await screen.findByText('https://github.com/example/dsh-market-test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.openDownload }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('setup-open-manual-url', { downloadId: 'asset-1', target: 'download' }) })
    fireEvent.click(screen.getByRole('button', { name: zh.selectDownloadedFile }))
    expect(await screen.findByText(zh.manualImportComplete.replace('{file}', 'dsh-market-test.tgz'))).toBeTruthy()
    expect(requestHub).toHaveBeenCalledWith('setup-manual-import', { downloadId: 'asset-1' }, { timeoutMs: 15 * 60 * 1000 })
  })

  it('shows an authenticated GitHub account and starred repositories', async () => {
    const repository = {
      archived: false, defaultBranch: 'main', description: 'DSH plugin', disabled: false, fork: false,
      fullName: 'example/dsh-plugin', language: 'TypeScript', license: 'MIT', name: 'dsh-plugin', owner: 'example',
      private: false, repositoryUrl: 'https://github.com/example/dsh-plugin', stars: 42, topics: ['deepseek-harness'],
    }
    const requestHub = hubRequest({
      'hub-snapshot': { ...emptySnapshot, account: { authenticated: true, login: 'octocat' } },
      'github-starred': [repository],
    })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByText('octocat')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh.navStarred) }))
    expect(await screen.findByText('dsh-plugin')).toBeTruthy()
    expect(screen.getByText('★ 42')).toBeTruthy()
  })

  it('keeps GitHub credentials inside the dedicated account function', async () => {
    const requestHub = hubRequest({ 'community-registry': communityRegistry })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByRole('heading', { name: zh.githubTitle })
    expect(screen.queryByLabelText(zh.tokenLabel)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.navAccount }))
    await screen.findByRole('heading', { name: zh.accountTitle })
    expect(screen.getByLabelText(zh.tokenLabel)).toBeTruthy()
  })

  it('applies independent HUB launch preferences from the desktop URL', async () => {
    window.history.replaceState({}, '', '/?dshHubTheme=dark&dshHubStart=github&dshHubDiscovery=github')
    const requestHub = hubRequest({ 'github-search': [] })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.githubTitle })
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('github-search', { query: '' }) })
    expect(screen.getByRole('tab', { name: zh.globalGitHub }).getAttribute('aria-selected')).toBe('true')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('uses icon-only refresh and a dedicated details button by default', async () => {
    window.history.replaceState({}, '', '/?dshHubStart=github')
    const requestHub = hubRequest()
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    const projectName = await screen.findByText('dshmk-project')
    const refresh = screen.getByRole('button', { name: zh.retry })
    expect(refresh.textContent).toBe('')
    expect(projectName.closest('button')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.details }))
    expect(await screen.findByRole('dialog', { name: 'dshmk-project' })).toBeTruthy()
  })

  it('restores whole-card detail activation when CONFIG selects it', async () => {
    window.history.replaceState({}, '', '/?dshHubStart=github&dshHubDetailEntry=card')
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={hubRequest()} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    const projectName = await screen.findByText('dshmk-project')
    expect(screen.queryByRole('button', { name: zh.details })).toBeNull()
    fireEvent.click(projectName.closest('button')!)
    expect(await screen.findByRole('dialog', { name: 'dshmk-project' })).toBeTruthy()
  })

  it('rejects malformed DSHMK pages without blanking the HUB shell', async () => {
    const requestHub = hubRequest({ 'dshmk-catalog': { ...dshmkCatalog, items: undefined } })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    expect(await screen.findByText(zh.catalogMalformed)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.navHome })).toBeTruthy()
  })

  it('persists page size and restores page plus scroll after closing details', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const requestHub = vi.fn(async (operation: string, payload?: Readonly<Record<string, unknown>>) => {
      if (operation === 'hub-snapshot') return emptySnapshot
      if (operation === 'dshmk-catalog') return { ...dshmkCatalog, page: payload?.page ?? 1, pageSize: payload?.pageSize ?? 24, total: 72, totalPages: 3 }
      if (operation === 'dshmk-detail') return { project: dshmkProject, related: [], sourceMode: 'bundled', sourceUrl: 'https://dshmk.com/catalog.json' }
      return {}
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByText('dshmk-project')
    fireEvent.click(screen.getByRole('button', { name: zh.nextPage }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('dshmk-catalog', expect.objectContaining({ page: 2, pageSize: 24 })) })
    const main = document.querySelector<HTMLElement>('main[data-section="github"]')!
    main.scrollTop = 413
    fireEvent.click(screen.getByRole('button', { name: zh.details }))
    await screen.findByRole('dialog', { name: 'dshmk-project' })
    fireEvent.click(screen.getByRole('button', { name: zh.closeDetails }))
    expect(main.scrollTop).toBe(413)
    expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: zh.filters }))
    const filterDialog = screen.getByRole('dialog', { name: zh.filters })
    expect(within(filterDialog).getByText(zh.searchScope)).toBeTruthy()
    expect(within(filterDialog).getByText(zh.communityCategories)).toBeTruthy()
    expect(within(filterDialog).getByText(zh.projectType)).toBeTruthy()
    expect(within(filterDialog).getByText(zh.validationFilter)).toBeTruthy()
    expect(within(filterDialog).getByRole('button', { name: zh.searchTags })).toBeTruthy()
    expect(within(filterDialog).getByRole('button', { name: zh.installableOnly })).toBeTruthy()
    expect(within(filterDialog).getByRole('button', { name: zh.referenceOnly })).toBeTruthy()
    expect(within(filterDialog).getByRole('button', { name: zh.ambiguousOnly })).toBeTruthy()
    expect(within(filterDialog).getByRole('button', { name: zh.localBuildOnly })).toBeTruthy()
    fireEvent.click(within(filterDialog).getByRole('button', { name: `48 / ${zh.page}` }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('hub-save-preferences', { pageSize: 48 }) })
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('dshmk-catalog', expect.objectContaining({ page: 1, pageSize: 48 })) })
  })

  it('distinguishes one-click, reference, ambiguous, and local DSHMK plans', async () => {
    const catalog = { ...dshmkCatalog, items: [dshmkProject, dshmkReferenceProject, dshmkAmbiguousProject, dshmkLocalProject], total: 4 }
    const requestHub = hubRequest({ 'dshmk-catalog': catalog })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    expect(await screen.findByText('reference-project')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.oneClickSetup }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.referenceSetup }).disabled).toBe(true)
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: zh.ambiguousSetup }).some(button => button.disabled)).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.localBuildRequired }).disabled).toBe(true)

    const referenceCard = screen.getByText('reference-project').closest('article')!
    fireEvent.click(within(referenceCard).getByRole('button', { name: zh.details }))
    expect(await screen.findByRole('dialog', { name: 'reference-project' })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.copyInstallReference })).toBeTruthy()
  })

  it('requires confirmation before installing an unpinned GitHub project', async () => {
    const catalog = { ...dshmkCatalog, items: [dshmkUnpinnedProject], total: 1 }
    const requestHub = hubRequest({
      'dshmk-catalog': catalog,
      'dshmk-install': { activeBundles: ['unpinned-project'], message: 'installed', packageNames: ['unpinned-project'], profile: 'web' },
    })
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByText('unpinned-project')
    fireEvent.click(screen.getByRole('button', { name: zh.oneClickSetup }))
    expect(await screen.findByRole('dialog', { name: zh.unpinnedSourceTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.cancelUnpinned }))
    expect(requestHub).not.toHaveBeenCalledWith('dshmk-install', expect.anything(), expect.anything())

    fireEvent.click(screen.getByRole('button', { name: zh.oneClickSetup }))
    fireEvent.click(await screen.findByRole('button', { name: zh.continueUnpinned }))
    await waitFor(() => {
      expect(requestHub).toHaveBeenCalledWith('dshmk-install', { allowUnpinned: true, repositoryId: 105 }, expect.anything())
    })
  })

  it('shows native progress, forwards cancellation, and restores install actions after failure', async () => {
    let rejectInstall: ((error: Error) => void) | undefined
    const requestHub = vi.fn((operation: string, _payload?: Readonly<Record<string, unknown>>, options?: { readonly onProgress?: (progress: typeof progressUpdate) => void }) => {
      if (operation === 'hub-snapshot') return Promise.resolve(emptySnapshot)
      if (operation === 'dshmk-catalog') return Promise.resolve(dshmkCatalog)
      if (operation === 'setup-cancel') return Promise.resolve({ cancelled: true })
      if (operation === 'dshmk-install') return new Promise((_resolve, reject) => {
        rejectInstall = reject
        queueMicrotask(() => { options?.onProgress?.(progressUpdate) })
      })
      return Promise.resolve({})
    }) as unknown as SetupHubSettingsTabProps['requestHub']
    const progressUpdate = { detail: 'example-dshmk', message: '正在激活组件', percent: 88, stage: 'activation' as const, timestamp: '2026-08-16T00:00:00Z' }
    render(<SetupHubDesktopSurface {...runtimeProps} desktopAvailable list={async () => ({ schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] })} install={async () => 'ok'} requestHub={requestHub} openConfig={() => {}} leaveHub={() => {}} t={t} />)

    await screen.findByRole('heading', { name: zh.homeTitle })
    fireEvent.click(screen.getByRole('button', { name: zh.navGitHub }))
    await screen.findByText('dshmk-project')
    fireEvent.click(screen.getByRole('button', { name: zh.oneClickSetup }))
    expect(await screen.findByRole('dialog', { name: zh.setupProgressTitle })).toBeTruthy()
    expect(await screen.findByText('正在激活组件')).toBeTruthy()
    expect(screen.getByText(zh.setupStageActivation)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.cancelInstall }))
    await waitFor(() => { expect(requestHub).toHaveBeenCalledWith('setup-cancel') })
    await act(async () => { rejectInstall?.(new Error('cancelled by user')) })
    expect(await screen.findByText(zh.installationFailed)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh.close }).at(-1)!)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.oneClickSetup }).disabled).toBe(false)
  })
})
