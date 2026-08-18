/** DSH HUB Setup catalog registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { parseSetupRegistry } from '@deepseek-ai/dsh-setup-registry'
import {
  installThroughDesktop, requestHubThroughDesktop, sendSetupDesktopCommand, setupBridgeAvailable,
} from './bridge.ts'
import {
  SetupHubDesktopSurface, SetupHubSettingsTab, type SetupHubInjected,
} from './SetupHubSettingsTab.tsx'
import { en, zh, type SetupHubLocaleKey } from './locales.ts'

export type {
  SetupHubDesktopSurfaceProps, SetupHubInjected, SetupHubSettingsTabInjected,
  SetupHubSettingsTabProps,
} from './SetupHubSettingsTab.tsx'
export type { SetupHubLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Setup catalog, evidence, and desktop installation copy. */
    'settings.setupHub': SetupHubLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.setupHub'

/** Services required by Settings registration. */
export const inject = ['slots', 'locale']

/** Contribute the HUB tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-setup-hub: dictionaries')
  const t = ctx.locale.bind(NS)
  const injected = (): SetupHubInjected => ({
    desktopAvailable: setupBridgeAvailable(),
    list: async () => {
      const response = await fetch('/setup/registry.json', { cache: 'no-cache', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`Setup registry request failed with HTTP ${response.status}`)
      return parseSetupRegistry(await response.json())
    },
    install: installThroughDesktop,
    requestHub: requestHubThroughDesktop,
    openConfig: () => { sendSetupDesktopCommand('open-config') },
    openHub: () => { sendSetupDesktopCommand('open-hub') },
    leaveHub: () => {
      if (sendSetupDesktopCommand('open-main')) return
      const url = new URL(window.location.href)
      url.searchParams.delete('dshSurface')
      window.location.assign(url)
    },
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'hub', order: 5,
    label: () => t('tab'), locale: NS, inject: injected,
  }, SetupHubSettingsTab))

  if (new URLSearchParams(window.location.search).get('dshSurface') === 'hub') {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'setup-hub-desktop', order: -100,
      locale: NS, inject: injected,
    }, SetupHubDesktopSurface))
  }
}
