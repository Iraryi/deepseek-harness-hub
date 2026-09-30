// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfigEditor } from '../src/client/ConfigEditor.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof ConfigEditor>

function mount(language: 'en' | 'zh' = 'en', rejectSave = false, initialTarget: 'dsh' | 'hub' = 'dsh') {
  let guard: (() => Promise<boolean>) | undefined
  const dictionary = language === 'en' ? en : zh
  const initial = initialTarget === 'hub' ? { WindowChrome: 'system', PreloadOnDesktopStart: true } : { WindowChrome: 'system', ResolutionWidth: 1280, ResolutionHeight: 800, Extensions: [] }
  const request = vi.fn(async (operation: string, payload?: Record<string, unknown>) => {
    if (operation === 'config-read') return { target: payload?.target, revision: 'original', values: initial }
    if (operation === 'config-save') {
      if (rejectSave) throw new Error('CONFIG_CONFLICT')
      return { target: payload?.target, revision: 'saved', values: { ...initial, ...(payload?.values as object) } }
    }
    return {}
  })
  render(<ConfigEditor requestHub={request as Props['requestHub']} initialTarget={initialTarget} desktopAvailable openConfig={vi.fn()}
    t={((key: keyof typeof en) => dictionary[key]) as Props['t']}
    registerLeaveGuard={(next) => { guard = next; return () => { guard = undefined } }} />)
  return { request, dictionary, leave: () => guard!() }
}

it.each(['zh', 'en'] as const)('persists the preload switch without saving unrelated fields in %s', async (language) => {
  const { request, dictionary } = mount(language, false, 'hub')
  fireEvent.click(await screen.findByLabelText(dictionary.configFieldPreloadOnDesktopStart))
  fireEvent.click(screen.getByRole('button', { name: dictionary.configSave }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('config-save', { target: 'hub', revision: 'original', values: { PreloadOnDesktopStart: false } }) })
})

it.each(['zh', 'en'] as const)('saves only edited fields before requesting a restart in %s', async (language) => {
  const { request, dictionary } = mount(language)
  const chrome = await screen.findByLabelText(dictionary.configFieldWindowChrome)
  expect(screen.getByRole('button', { name: dictionary.configSave }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(chrome, { target: { value: 'traffic' } })
  expect(screen.getByRole('button', { name: dictionary.configSave }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: dictionary.configSave }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('config-restart', { target: 'dsh' }) })
  expect(request).toHaveBeenCalledWith('config-save', { target: 'dsh', revision: 'original', values: { WindowChrome: 'traffic' } })
  expect(request.mock.calls.findIndex(call => call[0] === 'config-save')).toBeLessThan(request.mock.calls.findIndex(call => call[0] === 'config-restart'))
})

it('allows keeping, discarding or saving a draft when leaving', async () => {
  const { request, leave } = mount()
  fireEvent.change(await screen.findByLabelText(en.configFieldWindowChrome), { target: { value: 'traffic' } })
  let pending!: Promise<boolean>
  act(() => { pending = leave() })
  expect(screen.getByRole('dialog', { name: en.configLeaveTitle })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.configStay }))
  expect(await pending).toBe(false)
  expect((screen.getByLabelText(en.configFieldWindowChrome) as HTMLSelectElement).value).toBe('traffic')
  act(() => { pending = leave() })
  fireEvent.click(screen.getByRole('button', { name: en.configDiscard }))
  expect(await pending).toBe(true)
  expect(request.mock.calls.some(call => call[0] === 'config-save')).toBe(false)
  fireEvent.change(screen.getByLabelText(en.configFieldWindowChrome), { target: { value: 'traffic' } })
  act(() => { pending = leave() })
  fireEvent.click(screen.getByRole('button', { name: en.configSaveOnly }))
  await act(async () => { expect(await pending).toBe(true) })
  expect(request.mock.calls.some(call => call[0] === 'config-save')).toBe(true)
  expect(request.mock.calls.some(call => call[0] === 'config-restart')).toBe(false)
})

it('retains dirty changes and never restarts after a save conflict', async () => {
  const { request } = mount('en', true)
  fireEvent.change(await screen.findByLabelText(en.configFieldWindowChrome), { target: { value: 'traffic' } })
  fireEvent.click(screen.getByRole('button', { name: en.configSave }))
  await screen.findByText(en.configConflict)
  expect((screen.getByLabelText(en.configFieldWindowChrome) as HTMLSelectElement).value).toBe('traffic')
  expect(request.mock.calls.some(call => call[0] === 'config-restart')).toBe(false)
})

it('guards target switching and cancels Escape without discarding', async () => {
  mount()
  fireEvent.change(await screen.findByLabelText(en.configFieldWindowChrome), { target: { value: 'traffic' } })
  fireEvent.change(screen.getByLabelText(en.configTarget), { target: { value: 'hub' } })
  fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
  expect((screen.getByLabelText(en.configTarget) as HTMLSelectElement).value).toBe('dsh')
  expect(screen.queryByRole('dialog')).toBeNull()
})
