import { describe, expect, it } from 'vitest'
import type { HubInstalledItem } from '../src/client/bridge.ts'
import { filterInventory, inventoryDiagnostic, inventoryNeedsAttention, inventoryProfileKey } from '../src/client/inventory.ts'

const external: HubInstalledItem = {
  id: 'external', name: 'My plugin', packageNames: ['@demo/plugin'], version: '1.2.3',
  origin: 'profile', homePath: 'D:\\home-one', profile: 'web', inventoryState: 'present',
  componentPath: 'D:\\home-one\\profiles\\web\\package.json', installedAt: '', workspacePath: '', removable: false,
  kind: 'plugin',
}
const items: readonly HubInstalledItem[] = [
  external,
  { ...external, id: 'missing', homePath: 'D:\\home-two', inventoryState: 'unresolved' },
  { ...external, id: 'receipt', origin: 'hub', inventoryState: 'declared', removable: true },
]
const all = { query: '', origin: 'all', profile: 'all', status: 'all' }

describe('inventory selectors', () => {
  it('keeps equal Profile names in different homes separate', () => {
    expect(inventoryProfileKey(items[0]!)).not.toBe(inventoryProfileKey(items[1]!))
    expect(filterInventory(items, { ...all, profile: inventoryProfileKey(items[1]!) }).map(item => item.id)).toEqual(['missing'])
  })
  it('combines source, package/path search and management-state filters', () => {
    expect(filterInventory(items, { ...all, origin: 'profile' }).map(item => item.id)).toEqual(['external', 'missing'])
    expect(filterInventory(items, { ...all, query: ' MY @DEMO/PLUGIN ', status: 'removable' }).map(item => item.id)).toEqual(['receipt'])
    expect(filterInventory(items, { ...all, origin: 'profile', status: 'attention' }).map(item => item.id)).toEqual(['missing'])
    expect(filterInventory(items, { ...all, query: 'home-one', status: 'removable' }).map(item => item.id)).toEqual(['receipt'])
    expect(filterInventory(items, { ...all, profile: 'removed-profile' })).toEqual([])
  })
  it.each(['record-only', 'unresolved', 'missing', 'partial', 'unverified', undefined] as const)('flags %s without inventing runtime health', (inventoryState) => {
    const item = { ...external }
    if (inventoryState === undefined) delete item.inventoryState
    else item.inventoryState = inventoryState
    expect(inventoryNeedsAttention(item)).toBe(true)
  })
  it('reports only explicitly allowed metadata without credentials or raw config', () => {
    const report = JSON.parse(inventoryDiagnostic({ ...external, token: 'do-not-copy', config: { apiKey: 'secret' } } as HubInstalledItem))
    expect(report.runtimeHealth).toBe('not-verified')
    expect(report.componentPath).toBe(external.componentPath)
    expect(report.packages).toEqual(['@demo/plugin'])
    expect(report).not.toHaveProperty('token')
    expect(report).not.toHaveProperty('config')
  })
  it('keeps shared-ownership blocks in the inspection filter even when declared', () => {
    expect(inventoryNeedsAttention({ ...external, inventoryState: 'declared', uninstallBlock: 'shared' })).toBe(true)
  })
})
