import { describe, expect, it, vi } from 'vitest'
import {
  communityCategoryCounts, communityPageItems, communitySupportsOneClick, visibleCommunityPlugins,
} from '../src/client/community.ts'

const registry = {
  categories: { ui: { zh: 'UI 增强' }, tools: { zh: '工具' } },
  count: 3,
  plugins: [
    { added: '2026-08-15', category: 'ui', description: { zh: '输入增强' }, name: 'beta', npm: 'beta', owner: 'two', stars: 10, url: 'https://github.com/two/beta' },
    { added: '2026-08-10', category: 'tools', description: { zh: '浏览器工具' }, name: 'alpha', npm: null, owner: 'one', stars: 30, url: 'https://github.com/one/alpha' },
    { added: '2025-01-01', category: 'ui', description: { zh: '旧主题' }, name: 'theme', owner: 'three', stars: 2, url: 'https://github.com/three/theme/tree/main/plugin' },
  ],
  sourceMode: 'live' as const,
  sourceUrl: 'https://awesome-dsh-plugin.com/plugins.json',
  updated: '2026-08-16',
}

describe('community discovery helpers', () => {
  it('filters categories, searches localized descriptions, and sorts by stars', () => {
    const visible = visibleCommunityPlugins(registry, { category: 'all', language: 'zh', query: '工具', sort: 'stars', timeRange: 'all' })
    expect(visible.map(plugin => plugin.name)).toEqual(['alpha'])
    expect(communityCategoryCounts(registry)).toEqual(new Map([['ui', 2], ['tools', 1]]))
  })

  it('applies time windows and produces compact pages', () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    expect(visibleCommunityPlugins(registry, { category: 'all', language: 'zh', query: '', sort: 'newest', timeRange: 'week' }).map(plugin => plugin.name)).toEqual(['beta', 'alpha'])
    expect(communityPageItems(5, 12)).toEqual([1, '…', 4, 5, 6, '…', 12])
    vi.useRealTimers()
  })

  it('limits generic one-click Setup to published npm packages', () => {
    expect(communitySupportsOneClick(registry.plugins[0]!)).toBe(true)
    expect(communitySupportsOneClick(registry.plugins[1]!)).toBe(false)
    expect(communitySupportsOneClick(registry.plugins[2]!)).toBe(false)
    expect(communitySupportsOneClick({ ...registry.plugins[2]!, npm: null })).toBe(false)
  })
})
