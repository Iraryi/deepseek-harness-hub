// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

afterEach(() => {
  Object.defineProperty(window, 'chrome', { configurable: true, value: undefined })
})

it.each([
  ['en-US', 'Plugin market', 'Settings'],
  ['zh-CN', '插件市场', '设置'],
])('opens HUB from the assembled sidebar in %s', async (language, label, settingsLabel) => {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  const postMessage = vi.fn()
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: { webview: { postMessage, addEventListener: () => {}, removeEventListener: () => {} } },
  })
  mountAssembledApp()
  const market = await screen.findByRole('button', { name: label }, { timeout: 15_000 })
  expect(market.querySelector('svg')).not.toBeNull()
  expect(screen.getByRole('button', { name: settingsLabel })).toBeTruthy()
  const newSessionLabel = language === 'zh-CN' ? '新建会话' : 'New session'
  const brand = screen.getAllByRole('button', { name: newSessionLabel })[0]!
  brand.focus()
  expect(document.activeElement).toBe(brand)
  expect(brand.hasAttribute('data-keyboard-navigation')).toBe(false)
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(brand.getAttribute('data-keyboard-navigation')).toBe('true')
  fireEvent.pointerDown(document.body)
  expect(brand.hasAttribute('data-keyboard-navigation')).toBe(false)
  expect(fireEvent.dragStart(brand)).toBe(false)
  const reviewDirectory = process.env.DSH_HUB_REVIEW_OUTPUT
  if (reviewDirectory) {
    const copy = document.documentElement.cloneNode(true) as HTMLElement
    for (const script of copy.querySelectorAll('script')) script.remove()
    const charset = document.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    copy.querySelector('head')!.prepend(charset)
    const style = document.createElement('style')
    style.textContent = readFileSync(join(process.cwd(), 'packages/client/web/src/base.css'), 'utf8')
    copy.querySelector('head')!.append(style)
    writeFileSync(join(reviewDirectory, `sidebar-${language}.html`), '<!doctype html>' + copy.outerHTML)
  }
  fireEvent.click(market)
  expect(postMessage.mock.calls).toMatchInlineSnapshot(`
    [
      [
        {
          "command": "open-hub",
          "type": "dsh-desktop-command",
        },
      ],
    ]
  `)
  expect(window.location.search).toBe('?fixture')
})
