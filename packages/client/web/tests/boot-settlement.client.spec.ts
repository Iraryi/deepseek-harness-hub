import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {
  awaitClientEntriesActive, collectClientEntryFailures, publishDesktopBootStatus,
  type DesktopBootStatus,
} from '../src/boot.tsx'
import { STATE_LABELS } from '../src/loader-status.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('client boot settlement', () => {
  it('waits for a service supplied by a delayed child plugin', async () => {
    context = new Context()
    await context.plugin(Loader)
    let consumerActivated = false

    const lateSlots = {
      name: 'late-slots',
      apply(ctx: Context) {
        ctx.provide('slots', {} as never)
      },
    }
    const provider = {
      name: 'provider',
      apply(ctx: Context) {
        setTimeout(() => { void ctx.plugin(lateSlots).await() }, 50)
      },
    }
    const consumer = {
      name: 'consumer',
      inject: ['slots'],
      apply() {
        consumerActivated = true
      },
    }
    const modules = new Map<string, unknown>([
      ['provider', provider],
      ['consumer', consumer],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const plugin = modules.get(specifier)
        if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return plugin
      },
    } as never

    await context.loader.create({ name: 'provider' })
    const consumerId = await context.loader.create({ name: 'consumer' })
    await context.loader.await()
    const consumerEntry = context.loader.resolve(consumerId)
    expect(STATE_LABELS[consumerEntry.fiber!.state]).toBe('pending')

    await awaitClientEntriesActive(context, 1_000)

    expect(consumerActivated).toBe(true)
    expect(STATE_LABELS[consumerEntry.fiber!.state]).toBe('active')
  })

  it('reports the entry and missing services after a bounded pending wait', async () => {
    context = new Context()
    await context.plugin(Loader)
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== 'consumer') throw new Error(`unexpected Loader import: ${specifier}`)
        return { name: 'consumer', inject: ['slots', 'locale'], apply() {} }
      },
    } as never

    await context.loader.create({ name: 'consumer' })
    await context.loader.await()
    await awaitClientEntriesActive(context, 10)

    expect(collectClientEntryFailures(context)).toEqual([{
      name: 'consumer',
      state: 'pending',
      missingServices: ['slots', 'locale'],
    }])
  })

  it('publishes navigation-scoped ready and failed status payloads', () => {
    const postMessage = vi.fn()
    const target: {
      location: { search: string }
      chrome: { webview: { postMessage: typeof postMessage } }
      __DSH_DESKTOP_BOOT_STATUS__?: DesktopBootStatus
    } = {
      location: { search: `?desktopBoot=${'a'.repeat(32)}` },
      chrome: { webview: { postMessage } },
    }

    publishDesktopBootStatus({ state: 'ready', retryable: false, failures: [] }, target)
    publishDesktopBootStatus({
      state: 'failed',
      retryable: true,
      failures: [{ name: 'consumer', state: 'pending', missingServices: ['slots'] }],
      message: 'web boot failed',
    }, target)

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: 'dsh-web-boot-status',
      bootId: 'a'.repeat(32),
      state: 'ready',
      retryable: false,
      failures: [],
    })
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'dsh-web-boot-status',
      bootId: 'a'.repeat(32),
      state: 'failed',
      retryable: true,
      failures: [{ name: 'consumer', state: 'pending', missingServices: ['slots'] }],
      message: 'web boot failed',
    })
    expect(target.__DSH_DESKTOP_BOOT_STATUS__).toEqual(postMessage.mock.calls[1]![0])
  })
})
