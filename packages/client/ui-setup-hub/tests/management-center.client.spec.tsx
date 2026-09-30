// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ManagementCenter } from '../src/client/ManagementCenter.tsx'
import type { EnhancementValues, ManagerStatus, ManagementOperation, ManagementRequest, MobileStatus } from '../src/client/management-contract.ts'

const manager: ManagerStatus = {
  schemaVersion: 1, distribution: 'full', launcherVersion: '0.1-test', runtimeVersion: 'fixture-runtime',
  runtimePath: 'D:\\fixture\\runtime', nodePath: 'D:\\fixture\\node.exe', dataPath: 'D:\\fixture\\data',
  homePath: 'D:\\fixture\\home', desktopUrl: 'http://127.0.0.1:2345', desktopReachable: true, hubReady: true,
  checks: [{ id: 'runtime', label: 'Runtime', status: 'ok', detail: 'Fixture only' }],
  capabilities: ['enhancements', 'desktop-reload', 'mobile'].map(id => ({ id, label: id, available: true, detail: 'Fixture capability' })),
}
const defaults: EnhancementValues = { schemaVersion: 1, enabled: true, conversationWidth: 0, plainTextPaste: false, showSessionIds: false }

function fakeRequest(overrides: Partial<Record<ManagementOperation, (payload?: Readonly<Record<string, unknown>>) => unknown>> = {}) {
  return vi.fn(async (operation: ManagementOperation, payload?: Readonly<Record<string, unknown>>) => {
    if (overrides[operation]) return overrides[operation](payload)
    if (operation === 'config-dirty') return undefined
    if (operation === 'manager-status') return manager
    if (operation === 'enhancements-read') return { values: defaults, revision: 'original' }
    if (operation === 'enhancements-save') return { values: payload?.values, revision: 'saved', restartRequired: true }
    if (operation === 'desktop-reload') return undefined
    throw new Error(`Unexpected operation: ${operation}`)
  })
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('renders real host facts with translated known labels, Chinese=%s', async (chinese) => {
  const request = fakeRequest()
  render(<ManagementCenter section="overview" request={request as ManagementRequest} chinese={chinese} />)
  await screen.findByText(manager.runtimePath)
  expect(screen.getByRole('heading', { name: chinese ? '管理概览' : 'Management overview' })).toBeTruthy()
  expect(screen.getByText(manager.homePath)).toBeTruthy()
  expect(screen.getAllByText(chinese ? '运行环境' : 'Runtime')).toHaveLength(2)
  expect(screen.getByText(chinese ? '正常' : 'OK')).toBeTruthy()
  expect(screen.queryByText(/SSH|WeChat|微信/)).toBeNull()
  expect(request.mock.calls.filter(call => call[0] !== 'config-dirty').map(call => call[0])).toEqual(['manager-status'])
})

it('preserves overview facts on refresh failure and exposes retry', async () => {
  const request = fakeRequest()
  render(<ManagementCenter section="overview" request={request as ManagementRequest} chinese={false} />)
  await screen.findByText(manager.runtimePath)
  request.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  expect((await screen.findByRole('alert')).textContent).toBe('offline')
  expect(screen.getByText(manager.runtimePath)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
})

it('rejects malformed manager responses without enabling operations', async () => {
  const request = fakeRequest({ 'manager-status': () => ({}) })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Unexpected desktop response')
  expect(request.mock.calls.filter(call => call[0] !== 'config-dirty').map(call => call[0])).toEqual(['manager-status'])
})

it('does not offer unsupported enhancement mutations', async () => {
  const request = fakeRequest({ 'manager-status': () => ({ ...manager, capabilities: [] }) })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  await screen.findByText('Not available in this host')
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  expect(request.mock.calls.filter(call => call[0] !== 'config-dirty').map(call => call[0])).toEqual(['manager-status'])
})

it.each([false, true])('saves native preferences, then requires an explicit restart, Chinese=%s', async (chinese) => {
  const request = fakeRequest()
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={chinese} />)
  const width = await screen.findByLabelText(chinese ? '会话宽度（像素）' : 'Conversation width (px)')
  fireEvent.change(width, { target: { value: '960' } })
  fireEvent.click(screen.getByRole('switch', { name: chinese ? '以纯文本粘贴' : 'Paste as plain text' }))
  fireEvent.click(screen.getByRole('button', { name: chinese ? '保存更改' : 'Save changes' }))
  await screen.findByText(chinese ? '已保存，重启 DSH 后生效。' : 'Saved. Restart DSH to apply these preferences.')
  expect(request).toHaveBeenCalledWith('enhancements-save', { values: { ...defaults, conversationWidth: 960, plainTextPaste: true }, revision: 'original' })
  expect(request.mock.calls.some(call => call[0] === 'desktop-reload')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: chinese ? '立即重启 DSH' : 'Restart DSH now' }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('desktop-reload', undefined) })
})

it('retains all edits on conflict and uses the saved revision on the next edit', async () => {
  let conflict = true
  const request = fakeRequest({ 'enhancements-save': (payload) => {
    if (conflict) throw new Error('ENHANCEMENTS_CONFLICT')
    return { values: payload?.values, revision: 'next', restartRequired: true }
  } })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  const width = await screen.findByLabelText('Conversation width (px)')
  fireEvent.change(width, { target: { value: '1200' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Show session IDs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('ENHANCEMENTS_CONFLICT')
  expect((width as HTMLInputElement).value).toBe('1200')
  expect(screen.getByRole('switch', { name: 'Show session IDs' }).getAttribute('aria-checked')).toBe('true')
  expect(request.mock.calls.some(call => call[0] === 'desktop-reload')).toBe(false)
  conflict = false
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('Saved. Restart DSH to apply these preferences.')
  fireEvent.change(width, { target: { value: '1300' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => { expect(request).toHaveBeenCalledWith('enhancements-save', { values: { ...defaults, conversationWidth: 1300, showSessionIds: true }, revision: 'next' }) })
})

it('preserves restart-required status after a failed restart', async () => {
  const request = fakeRequest({ 'desktop-reload': () => { throw new Error('restart refused') } })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('switch', { name: 'Show session IDs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restart DSH now' }))
  await screen.findByText('restart refused')
  expect(screen.getByRole('button', { name: 'Restart DSH now' }).hasAttribute('disabled')).toBe(false)
})

it.each(['', '1', '639', '2001', '640.5'])('rejects width %s without saving', async (value) => {
  const request = fakeRequest()
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.change(await screen.findByLabelText('Conversation width (px)'), { target: { value } })
  expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true)
  expect(request.mock.calls.some(call => call[0] === 'enhancements-save')).toBe(false)
})

it('guards dirty departures, saving, and unregisters on unmount', async () => {
  let guard!: () => Promise<boolean>
  let resolveSave!: (value: unknown) => void
  const dispose = vi.fn()
  const request = fakeRequest({ 'enhancements-save': () => new Promise((resolve) => { resolveSave = resolve }) })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { unmount } = render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} registerLeaveGuard={(next) => { guard = next; return dispose }} />)
  fireEvent.click(await screen.findByRole('switch', { name: 'Show session IDs' }))
  expect(await guard()).toBe(false)
  confirm.mockReturnValue(true)
  expect(await guard()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => { expect(resolveSave).toBeTypeOf('function') })
  expect(await guard()).toBe(false)
  await act(async () => { resolveSave({ values: { ...defaults, showSessionIds: true }, revision: 'saved', restartRequired: true }) })
  expect(await guard()).toBe(true)
  unmount()
  expect(dispose).toHaveBeenCalledOnce()
})

it('ignores old request results after transport replacement', async () => {
  let resolveOld!: (value: unknown) => void
  const oldRequest = fakeRequest({ 'manager-status': () => new Promise((resolve) => { resolveOld = resolve }) })
  const nextRequest = fakeRequest()
  const { rerender } = render(<ManagementCenter section="overview" request={oldRequest as ManagementRequest} chinese={false} />)
  await waitFor(() => { expect(resolveOld).toBeTypeOf('function') })
  rerender(<ManagementCenter section="overview" request={nextRequest as ManagementRequest} chinese={false} />)
  await screen.findByText(manager.runtimePath)
  await act(async () => { resolveOld({ ...manager, runtimePath: 'STALE PATH' }) })
  expect(screen.queryByText('STALE PATH')).toBeNull()
})

it('bounds pending requests, ignores late results, and owns no overview poll', async () => {
  vi.useFakeTimers()
  let resolveLate!: (value: unknown) => void
  const request = fakeRequest({ 'manager-status': () => new Promise((resolve) => { resolveLate = resolve }) })
  const { unmount } = render(<ManagementCenter section="overview" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(20_001) })
  expect(screen.getByRole('alert').textContent).toContain('timed out')
  expect(screen.getByRole('button', { name: 'Refresh status' }).hasAttribute('disabled')).toBe(false)
  await act(async () => { resolveLate(manager); await vi.advanceTimersByTimeAsync(10_000) })
  expect(screen.queryByText(manager.runtimePath)).toBeNull()
  expect(request).toHaveBeenCalledOnce()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

const stopped: MobileStatus = {
  running: false, bindAddress: null, port: null, url: null, upstreamUrl: null, transport: 'http-trusted-lan',
  devices: [], pairingExpiresAt: null, available: true, reason: '',
  interfaces: [{ address: '192.168.1.25', name: 'Wi-Fi' }, { address: '8.8.8.8', name: 'Public' },
    { address: '0.0.0.0', name: 'Wildcard' }, { address: '127.0.0.1', name: 'Loopback' }],
}
const running: MobileStatus = { ...stopped, running: true, bindAddress: '192.168.1.25', port: 8888,
  url: 'http://192.168.1.25:8888/__mobile/pair', upstreamUrl: 'http://127.0.0.1:2345' }

function mobileFixture(initial: MobileStatus = stopped) {
  let status = initial
  const pairing = { url: 'http://192.168.1.25:8888/__mobile/pair#fixture-secret', expiresAt: new Date(Date.now() + 120_000).toISOString() }
  const request = fakeRequest({
    'mobile-status': () => status,
    'mobile-start': () => { status = running; return status },
    'mobile-stop': () => { status = stopped; return status },
    'mobile-pair': () => { status = { ...status, pairingExpiresAt: pairing.expiresAt }; return pairing },
    'mobile-revoke': (payload) => { status = { ...status, devices: status.devices.filter(device => device.id !== payload?.deviceId) }; return status },
  })
  return { request, pairing, change: (next: MobileStatus) => { status = next } }
}

it.each([false, true])('requires private interface selection and explicit HTTP consent, Chinese=%s', async (chinese) => {
  const { request } = mobileFixture()
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={chinese} />)
  const start = await screen.findByRole('button', { name: chinese ? '启动手机访问' : 'Start phone access' })
  expect(start.hasAttribute('disabled')).toBe(true)
  expect(screen.getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', '192.168.1.25'])
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '192.168.1.25' } })
  expect(start.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(start)
  await waitFor(() => { expect(request).toHaveBeenCalledWith('mobile-start', { bindAddress: '192.168.1.25', port: 0, trustedLanConsent: true }) })
  await screen.findByRole('button', { name: chinese ? '创建配对链接' : 'Create pairing link' })
  expect(request.mock.calls.some(call => call[0] === 'mobile-pair')).toBe(false)
  expect(screen.queryByLabelText(/token|令牌/i)).toBeNull()
  expect(screen.getByText(chinese ? /HTTP 不加密/ : /HTTP is unencrypted/)).toBeTruthy()
  expect(screen.getByText(chinese ? /不会取消 DSH 已接收/ : /does not cancel jobs/)).toBeTruthy()
})

it.each(['', '-1', '65536', '1.5'])('never starts on invalid port %s', async (port) => {
  const { request } = mobileFixture()
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: '192.168.1.25' } })
  fireEvent.change(screen.getByLabelText('Listen port'), { target: { value: port } })
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Start phone access' }).hasAttribute('disabled')).toBe(true)
  expect(request.mock.calls.some(call => call[0] === 'mobile-start')).toBe(false)
})

it('does not offer start when the native mobile capability is unavailable', async () => {
  const { request } = mobileFixture({ ...stopped, available: false, reason: 'DSH endpoint unavailable' })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await screen.findByText('DSH endpoint unavailable')
  expect(screen.getByRole('button', { name: 'Start phone access' }).hasAttribute('disabled')).toBe(true)
})

it.each([false, true])('copies only an explicitly created pairing link, Chinese=%s', async (chinese) => {
  const { request, pairing } = mobileFixture(running)
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={chinese} />)
  fireEvent.click(await screen.findByRole('button', { name: chinese ? '创建配对链接' : 'Create pairing link' }))
  const url = await screen.findByLabelText(chinese ? '一次性配对链接' : 'One-time pairing URL')
  expect((url as HTMLTextAreaElement).value).toBe(pairing.url)
  expect(writeText).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: chinese ? '复制配对链接' : 'Copy pairing URL' }))
  await screen.findByText(chinese ? '已复制配对链接。' : 'Pairing URL copied.')
  expect(writeText).toHaveBeenCalledWith(pairing.url)
  fireEvent.click(screen.getByRole('button', { name: chinese ? '停止手机访问' : 'Stop phone access' }))
  await screen.findByRole('button', { name: chinese ? '启动手机访问' : 'Start phone access' })
  expect(screen.queryByLabelText(chinese ? '一次性配对链接' : 'One-time pairing URL')).toBeNull()
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
})

it('selects a read-only URL for manual copy when clipboard rejects', async () => {
  const { request, pairing } = mobileFixture(running)
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create pairing link' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy pairing URL' }))
  await screen.findByText('Clipboard unavailable. The URL is selected; copy it manually.')
  const url = screen.getByLabelText('One-time pairing URL') as HTMLTextAreaElement
  expect(document.activeElement).toBe(url)
  expect(url.readOnly).toBe(true)
  expect(url.selectionStart).toBe(0)
  expect(url.selectionEnd).toBe(pairing.url.length)
})

it('removes a revoked device using its ID rather than display name', async () => {
  const { request } = mobileFixture({ ...running, devices: [{ id: 'device-1', name: 'My phone', pairedAt: '2026-09-30T00:00:00Z', lastSeen: '2026-09-30T00:00:01Z', expiresAt: '2026-10-01T00:00:00Z' }] })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke device: My phone' }))
  await screen.findByText('Device access revoked.')
  expect(request).toHaveBeenCalledWith('mobile-revoke', { deviceId: 'device-1' })
  expect(screen.queryByText('My phone')).toBeNull()
  expect(screen.getByText('No paired devices.')).toBeTruthy()
})

it('polls at five-second intervals only on the mobile page and cleans up on unmount', async () => {
  vi.useFakeTimers()
  const { request } = mobileFixture()
  const { rerender, unmount } = render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(request).toHaveBeenCalledTimes(2)
  rerender(<ManagementCenter section="overview" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(request.mock.calls.filter(call => call[0] === 'mobile-status')).toHaveLength(2)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not overlap status requests and ignores replies after leaving mobile', async () => {
  vi.useFakeTimers()
  let resolveStatus!: (value: unknown) => void
  const request = fakeRequest({ 'mobile-status': () => new Promise((resolve) => { resolveStatus = resolve }) })
  const { rerender, unmount } = render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(request).toHaveBeenCalledTimes(1)
  rerender(<ManagementCenter section="overview" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { resolveStatus(running); await vi.advanceTimersByTimeAsync(30_000) })
  expect(screen.queryByRole('button', { name: 'Stop phone access' })).toBeNull()
  expect(request.mock.calls.filter(call => call[0] === 'mobile-status')).toHaveLength(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('removes pairing secrets at expiry even if a status request is still pending', async () => {
  vi.useFakeTimers()
  const { request } = mobileFixture(running)
  const { unmount } = render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  fireEvent.click(screen.getByRole('button', { name: 'Create pairing link' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByLabelText('One-time pairing URL')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(screen.queryByLabelText('One-time pairing URL')).toBeNull()
  expect(screen.getByText('The pairing link expired or was consumed. Create a new link to pair another device.')).toBeTruthy()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('removes consumed grants on the next status poll', async () => {
  vi.useFakeTimers()
  const { request, change } = mobileFixture(running)
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  fireEvent.click(screen.getByRole('button', { name: 'Create pairing link' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  change(running)
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(screen.queryByLabelText('One-time pairing URL')).toBeNull()
})

it('keeps mutation errors visible when automatic status polling succeeds', async () => {
  vi.useFakeTimers()
  const { request } = mobileFixture(running)
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  request.mockRejectedValueOnce(new Error('stop failed'))
  fireEvent.click(screen.getByRole('button', { name: 'Stop phone access' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(screen.getByRole('alert').textContent).toBe('stop failed')
  expect(screen.getByRole('button', { name: 'Stop phone access' }).hasAttribute('disabled')).toBe(false)
})

it('notifies the native close guard, protects browser unload, and resets both on unmount', async () => {
  const request = fakeRequest()
  const { unmount } = render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.change(await screen.findByLabelText('Conversation width (px)'), { target: { value: '1500' } })
  await waitFor(() => { expect(request).toHaveBeenCalledWith('config-dirty', { dirty: true }) })
  const dirtyUnload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirtyUnload)
  expect(dirtyUnload.defaultPrevented).toBe(true)
  unmount()
  expect(request).toHaveBeenLastCalledWith('config-dirty', { dirty: false })
  const cleanUnload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanUnload)
  expect(cleanUnload.defaultPrevented).toBe(false)
})

it('retains the native dirty flag on a failed save and clears it only after success', async () => {
  let fail = true
  const request = fakeRequest({ 'enhancements-save': (payload) => {
    if (fail) throw new Error('disk full')
    return { values: payload?.values, revision: 'saved', restartRequired: true }
  } })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('switch', { name: 'Show session IDs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('disk full')
  expect(request.mock.calls.filter(call => call[0] === 'config-dirty').at(-1)?.[1]).toEqual({ dirty: true })
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('Saved. Restart DSH to apply these preferences.')
  expect(request.mock.calls.filter(call => call[0] === 'config-dirty').at(-1)?.[1]).toEqual({ dirty: false })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it.each([
  'http://8.8.8.8:8888/__mobile/pair#secret',
  'http://192.168.1.26:8888/__mobile/pair#secret',
  'http://192.168.1.25:8889/__mobile/pair#secret',
  'http://192.168.1.25:8888/__mobile/pair',
])('rejects pairing URLs outside the active private relay: %s', async (url) => {
  const request = fakeRequest({
    'mobile-status': () => running,
    'mobile-pair': () => ({ url, expiresAt: new Date(Date.now() + 120_000).toISOString() }),
  })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create pairing link' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Unexpected desktop response')
  expect(screen.queryByLabelText('One-time pairing URL')).toBeNull()
})

it('ignores clipboard completion after stopping phone access', async () => {
  let finishCopy!: () => void
  const { request } = mobileFixture(running)
  const writeText = vi.fn(() => new Promise<void>((resolve) => { finishCopy = resolve }))
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<ManagementCenter section="mobile" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create pairing link' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy pairing URL' }))
  await waitFor(() => { expect(writeText).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: 'Stop phone access' }))
  await screen.findByRole('button', { name: 'Start phone access' })
  await act(async () => { finishCopy() })
  expect(screen.queryByText('Pairing URL copied.')).toBeNull()
  expect(screen.queryByLabelText('One-time pairing URL')).toBeNull()
})

it('reports unavailable native close protection without losing the enhancement draft', async () => {
  const request = fakeRequest({ 'config-dirty': (payload) => {
    if (payload?.dirty) throw new Error('native close guard unavailable')
    return undefined
  } })
  render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.click(await screen.findByRole('switch', { name: 'Paste as plain text' }))
  await screen.findByText('native close guard unavailable')
  expect(screen.getByRole('switch', { name: 'Paste as plain text' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false)
})

it('retains a draft across language changes without rereading native preferences', async () => {
  const request = fakeRequest()
  const { rerender } = render(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese={false} />)
  fireEvent.change(await screen.findByLabelText('Conversation width (px)'), { target: { value: '1440' } })
  rerender(<ManagementCenter section="enhancements" request={request as ManagementRequest} chinese />)
  expect(screen.getByLabelText<HTMLInputElement>('会话宽度（像素）').value).toBe('1440')
  expect(request.mock.calls.filter(call => call[0] === 'enhancements-read')).toHaveLength(1)
})
