import type { HubInstalledItem } from './bridge.ts'

/** Combined text, provenance, home/Profile and management-state selection. */
export interface InventoryFilter {
  readonly query: string
  readonly origin: string
  readonly profile: string
  readonly status: string
}

/**
 * Distinguish equal Profile names in different homes.
 * @param item Observed component metadata.
 * @returns Stable JSON tuple of home and Profile, with missing values empty.
 */
export function inventoryProfileKey(item: HubInstalledItem): string {
  return JSON.stringify([item.homePath ?? '', item.profile ?? ''])
}

/**
 * Identify blocked or unresolved observations without asserting runtime health.
 * @param item Observed component metadata.
 * @returns Whether the component needs inspection before management.
 */
export function inventoryNeedsAttention(item: HubInstalledItem): boolean {
  return item.uninstallBlock !== undefined || (item.inventoryState !== 'declared' && item.inventoryState !== 'present')
}

/**
 * Apply all search terms and management filters without changing observations.
 * @param items Component observations in display order.
 * @param filter Selected search and classification values.
 * @returns Matching observations in their original order.
 */
export function filterInventory(items: readonly HubInstalledItem[], filter: InventoryFilter): readonly HubInstalledItem[] {
  const terms = filter.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    const text = [item.name, item.profile, item.homePath, item.componentPath, item.workspacePath, ...item.packageNames].filter(Boolean).join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
      && (filter.origin === 'all' || (item.origin ?? 'hub') === filter.origin)
      && (filter.profile === 'all' || inventoryProfileKey(item) === filter.profile)
      && (filter.status === 'all' || (filter.status === 'attention' ? inventoryNeedsAttention(item) : item.removable))
  })
}

/**
 * Serialize an explicit metadata allowlist, excluding raw configuration and credentials.
 * @param item Component observation whose local paths are included in the report.
 * @returns Formatted JSON with runtime health explicitly unverified.
 */
export function inventoryDiagnostic(item: HubInstalledItem): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: item.id,
    name: item.name,
    source: item.origin ?? 'hub',
    homePath: item.homePath,
    profile: item.profile,
    componentPath: item.componentPath,
    workspacePath: item.workspacePath,
    packages: item.packageNames,
    version: item.version,
    observation: item.inventoryState ?? 'record-only',
    removable: item.removable,
    uninstallBlock: item.uninstallBlock,
    runtimeHealth: 'not-verified',
  }, null, 2)
}
