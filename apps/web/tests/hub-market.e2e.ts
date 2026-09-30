// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { en, zh } from '../../../packages/client/ui-setup-hub/lib/types/client/locales.js'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()
afterEach(() => { Object.defineProperty(window, 'chrome', { configurable: true, value: undefined }) })

function saveReview(name: string): void {
  const directory = process.env.DSH_HUB_REVIEW_OUTPUT
  if (!directory) return
  const copy = document.documentElement.cloneNode(true) as HTMLElement
  for (const script of copy.querySelectorAll('script')) script.remove()
  const charset = document.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  copy.querySelector('head')!.prepend(charset)
  const style = document.createElement('style')
  style.textContent = readFileSync(join(process.cwd(), 'packages/client/web/src/base.css'), 'utf8')
  copy.querySelector('head')!.append(style)
  writeFileSync(join(directory, name + '.html'), '<!doctype html>' + copy.outerHTML)
}

it.each(['zh-CN', 'en-US'])('keeps saved market usable and replaces it after refresh in %s', async (language) => {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  const dictionary = language === 'zh-CN' ? zh : en
  const listeners = new Set<(event: { data: unknown }) => void>()
  let online = false
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    postMessage: (request: { type: string; requestId: string; operation: string; payload?: { refresh?: boolean } }) => {
      if (request.type !== 'dsh-hub-request') return
      if (request.operation === 'dshmk-catalog' && request.payload?.refresh) online = true
      const data = request.operation === 'hub-snapshot' ? {
        account: { authenticated: false }, installed: [], library: [], offline: [], libraryPath: '', offlinePath: '',
      } : request.operation === 'dshmk-catalog' ? {
        categories: [], projectTypes: [], items: [], page: 1, pageSize: 24, total: 0, totalPages: 1,
        generatedAt: online ? '2026-09-29T15:34:00Z' : '2026-08-22T00:00:00Z',
        fetchedAt: online ? '2026-09-29T15:35:00Z' : '2026-08-22T00:00:00Z',
        sourceMode: online ? 'live' : 'cache', sourceUrl: 'https://dshmk.com/catalog.json',
        refreshError: online ? '' : 'Diagnostic-only native error',
      } : {}
      queueMicrotask(() => { for (const listener of listeners) listener({ data: { type: 'dsh-hub-result', requestId: request.requestId, ok: true, data } }) })
    },
  } } })
  mountAssembledApp('?fixture&dshSurface=hub&dshHubStart=github')
  await screen.findByText(dictionary.catalogCachedNotice, {}, { timeout: 15_000 })
  expect(screen.getByText(dictionary.catalogDiagnostics).closest('details')?.open).toBe(false)
  expect(screen.getAllByRole('button', { name: dictionary.retry })).toHaveLength(1)
  saveReview(`market-${language}-cache`)
  fireEvent.click(screen.getByRole('button', { name: dictionary.retry }))
  await waitFor(() => { expect(screen.queryByText(dictionary.catalogCachedNotice)).toBeNull() })
  expect(screen.getByText(dictionary.registry_live)).toBeTruthy()
  saveReview(`market-${language}-live`)
})
