// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { en, zh } from '../../../packages/client/ui-setup-hub/lib/types/client/locales.js'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()
afterEach(() => { Object.defineProperty(window, 'chrome', { configurable: true, value: undefined }) })

it.each(['zh-CN', 'en-US'])('opens management, saves enhancements and shows phone controls in assembled %s HUB', async (language) => {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  const dictionary = language === 'zh-CN' ? zh : en
  const listeners = new Set<(event: { data: unknown }) => void>()
  const operations: string[] = []
  let values = { schemaVersion: 1, enabled: true, conversationWidth: 0, plainTextPaste: false, showSessionIds: false }
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    postMessage: (request: { type: string; requestId: string; operation: string; payload?: { values?: typeof values } }) => {
      if (request.type !== 'dsh-hub-request') return
      operations.push(request.operation)
      if (request.operation === 'enhancements-save' && request.payload?.values) values = request.payload.values
      const data = request.operation === 'hub-snapshot' ? { account: { authenticated: false }, installed: [], library: [], offline: [], libraryPath: '', offlinePath: '' }
        : request.operation === 'manager-status' ? { schemaVersion: 1, distribution: 'overlay', launcherVersion: 'fixture', runtimeVersion: 'fixture', runtimePath: 'D:/fixture/runtime', nodePath: 'D:/fixture/node.exe', dataPath: 'D:/fixture/data', homePath: 'D:/fixture/home', desktopUrl: 'http://127.0.0.1:3080', desktopReachable: true, hubReady: true, checks: [{ id: 'desktop', label: 'DSH', status: 'ok', detail: 'Fixture only' }], capabilities: ['enhancements', 'mobile', 'desktop-reload'].map(id => ({ id, label: id, available: true, detail: 'Fixture capability' })) }
          : request.operation === 'enhancements-read' || request.operation === 'enhancements-save' ? { values, revision: 'fixture', restartRequired: request.operation === 'enhancements-save' }
            : request.operation === 'mobile-status' ? { running: false, available: true, reason: '', interfaces: [{ name: 'Fixture LAN', address: '192.168.56.1' }], bindAddress: null, port: null, url: null, upstreamUrl: null, transport: 'http-trusted-lan', devices: [], pairingExpiresAt: null } : {}
      queueMicrotask(() => { for (const listener of listeners) listener({ data: { type: 'dsh-hub-result', requestId: request.requestId, ok: true, data } }) })
    },
  } } })
  mountAssembledApp(`?fixture&dshSurface=hub&dshHubTheme=${language === 'zh-CN' ? 'light' : 'dark'}`)
  const navigation = await screen.findByRole('complementary', { name: dictionary.functionArea }, { timeout: 15_000 })
  const capture = (section: string): void => {
    if (!process.env.DSH_HUB_REVIEW_OUTPUT) return
    const copy = document.documentElement.cloneNode(true) as HTMLElement
    for (const script of copy.querySelectorAll('script')) script.remove()
    const liveInputs = document.querySelectorAll('input')
    copy.querySelectorAll('input').forEach((input, index) => {
      input.toggleAttribute('checked', liveInputs[index]?.checked ?? false)
      input.setAttribute('value', liveInputs[index]?.value ?? '')
    })
    const style = document.createElement('style')
    style.textContent = readFileSync(join(process.cwd(), 'packages/client/web/src/base.css'), 'utf8')
    copy.querySelector('head')!.append(style)
    const charset = document.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    copy.querySelector('head')!.prepend(charset)
    if (language === 'en-US') copy.querySelector('body')!.setAttribute('data-ds-dark-theme', '')
    writeFileSync(join(process.env.DSH_HUB_REVIEW_OUTPUT, `management-${language}-${section}.html`), '<!doctype html>' + copy.outerHTML)
  }
  fireEvent.click(within(navigation).getByRole('button', { name: dictionary.navOverview }))
  await screen.findByText('D:/fixture/home')
  capture('overview')
  fireEvent.click(within(navigation).getByRole('button', { name: dictionary.navEnhancements }))
  const width = await screen.findByRole('spinbutton', { name: language === 'zh-CN' ? '会话宽度（像素）' : 'Conversation width (px)' })
  fireEvent.change(width, { target: { value: '960' } })
  fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '保存更改' : 'Save changes' }))
  await waitFor(() => { expect(values.conversationWidth).toBe(960) })
  await screen.findByRole('button', { name: language === 'zh-CN' ? '立即重启 DSH' : 'Restart DSH now' })
  capture('enhancements')
  fireEvent.click(within(navigation).getByRole('button', { name: dictionary.navMobile }))
  await screen.findByRole('option', { name: 'Fixture LAN · 192.168.56.1' })
  expect(operations).toContain('mobile-status')
  expect(operations).not.toContain('mobile-start')
  capture('mobile')
})
