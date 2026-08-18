/**
 * Web shell boot kernel — the face consumed by the apps/web entry. Everything
 * here is machinery that cannot itself be a loader entry, and none of it
 * value-imports a plugin package (shell self-sufficiency rule: the
 * loading page must work while — especially when — plugins fail). The one
 * sanctioned exception is the modules package (bootstrap
 * identity): the module system cannot arrive through itself, so its class
 * and its client-half wrapper are shell-bundled and the kernel adopts its
 * plugin entry once cordis is up.
 *
 * AppWebEntry.run(), module face first, then plugin face: parse
 * `window.__DSH_BOOT__` into the two-view BootManifest (wire boundary)
 * → build the module system over the module-view rows → render the loading
 * page → prefetch every `immediately` row in parallel with mounting the
 * vendored cordis Loader (`internal` contract injection BEFORE any entry exists —
 * the bare-import fallback in tree.import must never run in a browser) →
 * await the prefetch tier, THEN adopt the modules entry and create one
 * loader entry per plugin-view row plus the shell-own app-shell assembly
 * entry → loader.await() + a bounded activation wait + a full fiber sweep (all ACTIVE, else fail
 * listing who/what/which service) → flip the settled signal so AppRoot
 * switches to the real UI in one pass.
 *
 * Entry creation waits for the whole immediately tier: materialization runs
 * synchronous cross-package require edges (e.g. locale → runtime/client) that
 * fiber inject waiting cannot protect — a bundle's factory must be
 * registered before any dependent entry materializes. Per-row prefetch
 * failures still resolve silently (the create-side import reloads and
 * owns the loud failure), so the barrier never turns one bad bundle into a
 * boot-wide fail-fast.
 *
 * Composition lives in the host graph; the shell makes zero composition
 * decisions (the app-shell assembly is itself a graph entry, the only
 * shell-own module registered with the module system).
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRoot, type Root } from 'react-dom/client'
import * as ModulesClient from '@deepseek-ai/dsh-client-modules/client'
import {
  ClientModuleSystem, parseBootManifest,
  type BootManifest, type ClientModuleSystemOptions, type DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import * as AppShell from './app-shell.ts'
import { APP_SHELL_ID } from './app-shell.ts'
import { AppRoot } from './AppRoot.tsx'
import { getStaticModules } from './seed.ts'
import {
  STATE_LABELS, createLoaderStatusStore, createSignal, type LoaderEntryState,
} from './loader-status.ts'
import './base.css'

/** Module transport hook the shell passes through (jsdom tests replace the <script> path). */
export type BootSeams = Pick<ClientModuleSystemOptions, 'loadBundle'>

/**
 * The modules package's own graph row id. The kernel adopts that entry
 * itself (its wrapper is statically registered — shell-bundled code, never
 * fetched), so the plugin-row loop must skip it: the vendored Group.create
 * does not deduplicate by name, and a second fiber would provide 'modules'
 * twice.
 */
const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const DESKTOP_BOOT_HEARTBEAT_MILLISECONDS = 5_000
const DESKTOP_BOOT_ACTIVATION_TIMEOUT_MILLISECONDS = 60_000

const DESKTOP_BOOT_ID = /^[0-9a-f]{32}$/

/** One loader entry that did not reach ACTIVE during browser boot. */
export interface ClientEntryFailure {
  /** Loader entry name from the host-authored graph. */
  name: string
  /** Final observed lifecycle state, or import-failed when no fiber exists. */
  state: LoaderEntryState | 'import-failed'
  /** Required services that were absent when a pending entry was audited. */
  missingServices: string[]
}

/** Structured browser boot state consumed by the Windows WebView2 launcher. */
export interface DesktopBootStatus {
  /** Message discriminator. */
  type: 'dsh-web-boot-status'
  /** Navigation-specific token supplied through the desktopBoot query parameter. */
  bootId: string
  /** Current browser boot outcome. */
  state: 'loading' | 'ready' | 'failed'
  /** Whether a fresh navigation may recover this failure. */
  retryable: boolean
  /** Entries that prevented activation; empty outside failed state. */
  failures: ClientEntryFailure[]
  /** Human-readable report shared with the loading failure page. */
  message?: string
}

interface DesktopWebViewMessageEvent {
  readonly data: unknown
}

interface DesktopWebViewBridge {
  postMessage(message: unknown): void
  addEventListener?(type: 'message', listener: (event: DesktopWebViewMessageEvent) => void): void
  removeEventListener?(type: 'message', listener: (event: DesktopWebViewMessageEvent) => void): void
}

interface DesktopBootStatusTarget {
  location?: { readonly search: string; reload?(): void }
  chrome?: { webview?: DesktopWebViewBridge }
  __DSH_DESKTOP_BOOT_STATUS__?: DesktopBootStatus
}

/**
 * Audit loader entries without changing their state.
 * @param ctx - Client Loader context whose entries have completed their bounded activation wait.
 * @returns one diagnostic row for each entry that is not active.
 */
export function collectClientEntryFailures(ctx: Context): ClientEntryFailure[] {
  const failures: ClientEntryFailure[] = []
  for (const entry of ctx.loader.entries()) {
    const name = entry.options.name
    if (entry.fiber === undefined) {
      failures.push({ name, state: 'import-failed', missingServices: [] })
      continue
    }
    const state = STATE_LABELS[entry.fiber.state]
    if (state === 'active') continue
    const missingServices = state === 'pending'
      ? Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
      : []
    failures.push({ name, state, missingServices })
  }
  return failures
}

/**
 * Publish a navigation-scoped boot update when the WebView2 bridge is present.
 * @param update - Boot state and diagnostics for the current page.
 * @param target - Browser global; tests may supply an isolated target.
 */
export function publishDesktopBootStatus(
  update: Omit<DesktopBootStatus, 'type' | 'bootId'>,
  target: DesktopBootStatusTarget = globalThis,
): void {
  const bootId = new URLSearchParams(target.location?.search ?? '').get('desktopBoot')
  if (bootId === null || !DESKTOP_BOOT_ID.test(bootId)) return
  const status: DesktopBootStatus = { type: 'dsh-web-boot-status', bootId, ...update }
  target.__DSH_DESKTOP_BOOT_STATUS__ = status
  target.chrome?.webview?.postMessage(status)
}

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function requestApplicationRestart(
  target: DesktopBootStatusTarget = globalThis,
): Promise<void> {
  const webview = target.chrome?.webview
  if (webview?.addEventListener === undefined || webview.removeEventListener === undefined) {
    target.location?.reload?.()
    return
  }

  const requestId = globalThis.crypto.randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      webview.removeEventListener?.('message', onMessage)
      reject(new Error('Application restart request timed out'))
    }, 10_000)
    const onMessage = (event: DesktopWebViewMessageEvent): void => {
      if (!isMessageRecord(event.data) || event.data.type !== 'dsh-hub-result'
        || event.data.requestId !== requestId) return
      globalThis.clearTimeout(timer)
      webview.removeEventListener?.('message', onMessage)
      if (event.data.ok === true) resolve()
      else reject(new Error(typeof event.data.message === 'string' ? event.data.message : 'Application restart failed'))
    }
    webview.addEventListener?.('message', onMessage)
    webview.postMessage({ type: 'dsh-hub-request', requestId, operation: 'app-reload', payload: {} })
  })
}

function renderClientEntryFailures(failures: readonly ClientEntryFailure[]): string {
  const rows = failures.map((failure) => {
    if (failure.state === 'import-failed') {
      return `${failure.name}: import failed (see console for the import error)`
    }
    if (failure.state === 'pending') {
      const services = failure.missingServices.join(', ') || 'unknown'
      return `${failure.name}: pending (waiting for service${failure.missingServices.length === 1 ? '' : 's'}: ${services})`
    }
    return `${failure.name}: ${failure.state}`
  })
  return `web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${rows.join('\n')}`
}

class ClientEntryActivationError extends Error {
  readonly failures: ClientEntryFailure[]
  readonly retryable: boolean

  constructor(failures: ClientEntryFailure[]) {
    super(renderClientEntryFailures(failures))
    this.name = 'ClientEntryActivationError'
    this.failures = failures
    this.retryable = failures.length > 0 && failures.every(failure => failure.state === 'pending')
  }
}

/**
 * Wait briefly for entry fibers whose required services are supplied by child
 * plugins created after their owning entry root has settled.
 * @param ctx - Client Loader context whose entries must activate.
 * @param timeoutMs - Maximum grace period before the caller performs its loud audit.
 * @returns once no entry is pending lifecycle work, or the grace period expires.
 */
export async function awaitClientEntriesActive(ctx: Context, timeoutMs = 30_000): Promise<void> {
  const waiting = (): boolean => [...ctx.loader.entries()].some((entry) => {
    if (entry.fiber === undefined) return false
    const state = STATE_LABELS[entry.fiber.state]
    return state === 'pending' || state === 'loading' || state === 'unloading'
  })
  if (!waiting()) return

  await new Promise<void>((resolve) => {
    let done = false
    const handles: { timer?: ReturnType<typeof setTimeout>; dispose?: () => boolean } = {}
    const finish = (): void => {
      if (done) return
      done = true
      if (handles.timer !== undefined) clearTimeout(handles.timer)
      handles.dispose?.()
      resolve()
    }
    const check = (): void => {
      if (!waiting()) finish()
    }
    handles.dispose = ctx.on('internal/status', check)
    handles.timer = setTimeout(finish, timeoutMs)
    check()
  })
}

/**
 * The web shell kernel: mounts the loading page into a DOM element and runs
 * the two-stage boot over the host graph. Fields hold only what must exist
 * before cordis does — the parsed manifest, the module system, and the
 * loading-page UI handles; everything else lives in plugins.
 */
export class AppWebEntry {
  private readonly el: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly status = createLoaderStatusStore()
  private readonly settled = createSignal(false)
  private readonly error = createSignal<string | undefined>(undefined)
  // Assigned by run() before any private method or settled-gated closure reads them.
  private ctx!: Context
  private modules!: ClientModuleSystem
  private manifest!: BootManifest
  private root: Root | undefined
  private desktopBootHeartbeat: ReturnType<typeof setInterval> | undefined
  private desktopBootStage = 'Preparing Web UI'

  /**
   * Hold the mount point; all work happens in {@link run}.
   * @param el - mount point (the app's #root).
   * @param seams - Optional module transport overrides for test environments.
   */
  constructor(el: HTMLElement, seams?: BootSeams) {
    this.el = el
    this.seams = seams
  }

  private setDesktopBootStage(stage: string): void {
    this.desktopBootStage = stage
    publishDesktopBootStatus({
      state: 'loading', retryable: false, failures: [], message: stage,
    })
  }

  private startDesktopBootHeartbeat(): void {
    if (this.desktopBootHeartbeat !== undefined) return
    this.setDesktopBootStage(this.desktopBootStage)
    this.desktopBootHeartbeat = globalThis.setInterval(() => {
      this.setDesktopBootStage(this.desktopBootStage)
    }, DESKTOP_BOOT_HEARTBEAT_MILLISECONDS)
  }

  private stopDesktopBootHeartbeat(): void {
    if (this.desktopBootHeartbeat === undefined) return
    globalThis.clearInterval(this.desktopBootHeartbeat)
    this.desktopBootHeartbeat = undefined
  }

  /**
   * Run the boot chain to settlement. Boot-chain failures resolve (not
   * reject): the loading page stays up and renders the failure report (the
   * fail-loud surface the kernel owns). Rejects only when the boot manifest
   * is missing or malformed — there is nothing to boot against.
   * @returns resolves once the UI settled or the failure report rendered.
   */
  async run(): Promise<void> {
    this.startDesktopBootHeartbeat()
    try {
      this.manifest = parseBootManifest((globalThis as DshWindow).__DSH_BOOT__)
      this.setDesktopBootStage('Web UI manifest ready')
    } catch (reason) {
      this.publishBootFailure(reason)
      this.stopDesktopBootHeartbeat()
      throw reason
    }

    this.modules = new ClientModuleSystem({
      modules: this.manifest.modules, staticModules: getStaticModules(), ...this.seams,
    })
    // The app-shell assembly is the only shell-own module: every other graph
    // row is a plugin bundle arriving through fetch.
    this.modules.registerStatic(APP_SHELL_ID, AppShell)
    // Adoption handoff, supply side: register the modules
    // package's own client half under its bare package name (= graph row id
    // = entry name — a suffixed key would miss the statics branch and
    // trigger a real fetch), and put the instance on the kernel slot the
    // wrapper's apply reads to provide ctx.modules.
    this.modules.registerStatic(MODULES_ID, ModulesClient)
    ;(globalThis as DshWindow).__DSH_MODULES__ = this.modules

    this.root = createRoot(this.el)
    this.root.render(
      <AppRoot
        settled={this.settled}
        status={this.status}
        error={this.error}
        restartApplication={requestApplicationRestart}
        renderApp={() => {
          const shell = this.ctx.get('appShell')
          // Unreachable after a clean settle (the app-shell entry is in every graph).
          if (shell === undefined) throw new Error('web boot: appShell service missing after settled')
          return shell.renderApp()
        }}
      />,
    )

    // The immediately tier prefetches in parallel with Loader mounting;
    // runPluginBoot awaits it before creating entries (see module comment:
    // cross-package synchronous require edges need every immediately-tier
    // factory registered before any materialization).
    const prefetching = this.prefetchImmediateTier()
    this.ctx = new Context()
    try {
      this.setDesktopBootStage('Activating Web UI plugins')
      await this.runPluginBoot(prefetching)
      this.settled.set(true)
      publishDesktopBootStatus({ state: 'ready', retryable: false, failures: [] })
      this.stopDesktopBootHeartbeat()
    } catch (reason) {
      // Stay on the loading page; surface the sweep report (fail loud).
      console.error(reason)
      const message = reason instanceof Error ? reason.message : String(reason)
      this.error.set(message)
      this.publishBootFailure(reason)
      this.stopDesktopBootHeartbeat()
    }
  }

  /** Unmount the shell (loading page or settled UI). */
  dispose(): void {
    this.stopDesktopBootHeartbeat()
    this.root?.unmount()
  }

  /** Prefetch the immediately tier (factory registration only; failures defer to the import path). */
  private async prefetchImmediateTier(): Promise<void> {
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch(() => {
        // Import reloads and reports this loudly per entry; swallowing
        // here keeps one failing prefetch from masking the others.
      })))
  }

  /** Plugin face: mount the Loader, inject the `internal` contract, adopt modules, create the graph entries, settle, sweep. */
  private async runPluginBoot(prefetching: Promise<void>): Promise<void> {
    const ctx = this.ctx
    await ctx.plugin(Loader)
    const loader = ctx.loader
    // Inject the module system BEFORE any entry exists: tree.import falls back
    // to a bare dynamic import when internal is undefined, which in a browser
    // is a guaranteed loud failure — correct as a tripwire, never as a path.
    loader.internal = this.modules as never

    // Status projection: AppRoot displays fiber truth. Every internal/status
    // transition under an entry re-projects that entry's row from its ROOT
    // fiber (child plugin fibers share the same entry).
    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.status.set(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    // Barrier before any entry exists: entry creation materializes bundles,
    // and materialization runs synchronous cross-package require edges that
    // need every immediately-tier factory already registered (module
    // comment). Resolves even when individual prefetches failed.
    this.setDesktopBootStage('Prefetching browser bundles')
    await prefetching
    this.setDesktopBootStage('Creating Web UI plugins')

    // Adoption handoff, plugin side: the modules entry is created first —
    // its wrapper apply reads the kernel slot and provides ctx.modules (the
    // provide lives on the plugin face; see MODULES_ID for why the row loop
    // must then skip it).
    const rows = [MODULES_ID, ...this.manifest.plugins.map(row => row.id).filter(id => id !== MODULES_ID), APP_SHELL_ID]
    // Entry creation order carries no semantics (fiber inject waiting owns
    // activation order); creating concurrently lets non-prefetched bundle
    // loads parallelize. The app-shell assembly entry is appended by the
    // kernel: it is shell-own code (host graph rows are all plugin bundles),
    // and mounting the assembly is not a composition decision — it rides the
    // same entry lifecycle so the sweep and status cover it uniformly.
    await Promise.all(rows.map(async (name) => {
      this.status.set(name, 'loading')
      const id = await loader.create({ name })
      // A failed import leaves the entry fiberless (Entry._init logs and
      // returns); project it as failed — no fiber means no status event.
      if (loader.resolve(id).fiber === undefined) {
        this.status.set(name, 'failed')
      }
    }))

    await loader.await()
    this.setDesktopBootStage('Waiting for plugin services')
    await awaitClientEntriesActive(ctx, DESKTOP_BOOT_ACTIVATION_TIMEOUT_MILLISECONDS)
    this.setDesktopBootStage('Checking plugin activation')
    this.assertEntriesActive()
  }

  /**
   * Sweep every loader entry after the tree quiesced: an entry without a
   * fiber failed its import; a fiber not ACTIVE is FAILED (apply threw) or
   * PENDING (a required service never arrived — cordis inject waiting has no
   * timeout, so this sweep is the fail-loud compensation).
   */
  private assertEntriesActive(): void {
    const failures = collectClientEntryFailures(this.ctx)
    if (failures.length > 0) {
      throw new ClientEntryActivationError(failures)
    }
  }

  private publishBootFailure(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason)
    const activation = reason instanceof ClientEntryActivationError ? reason : undefined
    publishDesktopBootStatus({
      state: 'failed',
      retryable: activation?.retryable ?? false,
      failures: activation?.failures ?? [{ name: 'web-shell', state: 'failed', missingServices: [] }],
      message,
    })
  }
}
