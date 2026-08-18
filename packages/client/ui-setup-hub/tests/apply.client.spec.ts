// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, NS } from '../src/client/index.ts'
import {
  SetupHubDesktopSurface, SetupHubSettingsTab, type SetupHubSettingsTabInjected,
} from '../src/client/SetupHubSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.plugins.tab': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-setup-hub browser plugin', () => {
  it('declares only the services used by the Settings contribution', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers a lazy localized HUB tab and parses its catalog', async () => {
    const b = await bench()
    declare(b.slots)
    const response = { schemaVersion: 1, generatedAt: '2026-08-15T00:00:00.000Z', source: 'https://example.com', entries: [] }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => response }))
    vi.stubGlobal('fetch', fetchMock)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(SetupHubSettingsTab)
    expect(entry.options).toMatchObject({ id: 'hub', order: 5 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('HUB')
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => SetupHubSettingsTabInjected)()
    expect(injected.desktopAvailable).toBe(false)
    await expect(injected.list()).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith('/setup/registry.json', {
      cache: 'no-cache', headers: { accept: 'application/json' },
    })
    await b.ctx.fiber.dispose()
  })

  it('registers the dedicated desktop surface only for the HUB URL', async () => {
    window.history.replaceState({}, '', '/?dshSurface=hub')
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = b.slots.entries('shell.overlay')[0]!
    expect(entry.component).toBe(SetupHubDesktopSurface)
    expect(entry.options).toMatchObject({ id: 'setup-hub-desktop', order: -100 })
    expect(entry.locale).toBe(NS)

    await fiber.dispose()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('recovers across late declaration and removes dictionaries on unload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('HUB')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(SetupHubSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
