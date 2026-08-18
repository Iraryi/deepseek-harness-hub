// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SetupManifest } from '@deepseek-ai/dsh-setup-protocol'
import {
  installThroughDesktop, requestHubThroughDesktop, sendSetupDesktopCommand, setupBridgeAvailable,
} from '../src/client/bridge.ts'

const manifest: SetupManifest = {
  schemaVersion: 1,
  id: 'bridge-test',
  name: 'Bridge Test',
  description: 'Desktop bridge test',
  version: '1.0.0',
  kind: 'virtual',
  categories: ['test'],
  tags: [],
  source: { repository: 'https://github.com/example/bridge-test', ref: 'main' },
  compatibility: { dsh: '>=0.1.0', surfaces: ['desktop'] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'unknown' },
  audit: { status: 'reviewed', checks: ['manifest'] },
  artifacts: [{ id: 'bundle', kind: 'in-box', component: '@example/bridge-test' }],
  install: { mode: 'profile', source: 'in-box', bundle: '@example/bridge-test' },
  permissions: [],
  network: [],
}

type Listener = (event: { readonly data: unknown }) => void

afterEach(() => {
  Object.defineProperty(window, 'chrome', { configurable: true, value: undefined })
  vi.useRealTimers()
})

function installBridge(result: (request: Record<string, unknown>) => unknown) {
  const listeners = new Set<Listener>()
  const postMessage = vi.fn((request: Record<string, unknown>) => {
    queueMicrotask(() => {
      const response = result(request)
      const messages = Array.isArray(response) ? response : [response]
      for (const message of messages) {
        for (const listener of listeners) listener({ data: message })
      }
    })
  })
  const webview = {
    postMessage,
    addEventListener: (_type: 'message', listener: Listener) => { listeners.add(listener) },
    removeEventListener: (_type: 'message', listener: Listener) => { listeners.delete(listener) },
  }
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview } })
  return { listeners, postMessage }
}

describe('desktop Setup bridge', () => {
  it('reports browser-only use when no host bridge exists', async () => {
    expect(setupBridgeAvailable()).toBe(false)
    expect(sendSetupDesktopCommand('open-config')).toBe(false)
    await expect(installThroughDesktop(manifest)).rejects.toThrow('desktop bridge unavailable')
    await expect(requestHubThroughDesktop('hub-snapshot')).rejects.toThrow('desktop bridge unavailable')
  })

  it('posts CONFIG and normal-Desktop commands without creating listeners', () => {
    const bridge = installBridge(() => ({ type: 'unrelated' }))
    expect(sendSetupDesktopCommand('open-config')).toBe(true)
    expect(sendSetupDesktopCommand('open-main')).toBe(true)
    expect(bridge.postMessage.mock.calls).toEqual([
      [{ type: 'dsh-desktop-command', command: 'open-config' }],
      [{ type: 'dsh-desktop-command', command: 'open-main' }],
    ])
    expect(bridge.listeners.size).toBe(0)
  })

  it('posts the manifest and resolves the matching desktop result', async () => {
    const bridge = installBridge(request => ({
      type: 'dsh-setup-result', requestId: request.requestId, ok: true, message: 'installed',
    }))
    expect(setupBridgeAvailable()).toBe(true)
    await expect(installThroughDesktop(manifest)).resolves.toBe('installed')
    expect(bridge.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-setup-install', manifest, trust: 'github-source',
    }))
    expect(bridge.listeners.size).toBe(0)
  })

  it('posts a generic HUB request and returns only its matching data', async () => {
    const bridge = installBridge(request => ({
      type: 'dsh-hub-result', requestId: request.requestId, ok: true, data: { login: 'octocat' },
    }))
    await expect(requestHubThroughDesktop<{ readonly login: string }>('github-login-token', { token: 'secret' }))
      .resolves.toEqual({ login: 'octocat' })
    expect(bridge.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-hub-request', operation: 'github-login-token', payload: { token: 'secret' },
    }))
    expect(bridge.listeners.size).toBe(0)
  })

  it('forwards matching native progress before resolving a HUB installation', async () => {
    const progress = vi.fn()
    installBridge(request => [
      { type: 'dsh-hub-progress', requestId: request.requestId, stage: 'download', percent: 38, message: 'downloading', detail: 'example', downloadedBytes: 524288, totalBytes: 1048576, manualDownloads: [{ id: 'asset-1', fileName: 'example.tgz', kind: 'package', downloadUrl: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', repositoryUrl: 'https://github.com/example/example', sha256: 'a'.repeat(64), bytes: 1048576 }] },
      { type: 'dsh-hub-result', requestId: request.requestId, ok: true, data: { status: 'activated' } },
    ])
    await expect(requestHubThroughDesktop('dshmk-install', { repositoryId: 101 }, { onProgress: progress, timeoutMs: 1000 }))
      .resolves.toEqual({ status: 'activated' })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      downloadedBytes: 524288, message: 'downloading', percent: 38, stage: 'download', totalBytes: 1048576,
      manualDownloads: [expect.objectContaining({ id: 'asset-1', fileName: 'example.tgz', kind: 'package' })],
    }))
  })

  it('rejects a matching generic HUB failure', async () => {
    installBridge(request => ({
      type: 'dsh-hub-result', requestId: request.requestId, ok: false, message: 'rate limited',
    }))
    await expect(requestHubThroughDesktop('github-search', { query: 'dsh' })).rejects.toThrow('rate limited')
  })

  it('ignores unrelated messages and rejects a matching failure', async () => {
    const listeners = new Set<Listener>()
    const postMessage = vi.fn((request: Record<string, unknown>) => {
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ data: { type: 'unrelated', requestId: request.requestId } })
          listener({ data: { type: 'dsh-setup-result', requestId: 'another-request', ok: true } })
          listener({ data: { type: 'dsh-setup-result', requestId: request.requestId, ok: false, message: 'blocked' } })
        }
      })
    })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: {
        postMessage,
        addEventListener: (_type: 'message', listener: Listener) => { listeners.add(listener) },
        removeEventListener: (_type: 'message', listener: Listener) => { listeners.delete(listener) },
      } },
    })
    await expect(installThroughDesktop(manifest)).rejects.toThrow('blocked')
    expect(listeners.size).toBe(0)
  })

  it('times out and removes its listener', async () => {
    vi.useFakeTimers()
    const bridge = installBridge(() => ({ type: 'unrelated' }))
    const pending = installThroughDesktop(manifest)
    const rejection = expect(pending).rejects.toThrow('Setup installation timed out')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    await rejection
    expect(bridge.listeners.size).toBe(0)
    expect(bridge.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'setup-cancel' }))
  })

  it('cancels a timed-out native HUB installation and removes its listener', async () => {
    vi.useFakeTimers()
    const bridge = installBridge(() => ({ type: 'unrelated' }))
    const pending = requestHubThroughDesktop('dshmk-install', { repositoryId: 101 }, { timeoutMs: 1000 })
    const rejection = expect(pending).rejects.toThrow('HUB request timed out')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(bridge.listeners.size).toBe(0)
    expect(bridge.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'setup-cancel' }))
  })
})
