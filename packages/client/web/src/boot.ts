/**
 * Web boot kernel. It owns only the module system, Cordis loader, and a
 * framework-free boot page. The dynamic UI renderer receives the mount
 * point after every client entry activates.
 * @module @deepseek-ai/dsh-client-web/src/boot
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {
  BootManifest, ClientModuleCreateOptions, ClientModuleSystem, DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BootPage } from './boot-page.ts'
import { getStaticModules } from './seed.ts'
import { STATE_LABELS } from './loader-status.ts'
import './base.css'

/** Module transport hook replaced by jsdom tests. */
export type BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>

interface ClientEntryFailure {
  name: string
  state: string
  missingServices: string[]
}

/** Browser boot entry consumed by `apps/web`. */
export class AppWebEntry {
  private readonly container: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly page: BootPage
  private ctx: Context | undefined
  private modules!: ClientModuleSystem
  private manifest!: BootManifest
  private readonly desktopBootId = new URLSearchParams(globalThis.location?.search ?? '').get('desktopBoot')
  private booting = false
  private failures: ClientEntryFailure[] = []

  /**
   * Draw the boot page; {@link run} starts the loader.
   * @param container - Application mount point.
   * @param seams - Optional module transport replacement.
   */
  constructor(container: HTMLElement, seams?: BootSeams) {
    this.container = container
    this.seams = seams
    this.page = new BootPage(container)
  }

  /**
   * Load and activate every client entry, then hand the mount point to the
   * UI renderer. Plugin failures remain visible on the boot page.
   * @returns Resolves after application mount or failure rendering.
   */
  async run(): Promise<void> {
    this.booting = true
    this.reportDesktopBoot('loading', 'Preparing client modules')
    try {
      // Boot-readiness gate: whichever bootstrap applies the injection table
      // settles this deferred once every row has taken effect — the served
      // index resolves it in the rendered tail, so the await returns on the
      // next microtask; an asynchronous bootstrap resolves it after its last
      // row, or rejects it into the failure rendering below. An absent global
      // means no bootstrap owns the document and there is nothing to wait for.
      await (globalThis as { __DSH_BOOT_READY__?: { promise: Promise<void> } }).__DSH_BOOT_READY__?.promise
      const win = globalThis as DshWindow
      const moduleLoader = win.__ModuleLoader__
      if (moduleLoader === undefined) {
        throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
      }
      // A pre-injected transport (the worker preview page) owns bundle bytes;
      // its loadBundle is the default and explicit seams still win. The global
      // is `ClientTransportHooks`, owned by @deepseek-ai/dsh-client-connection;
      // this structural slice reads one optional member without adding a
      // package edge.
      const transport = (globalThis as {
        __DSH_TRANSPORT__?: { loadBundle?: ClientModuleCreateOptions['loadBundle'] }
      }).__DSH_TRANSPORT__
      this.modules = moduleLoader.create({
        boot: win.__DSH_BOOT__,
        staticModules: getStaticModules(),
        ...transport?.loadBundle === undefined ? {} : { loadBundle: transport.loadBundle },
        ...this.seams,
      })
      this.manifest = this.modules.manifest

      const prefetching = this.prefetchImmediateTier()
      this.reportDesktopBoot('loading', 'Loading client plugins')
      const ctx = new Context()
      this.ctx = ctx
      await this.runPluginBoot(ctx, prefetching)
      await this.mountApp(ctx)
      this.reportDesktopBoot('ready', 'Interface ready')
    } catch (reason) {
      console.error(reason)
      const message = reason instanceof Error ? reason.message : String(reason)
      this.page.fail(message)
      this.reportDesktopBoot('failed', message)
    } finally {
      this.booting = false
    }
  }

  private reportDesktopBoot(state: 'loading' | 'ready' | 'failed', message: string): void {
    const bootId = this.desktopBootId
    if (bootId === null || !/^[0-9a-f]{32}$/u.test(bootId)) return
    const target = globalThis as typeof globalThis & {
      chrome?: { webview?: { postMessage(message: unknown): void } }
      __DSH_DESKTOP_BOOT_STATUS__?: unknown
    }
    const failures = state === 'failed' ? this.failures : []
    const report = {
      type: 'dsh-web-boot-status', bootId, state, message, failures,
      retryable: failures.length > 0 && failures.every(failure => failure.state === 'pending'),
    }
    target.__DSH_DESKTOP_BOOT_STATUS__ = report
    try {
      target.chrome?.webview?.postMessage(report)
    } catch (reason) {
      console.warn('Desktop boot status could not be delivered', reason)
    }
  }

  /** Dispose the client plugin tree and whichever page owns the mount point. */
  async dispose(): Promise<void> {
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx !== undefined) await ctx.fiber.dispose()
    this.page.dispose()
  }

  /** Mount through a dependency fiber so replacing uiRenderer remounts the application. */
  private async mountApp(ctx: Context): Promise<void> {
    const mounted = ctx.inject(['uiRenderer'], (scope) => {
      scope.effect(() => scope.uiRenderer.mount(this.container), 'web boot: application mount')
    })
    await mounted
  }

  /** Prefetch stage-one bundles and their dynamic requests before concurrent plugin imports. */
  private async prefetchImmediateTier(): Promise<void> {
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch((_prefetchError: unknown) => {
        // Prefetch only starts transport early; the Loader import retries and reports this bundle failure.
      })))
  }

  /** Mount the Loader, create all graph entries, await quiescence, and audit activation. */
  private async runPluginBoot(ctx: Context, prefetching: Promise<void>): Promise<void> {
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = this.modules as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.page.setState(entry.options.name, STATE_LABELS[entry.fiber.state])
      if (this.booting) this.reportDesktopBoot('loading', `Activating ${entry.options.name}`)
    })

    const rows = this.manifest.plugins.map(row => row.id)
    this.page.setTotal(rows.length)
    await prefetching
    await Promise.all(rows.map(async (name) => {
      this.page.setState(name, 'loading')
      const id = await loader.create({ name }).catch((reason: unknown) => {
        this.failures.push({ name, state: 'import-failed', missingServices: [] })
        throw reason
      })
      if (loader.resolve(id).fiber === undefined) this.page.setState(name, 'failed')
    }))

    await loader.await()
    this.assertEntriesActive(ctx)
  }

  /** Reject entries that failed import/apply or still wait on missing services. */
  private assertEntriesActive(ctx: Context): void {
    this.failures = []
    const failures: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        this.failures.push({ name, state: 'import-failed', missingServices: [] })
        failures.push(`${name}: import failed (see console for the import error)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      const missingServices = state === 'pending'
        ? Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        : []
      this.failures.push({ name, state, missingServices })
      if (state === 'pending') {
        const missing = missingServices
        failures.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        failures.push(`${name}: ${state}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
    }
  }
}
