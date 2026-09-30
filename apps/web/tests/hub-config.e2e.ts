// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { en, zh } from '../../../packages/client/ui-setup-hub/lib/types/client/locales.js'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()
afterEach(() => { Object.defineProperty(window, 'chrome', { configurable: true, value: undefined }) })

it.each([
  ['zh-CN', 'hub', 'light'], ['en-US', 'hub', 'dark'], ['zh-CN', 'dsh', 'light'], ['en-US', 'dsh', 'dark'],
])('edits CONFIG and guards departure in assembled %s %s %s', async (language, surface, theme) => {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  const dictionary = language === 'zh-CN' ? zh : en
  const listeners = new Set<(event: { data: unknown }) => void>()
  const requests: string[] = []
  let values: Record<string, unknown> = surface === 'hub' ? {
    WindowChrome: 'system', Theme: theme, StartPage: 'home', PageSize: 24,
    LoadingStyle: 'whales', CloseAction: 'exit', ShowTrayButton: true, AllowDesktopPlugins: false,
    DetailEntry: 'button', DetailMode: 'side', DetailContent: 'native', DiscoverySource: 'dshmk',
  } : { WindowChrome: 'system', Language: language, ResolutionWidth: 1280, ResolutionHeight: 800, LaunchMode: 'window', LoadingStyle: 'whales', CloseAction: 'tray', ShowTrayButton: true, ToolbarAutoHide: true, ToolbarEdgeReveal: false, ToolbarHotkey: 'F8', FullscreenHotkey: 'F11', FullscreenShowToolbar: false, FullscreenShowTaskbar: false, EnableExtensions: false, Extensions: [], InjectCss: '', InjectJs: '', NodePath: '', RepoPath: '', Port: 3080, Url: 'http://127.0.0.1:3080', DevTools: true, ExternalLinksInBrowser: true }
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    postMessage: (request: { type: string; requestId: string; operation: string; payload?: { values?: object } }) => {
      if (request.type !== 'dsh-hub-request') return
      requests.push(request.operation)
      if (request.operation === 'config-save') values = { ...values, ...request.payload?.values }
      const data = request.operation === 'hub-snapshot' ? { account: { authenticated: false }, installed: [], library: [], offline: [], libraryPath: '', offlinePath: '' }
        : request.operation === 'config-read' || request.operation === 'config-save' ? { target: surface, revision: 'fixture', values } : {}
      queueMicrotask(() => { for (const listener of listeners) listener({ data: { type: 'dsh-hub-result', requestId: request.requestId, ok: true, data } }) })
    },
  } } })
  mountAssembledApp(surface === 'hub' ? `?fixture&dshSurface=hub&dshHubTheme=${theme}` : '?fixture')
  if (surface === 'hub') {
    const navigation = await screen.findByRole('complementary', { name: dictionary.functionArea }, { timeout: 15_000 })
    fireEvent.click(within(navigation).getByRole('button', { name: 'CONFIG' }))
  }
  else {
    fireEvent.click(await screen.findByRole('button', { name: language === 'zh-CN' ? '设置' : 'Settings' }, { timeout: 15_000 }))
    fireEvent.click(await screen.findByRole('button', { name: 'CONFIG' }))
  }
  const controls = await screen.findByLabelText(dictionary.configFieldWindowChrome)
  fireEvent.change(controls, { target: { value: 'traffic' } })
  const capture = (suffix: string): void => {
    const directory = process.env.DSH_HUB_REVIEW_OUTPUT
    if (!directory) return
    const copy = document.documentElement.cloneNode(true) as HTMLElement
    for (const script of copy.querySelectorAll('script')) script.remove()
    if (theme === 'dark') copy.querySelector('body')!.setAttribute('data-ds-dark-theme', '')
    else copy.querySelector('body')!.removeAttribute('data-ds-dark-theme')
    const liveSelects = document.querySelectorAll('select')
    copy.querySelectorAll('select').forEach((select, index) => {
      for (const option of select.options) option.toggleAttribute('selected', option.value === liveSelects[index]?.value)
    })
    const style = document.createElement('style')
    style.textContent = readFileSync(join(process.cwd(), 'packages/client/web/src/base.css'), 'utf8')
    copy.querySelector('head')!.append(style)
    const charset = document.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    copy.querySelector('head')!.prepend(charset)
    writeFileSync(join(directory, `config-${language}-${surface}-${suffix}.html`), '<!doctype html>' + copy.outerHTML)
  }
  capture('draft')
  const departureLabel = surface === 'hub' ? dictionary.configClose : language === 'zh-CN' ? '关闭' : 'Close'
  fireEvent.click(screen.getByRole('button', { name: departureLabel }))
  await screen.findByRole('dialog', { name: dictionary.configLeaveTitle })
  capture('prompt')
  fireEvent.click(screen.getByRole('button', { name: dictionary.configStay }))
  expect(screen.getByLabelText(dictionary.configFieldWindowChrome)).toBe(controls)
  fireEvent.click(screen.getByRole('button', { name: dictionary.configSave }))
  await waitFor(() => { expect(requests).toContain('config-restart') })
  expect(values.WindowChrome).toBe('traffic')
})
