// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

afterEach(() => {
  Object.defineProperty(window, 'chrome', { configurable: true, value: undefined })
})

it.each([
  ['zh-CN', 'HUB 功能区', '已安装', '定位配置', '卸载', '重新扫描插件', 'light'],
  ['en-US', 'HUB functions', 'Installed', 'Locate configuration', 'Uninstall', 'Rescan plugins', 'light'],
  ['zh-CN', 'HUB 功能区', '已安装', '定位配置', '卸载', '重新扫描插件', 'dark'],
  ['en-US', 'HUB functions', 'Installed', 'Locate configuration', 'Uninstall', 'Rescan plugins', 'dark'],
])('reconciles external components in the built HUB in %s with %s navigation', async (language, navigation, installed, locate, uninstall, rescan, theme) => {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  const listeners = new Set<(event: { data: unknown }) => void>()
  let removed = false
  const componentPath = 'D:\\isolated\\profiles\\web\\package.json'
  const postMessage = vi.fn((request: { type: string; requestId: string; operation: string }) => {
    if (request.type !== 'dsh-hub-request') return
    const data = request.operation === 'hub-snapshot' ? {
      account: { authenticated: false }, library: [], offline: [], libraryPath: 'D:\\isolated\\hub', offlinePath: 'D:\\isolated\\offline',
      installed: removed ? [] : [{ id: 'profile-local', name: 'External local plugin', version: '1.2.3', profile: 'web', kind: 'plugin', origin: 'profile', inventoryState: 'present', componentPath, homePath: 'D:\\isolated', workspacePath: '', installedAt: '', packageNames: ['local-plugin'], removable: false }],
    } : {}
    queueMicrotask(() => {
      for (const listener of listeners) listener({ data: { type: 'dsh-hub-result', requestId: request.requestId, ok: true, data } })
    })
  })
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: { webview: {
      postMessage,
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    } },
  })
  mountAssembledApp(`?fixture&dshSurface=hub&dshHubTheme=${theme}`)
  const nav = await screen.findByRole('complementary', { name: navigation }, { timeout: 15_000 })
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(installed) }))
  await screen.findByText('External local plugin')
  expect((screen.getByRole('button', { name: uninstall }) as HTMLButtonElement).disabled).toBe(true)
  const sourceLabel = language === 'zh-CN' ? '安装来源' : 'Install source'
  const hubOrigin = language === 'zh-CN' ? 'HUB 安装记录' : 'HUB receipt'
  const resetLabel = language === 'zh-CN' ? '清除筛选' : 'Clear filters'
  fireEvent.click(screen.getByRole('button', { name: new RegExp(sourceLabel) }))
  fireEvent.click(screen.getByRole('option', { name: hubOrigin }))
  expect(screen.queryByText('External local plugin')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: resetLabel }))
  expect(screen.getByText('External local plugin')).toBeTruthy()
  const reviewDirectory = process.env.DSH_HUB_REVIEW_OUTPUT
  if (reviewDirectory) {
    const documentCopy = document.documentElement.cloneNode(true) as HTMLElement
    for (const script of documentCopy.querySelectorAll('script')) script.remove()
    const head = documentCopy.querySelector('head')!
    const charset = document.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    head.prepend(charset)
    const baseStyle = document.createElement('style')
    baseStyle.textContent = readFileSync(join(process.cwd(), 'packages/client/web/src/base.css'), 'utf8')
    head.append(baseStyle)
    writeFileSync(join(reviewDirectory, `inventory-${language}-${theme}.html`), `<!doctype html>${documentCopy.outerHTML}`)
  }
  fireEvent.click(screen.getByRole('button', { name: locate }))
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ operation: 'hub-open-path', payload: { path: componentPath } }))
  removed = true
  fireEvent.click(screen.getByRole('button', { name: rescan }))
  await waitFor(() => { expect(screen.queryByText('External local plugin')).toBeNull() })
})
