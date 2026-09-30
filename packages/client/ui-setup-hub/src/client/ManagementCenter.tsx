/** Prop-only desktop management views; native handlers remain authoritative for all mutations. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnhancementValues, EnhancementsSnapshot, ManagerStatus, ManagementCenterProps, ManagementOperation, ManagementRequest, MobilePairing, MobileRelayStatus, MobileStatus } from './management-contract.ts'
import css from './ManagementCenter.module.css'

const english = {
  overview: 'Management overview', enhancements: 'Desktop enhancements', mobile: 'Phone access',
  overviewHelp: 'Current installation and runtime facts reported by the desktop launcher.',
  enhancementsHelp: 'These preferences are applied by native DSH web injection after a DSH restart. Upstream scroll restoration is unchanged.',
  mobileHelp: 'Connect a phone on your private network. Keep DSH running while using your phone.',
  refresh: 'Refresh status', loading: 'Loading…', working: 'Working…', retry: 'Retry', unavailable: 'Unavailable',
  timeout: 'The request timed out. The host may still finish it; refresh status before retrying a change.',
  invalid: 'Unexpected desktop response. Update the launcher and retry.',
  version: 'Launcher version', installRoot: 'Installation directory', dataRoot: 'Data directory',
  configFile: 'Configuration file', enhancementsFile: 'Enhancement preferences file',
  runtime: 'Runtime', desktopRunning: 'DSH process', processId: 'Process ID', nodeVersion: 'Node.js version',
  running: 'Running', stopped: 'Stopped', checks: 'Runtime checks', noChecks: 'No runtime checks reported.',
  capabilities: 'Available capabilities', available: 'Available', unsupported: 'Not available in this host',
  desktopReload: 'DSH restart', enabled: 'Enable desktop enhancements', width: 'Conversation width (px)',
  widthHelp: 'Use 0 for the upstream default, or a whole number from 640 to 2000.',
  plainTextPaste: 'Paste as plain text', showSessionIds: 'Show session IDs', save: 'Save changes',
  saved: 'Saved. Restart DSH to apply these preferences.', restart: 'Restart DSH now',
  restartHelp: 'Restart interrupts active DSH work. Save any draft first; HUB stays open.',
  restarted: 'DSH restart requested.', dirty: 'Unsaved changes', clean: 'No unsaved changes',
  ok: 'OK', warning: 'Warning', error: 'Error',
  distribution: 'Distribution', full: 'Full', overlay: 'Overlay', runtimeVersion: 'Runtime version', runtimePath: 'Runtime directory',
  nodePath: 'Node.js executable', dataPath: 'Data directory', homePath: 'DSH home', desktopUrl: 'DSH address',
  desktopReachable: 'DSH reachable', hubReady: 'HUB ready', yes: 'Yes', no: 'No',
  node: 'Node.js', desktop: 'DSH', data: 'Data', config: 'Configuration',
  discard: 'Discard unsaved enhancement changes and leave? Cancel to keep editing.',
  interface: 'Private LAN interface', chooseInterface: 'Select a private network address', noInterfaces: 'No private LAN interface is available. Connect to a trusted private network and refresh.',
  port: 'Listen port', portHelp: '0 chooses an available port; otherwise enter a whole number from 1 to 65535.',
  consent: 'I trust this private LAN and accept unencrypted HTTP access.',
  risk: 'HTTP is unencrypted. Anyone observing this LAN can steal pairing/device secrets and control DSH, including agent tools and accessible files. Use only a private trusted LAN. Do not use public Wi-Fi, port forwarding, or internet exposure.',
  operator: 'Paired devices have full DSH access, not read-only access. Revoke or Stop does not cancel jobs already accepted by DSH.',
  start: 'Start phone access', stop: 'Stop phone access', pair: 'Create pairing link', regenerate: 'Replace pairing link',
  pairingUrl: 'One-time pairing URL', pairingHelp: 'Open this link on your phone, review the warning, and confirm pairing there. Treat this link as a secret.',
  expires: 'Expires', pairingExpired: 'The pairing link expired or was consumed. Create a new link to pair another device.',
  copy: 'Copy pairing URL', copied: 'Pairing URL copied.', manualCopy: 'Clipboard unavailable. The URL is selected; copy it manually.',
  devices: 'Paired devices', noDevices: 'No paired devices.', revoke: 'Revoke device', pairedAt: 'Paired', lastSeen: 'Last seen',
  stoppedNotice: 'Phone access stopped.', startedNotice: 'Phone access started. Create a pairing link for your phone.', revokedNotice: 'Device access revoked.',
  transport: 'Transport', httpLan: 'Unencrypted HTTP · trusted LAN only',
}

const chinese: typeof english = {
  overview: '管理概览', enhancements: '桌面增强', mobile: '手机访问',
  overviewHelp: '显示桌面启动器报告的当前安装和运行状态。',
  enhancementsHelp: '这些设置通过原生 DSH 网页注入应用，重启 DSH 后生效。保留上游已有的滚动位置恢复行为。',
  mobileHelp: '通过私有网络连接手机。使用手机时请保持 DSH 运行。',
  refresh: '刷新状态', loading: '正在加载…', working: '正在处理…', retry: '重试', unavailable: '无法获取',
  timeout: '请求超时，主机可能仍会完成操作。请先刷新状态，再重试更改。',
  invalid: '桌面响应格式不正确，请更新启动器后重试。',
  version: '启动器版本', installRoot: '安装目录', dataRoot: '数据目录', configFile: '配置文件',
  enhancementsFile: '增强设置文件', runtime: '运行环境', desktopRunning: 'DSH 进程', processId: '进程 ID', nodeVersion: 'Node.js 版本',
  running: '运行中', stopped: '已停止', checks: '运行检查', noChecks: '主机未报告运行检查。',
  capabilities: '可用能力', available: '可用', unsupported: '当前主机不支持', desktopReload: '重启 DSH',
  enabled: '启用桌面增强', width: '会话宽度（像素）', widthHelp: '0 表示使用上游默认宽度，也可设置 640 至 2000 的整数。',
  plainTextPaste: '以纯文本粘贴', showSessionIds: '显示会话 ID', save: '保存更改', saved: '已保存，重启 DSH 后生效。',
  restart: '立即重启 DSH', restartHelp: '重启会中断正在进行的 DSH 工作，请先保存草稿；HUB 保持打开。',
  restarted: '已请求重启 DSH。', dirty: '有未保存的更改', clean: '没有未保存的更改', ok: '正常', warning: '警告', error: '错误',
  distribution: '分发类型', full: '完整安装', overlay: '增强覆盖层', runtimeVersion: '运行时版本', runtimePath: '运行时目录',
  nodePath: 'Node.js 程序', dataPath: '数据目录', homePath: 'DSH 主目录', desktopUrl: 'DSH 地址',
  desktopReachable: 'DSH 可访问', hubReady: 'HUB 已就绪', yes: '是', no: '否',
  node: 'Node.js', desktop: 'DSH', data: '数据', config: '配置', discard: '放弃未保存的增强设置并离开？选择取消继续编辑。',
  interface: '私有局域网网卡', chooseInterface: '选择私有网络地址', noInterfaces: '没有可用的私有局域网网卡，请连接受信任的私人网络后刷新。',
  port: '监听端口', portHelp: '0 表示自动选择可用端口，也可输入 1 至 65535 的整数。',
  consent: '我信任此私人局域网，并接受未加密的 HTTP 访问。',
  risk: 'HTTP 不加密，同一局域网的监听者可能窃取配对或设备凭据并控制 DSH（包括工具及可访问文件）。仅限受信任的私人局域网，禁止公共 Wi-Fi、端口转发和互联网暴露。',
  operator: '已配对设备具有完整 DSH 操作权限，不是只读访客。撤销或停止不会取消 DSH 已接收的任务。',
  start: '启动手机访问', stop: '停止手机访问', pair: '创建配对链接', regenerate: '替换配对链接',
  pairingUrl: '一次性配对链接', pairingHelp: '在手机打开此链接，阅读风险提示并确认配对。请将此链接视为机密。',
  expires: '到期时间', pairingExpired: '配对链接已过期或已使用。如需配对其他设备，请创建新链接。',
  copy: '复制配对链接', copied: '已复制配对链接。', manualCopy: '无法访问剪贴板，已选中链接，请手动复制。',
  devices: '已配对设备', noDevices: '尚无已配对设备。', revoke: '撤销设备访问', pairedAt: '配对时间', lastSeen: '最近访问',
  stoppedNotice: '已停止手机访问。', startedNotice: '已启动手机访问，请为手机创建配对链接。', revokedNotice: '已撤销设备访问。',
  transport: '传输方式', httpLan: '未加密 HTTP · 仅限受信任的局域网',
}

type Labels = typeof english
type RequestResult<T> = { value: T } | undefined

function bounded<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { finish(); reject(new Error('ABORTED')) }
    const timer = window.setTimeout(() => { finish(); reject(new Error('MANAGEMENT_TIMEOUT')) }, 20_000)
    const finish = (): void => { window.clearTimeout(timer); signal.removeEventListener('abort', abort) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    Promise.resolve().then(() => { if (signal.aborted) throw new Error('ABORTED'); return work() }).then(
      (value) => { finish(); resolve(value) },
      (reason: unknown) => { finish(); reject(reason instanceof Error ? reason : new Error(String(reason))) },
    )
  })
}

function useOperation(request: ManagementRequest) {
  const lifetime = useRef(new AbortController())
  const active = useRef<object | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [failure, setFailure] = useState({ operation: '', message: '' })
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    active.current = undefined
    setBusy('')
    setFailure({ operation: '', message: '' })
    return () => { controller.abort() }
  }, [request])
  const run = useCallback(async <T,>(
    operation: ManagementOperation,
    payload?: Readonly<Record<string, unknown>>,
    decode?: (input: unknown) => T,
  ): Promise<RequestResult<T>> => {
    if (active.current !== undefined || lifetime.current.signal.aborted) return undefined
    const token = {}
    const signal = lifetime.current.signal
    active.current = token
    setBusy(operation)
    if (operation !== 'mobile-status') setFailure({ operation: '', message: '' })
    try {
      const result = await bounded(() => request<T>(operation, payload), signal)
      if (signal.aborted) return undefined
      const value = decode ? decode(result) : result
      setFailure(previous => previous.operation === operation ? { operation: '', message: '' } : previous)
      return { value }
    } catch (reason) {
      if (!signal.aborted) setFailure({ operation, message: reason instanceof Error ? reason.message : String(reason) })
      return undefined
    } finally {
      if (!signal.aborted && active.current === token) { active.current = undefined; setBusy('') }
    }
  }, [request])
  return { run, busy, error: failure.message }
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function validWidth(input: number): boolean {
  return Number.isInteger(input) && (input === 0 || (input >= 640 && input <= 2000))
}

function readEnhancements(input: unknown): EnhancementsSnapshot {
  if (!record(input) || typeof input.revision !== 'string' || !record(input.values)
    || input.values.schemaVersion !== 1 || typeof input.values.enabled !== 'boolean'
    || typeof input.values.conversationWidth !== 'number' || !validWidth(input.values.conversationWidth)
    || typeof input.values.plainTextPaste !== 'boolean' || typeof input.values.showSessionIds !== 'boolean'
    || (input.restartRequired !== undefined && typeof input.restartRequired !== 'boolean')) throw new Error('MANAGEMENT_INVALID')
  return input as unknown as EnhancementsSnapshot
}

function readSavedEnhancements(input: unknown): EnhancementsSnapshot {
  const snapshot = readEnhancements(input)
  if (snapshot.restartRequired !== true) throw new Error('MANAGEMENT_INVALID')
  return snapshot
}

function readManager(input: unknown): ManagerStatus {
  if (!record(input) || input.schemaVersion !== 1 || !['full', 'overlay'].includes(String(input.distribution))
    || !['launcherVersion', 'runtimeVersion', 'runtimePath', 'nodePath', 'dataPath', 'homePath', 'desktopUrl'].every(key => typeof input[key] === 'string')
    || typeof input.desktopReachable !== 'boolean' || typeof input.hubReady !== 'boolean'
    || !Array.isArray(input.checks) || !Array.isArray(input.capabilities)
    || !input.capabilities.every(item => record(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.available === 'boolean' && typeof item.detail === 'string')
    || !input.checks.every(item => record(item) && typeof item.id === 'string' && typeof item.label === 'string'
      && typeof item.detail === 'string' && ['ok', 'warning', 'error'].includes(String(item.status)))) throw new Error('MANAGEMENT_INVALID')
  return input as unknown as ManagerStatus
}

function hostLabel(id: string, fallback: string, labels: Labels): string {
  if (id === 'desktop-reload') return labels.desktopReload
  if (['runtime', 'node', 'desktop', 'data', 'config', 'enhancements', 'mobile'].includes(id)) return labels[id as keyof Labels]
  return fallback
}

function Failure({ error, labels }: { error: string; labels: Labels }) {
  if (!error) return null
  return <p role="alert" className={css.error}>{error === 'MANAGEMENT_TIMEOUT' ? labels.timeout : error === 'MANAGEMENT_INVALID' ? labels.invalid : error}</p>
}

function Overview({ request, labels }: { request: ManagementRequest; labels: Labels }) {
  const { run, busy, error } = useOperation(request)
  const [status, setStatus] = useState<ManagerStatus>()
  const refresh = useCallback(async () => {
    const result = await run('manager-status', undefined, readManager)
    if (result) setStatus(result.value)
  }, [run])
  useEffect(() => { setStatus(undefined); void refresh() }, [refresh])
  return <>
    <header className={css.header}><div><h2>{labels.overview}</h2><p>{labels.overviewHelp}</p></div>
      <Button variant="outline" disabled={Boolean(busy)} onClick={() => { void refresh() }}>{busy ? labels.loading : labels.refresh}</Button></header>
    <Failure error={error} labels={labels} />
    {status && <div className={css.grid}>
      <section className={css.card}><h3>{labels.version}</h3><p>{status.launcherVersion || labels.unavailable}</p>
        <dl className={css.facts}><div><dt>{labels.distribution}</dt><dd>{labels[status.distribution]}</dd></div>
          {(['runtimeVersion', 'runtimePath', 'nodePath', 'dataPath', 'homePath'] as const).map(key => <div key={key}><dt>{labels[key]}</dt><dd>{status[key] || labels.unavailable}</dd></div>)}</dl></section>
      <section className={css.card}><h3>{labels.runtime}</h3><dl className={css.facts}>
        <div><dt>{labels.desktopUrl}</dt><dd>{status.desktopUrl || labels.unavailable}</dd></div>
        <div><dt>{labels.desktopReachable}</dt><dd>{status.desktopReachable ? labels.yes : labels.no}</dd></div>
        <div><dt>{labels.hubReady}</dt><dd>{status.hubReady ? labels.yes : labels.no}</dd></div>
      </dl></section>
      <section className={css.card}><h3>{labels.checks}</h3>
        {status.checks.length === 0 ? <p>{labels.noChecks}</p> : <ul className={css.list}>{status.checks.map(check =>
          <li key={check.id}><strong>{hostLabel(check.id, check.label, labels)}</strong>
            <span>{labels[check.status]}</span><p>{check.detail}</p></li>)}</ul>}
      </section>
      <section className={css.card}><h3>{labels.capabilities}</h3><dl className={css.facts}>
        {status.capabilities.map(capability => <div key={capability.id}>
          <dt>{hostLabel(capability.id, capability.label, labels)}</dt>
          <dd>{capability.available ? labels.available : labels.unsupported}<p>{capability.detail}</p></dd>
        </div>)}
      </dl></section>
    </div>}
  </>
}

function Enhancements({ request, labels, registerLeaveGuard }: { request: ManagementRequest; labels: Labels; registerLeaveGuard: ManagementCenterProps['registerLeaveGuard'] }) {
  const { run, busy, error } = useOperation(request)
  const [snapshot, setSnapshot] = useState<EnhancementsSnapshot>()
  const [values, setValues] = useState<EnhancementValues>()
  const [width, setWidth] = useState('')
  const [notice, setNotice] = useState<'saved' | 'restarted'>()
  const [nativeError, setNativeError] = useState('')
  const [capabilities, setCapabilities] = useState<ManagerStatus['capabilities']>()
  const load = useCallback(async () => {
    const host = await run('manager-status', undefined, readManager)
    if (!host) return
    setCapabilities(host.value.capabilities)
    if (!host.value.capabilities.some(capability => capability.id === 'enhancements' && capability.available)) return
    const result = await run('enhancements-read', undefined, readEnhancements)
    if (result) { setSnapshot(result.value); setValues(result.value.values); setWidth(String(result.value.values.conversationWidth)) }
  }, [run])
  useEffect(() => { setSnapshot(undefined); setValues(undefined); setCapabilities(undefined); setNotice(undefined); void load() }, [load])
  const widthValid = width.trim() !== '' && validWidth(Number(width))
  const draft = values ? { ...values, conversationWidth: Number(width) } : undefined
  const dirty = snapshot !== undefined && (!widthValid || JSON.stringify(draft) !== JSON.stringify(snapshot.values))
  useEffect(() => {
    let current = true
    void request('config-dirty', { dirty }).then(
      () => { if (current) setNativeError('') },
      (reason: unknown) => { if (current) setNativeError(reason instanceof Error ? reason.message : String(reason)) },
    )
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { current = false; window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty, request])
  useEffect(() => () => { void request('config-dirty', { dirty: false }).catch(() => undefined) }, [request])
  const guardState = useRef({ busy, dirty, discard: labels.discard })
  guardState.current = { busy, dirty, discard: labels.discard }
  useEffect(() => registerLeaveGuard?.(() => Promise.resolve(
    !guardState.current.busy && (!guardState.current.dirty || window.confirm(guardState.current.discard)),
  )), [registerLeaveGuard])
  const save = async (): Promise<void> => {
    if (!snapshot || !draft || !dirty || !widthValid) return
    setNotice(undefined)
    const result = await run('enhancements-save', { values: draft, revision: snapshot.revision }, readSavedEnhancements)
    if (result) { setSnapshot(result.value); setValues(result.value.values); setWidth(String(result.value.values.conversationWidth)); setNotice('saved') }
  }
  const restart = async (): Promise<void> => {
    if (dirty || !snapshot?.restartRequired || !capabilities?.some(capability => capability.id === 'desktop-reload' && capability.available)) return
    setNotice(undefined)
    const result = await run<unknown>('desktop-reload')
    if (result) { setSnapshot({ ...snapshot, restartRequired: false }); setNotice('restarted') }
  }
  return <>
    <header className={css.header}><div><h2>{labels.enhancements}</h2><p>{labels.enhancementsHelp}</p></div></header>
    <Failure error={error} labels={labels} />
    <Failure error={nativeError} labels={labels} />
    {!snapshot && <div className={css.actions}>{busy ? <p role="status">{labels.loading}</p> : capabilities && !capabilities.some(capability => capability.id === 'enhancements' && capability.available) ? <p>{labels.unsupported}</p> : <Button variant="outline" onClick={() => { void load() }}>{labels.retry}</Button>}</div>}
    {values && snapshot && <>
      <fieldset className={css.fields} disabled={Boolean(busy)}>
        <div className={css.setting}><span>{labels.enabled}</span>
          <Switch label={labels.enabled} checked={values.enabled} disabled={Boolean(busy)}
            onChange={(enabled) => { setValues({ ...values, enabled }); setNotice(undefined) }} />
        </div>
        <label className={css.field}><span>{labels.width}</span>
          <Input aria-label={labels.width} type="number" min={0} max={2000} step={1} value={width}
            disabled={!values.enabled} aria-invalid={!widthValid}
            onChange={(event) => { setWidth(event.target.value); setNotice(undefined) }} /><small>{labels.widthHelp}</small>
        </label>
        <div className={css.setting}><span>{labels.plainTextPaste}</span>
          <Switch label={labels.plainTextPaste} checked={values.plainTextPaste} disabled={Boolean(busy) || !values.enabled}
            onChange={(plainTextPaste) => { setValues({ ...values, plainTextPaste }); setNotice(undefined) }} />
        </div>
        <div className={css.setting}><span>{labels.showSessionIds}</span>
          <Switch label={labels.showSessionIds} checked={values.showSessionIds} disabled={Boolean(busy) || !values.enabled}
            onChange={(showSessionIds) => { setValues({ ...values, showSessionIds }); setNotice(undefined) }} />
        </div>
      </fieldset>
      <footer className={css.footer}>
        <p>{dirty ? labels.dirty : labels.clean}</p><div className={css.actions}>
          <Button variant="primary" disabled={Boolean(busy) || !dirty || !widthValid} onClick={() => { void save() }}>{busy === 'enhancements-save' ? labels.working : labels.save}</Button>
          {snapshot.restartRequired && <Button variant="outline" disabled={Boolean(busy) || dirty || !capabilities?.some(capability => capability.id === 'desktop-reload' && capability.available)} onClick={() => { void restart() }}>{busy === 'desktop-reload' ? labels.working : labels.restart}</Button>}
        </div>
        {snapshot.restartRequired && <p>{labels.restartHelp}</p>}
        {notice && <p role="status">{labels[notice]}</p>}
      </footer>
    </>}
  </>
}

function privateAddress(address: string): boolean {
  const octets = address.split('.')
  if (octets.length !== 4 || octets.some(octet =>
    !/^\d{1,3}$/.test(octet) || Number(octet) > 255 || String(Number(octet)) !== octet)) return false
  const [first, second] = octets.map(Number)
  return first === 10 || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function nullableString(value: unknown): boolean { return value === null || typeof value === 'string' }

function readRelay(input: unknown): MobileRelayStatus {
  if (!record(input) || typeof input.running !== 'boolean' || input.transport !== 'http-trusted-lan'
    || !['bindAddress', 'url', 'upstreamUrl', 'pairingExpiresAt'].every(key => nullableString(input[key]))
    || !(input.port === null || (typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 0 && input.port <= 65535))
    || !Array.isArray(input.devices) || !input.devices.every(device => record(device) && ['id', 'name', 'pairedAt', 'lastSeen', 'expiresAt'].every(key => typeof device[key] === 'string'))
    || (input.running && (typeof input.bindAddress !== 'string' || !privateAddress(input.bindAddress) || !input.port))) throw new Error('MANAGEMENT_INVALID')
  return input as unknown as MobileRelayStatus
}

function readMobile(input: unknown): MobileStatus {
  readRelay(input)
  if (!record(input) || typeof input.available !== 'boolean' || typeof input.reason !== 'string' || !Array.isArray(input.interfaces)
    || !input.interfaces.every(item => record(item) && typeof item.address === 'string' && typeof item.name === 'string')) throw new Error('MANAGEMENT_INVALID')
  return input as unknown as MobileStatus
}

function readPairing(input: unknown): MobilePairing {
  if (!record(input) || typeof input.url !== 'string' || typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt))) throw new Error('MANAGEMENT_INVALID')
  let url: URL
  try { url = new URL(input.url) } catch { throw new Error('MANAGEMENT_INVALID') }
  if (url.protocol !== 'http:' || !privateAddress(url.hostname) || url.username || url.password || !url.hash) throw new Error('MANAGEMENT_INVALID')
  return input as unknown as MobilePairing
}

function Mobile({ request, labels }: { request: ManagementRequest; labels: Labels }) {
  const { run, busy, error } = useOperation(request)
  const [status, setStatus] = useState<MobileStatus>()
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('0')
  const [consent, setConsent] = useState(false)
  const [pairing, setPairing] = useState<MobilePairing>()
  const [notice, setNotice] = useState<'startedNotice' | 'stoppedNotice' | 'revokedNotice' | 'pairingExpired'>()
  const [copyState, setCopyState] = useState<'copied' | 'manualCopy'>()
  const [copying, setCopying] = useState(false)
  const copyLifetime = useRef(new AbortController())
  const urlField = useRef<HTMLTextAreaElement>(null)
  const refresh = useCallback(async () => {
    const result = await run('mobile-status', undefined, readMobile)
    if (result) setStatus(result.value)
  }, [run])
  useEffect(() => {
    let disposed = false
    let timer: number | undefined
    setStatus(undefined)
    setPairing(undefined)
    setConsent(false)
    setCopyState(undefined)
    setCopying(false)
    setNotice(undefined)
    const poll = async (): Promise<void> => {
      await refresh()
      if (!disposed) timer = window.setTimeout(() => { void poll() }, 5_000)
    }
    void poll()
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    copyLifetime.current = controller
    setCopying(false)
    setCopyState(undefined)
    return () => { controller.abort() }
  }, [pairing, request])
  useEffect(() => {
    if (pairing && status && (!status.running || status.pairingExpiresAt !== pairing.expiresAt)) {
      setPairing(undefined)
      setCopyState(undefined)
      setNotice('pairingExpired')
    }
  }, [status, pairing])
  useEffect(() => {
    if (!pairing) return
    const timer = window.setTimeout(() => { setPairing(undefined); setCopyState(undefined); setNotice('pairingExpired') }, Math.max(0, Date.parse(pairing.expiresAt) - Date.now()))
    return () => { window.clearTimeout(timer) }
  }, [pairing])
  const interfaces = status?.interfaces.filter(item => privateAddress(item.address)) ?? []
  const selected = interfaces.some(item => item.address === address)
  const validPort = port.trim() !== '' && Number.isInteger(Number(port)) && Number(port) >= 0 && Number(port) <= 65535
  const mutate = async (operation: 'mobile-start' | 'mobile-stop' | 'mobile-revoke', payload?: Readonly<Record<string, unknown>>): Promise<void> => {
    setNotice(undefined)
    const result = await run(operation, payload, readRelay)
    if (!result) return
    setStatus(previous => previous ? { ...previous, ...result.value } : previous)
    if (operation === 'mobile-stop') { setPairing(undefined); setCopyState(undefined); setConsent(false) }
    setNotice(operation === 'mobile-start' ? 'startedNotice' : operation === 'mobile-stop' ? 'stoppedNotice' : 'revokedNotice')
  }
  const start = (): void => {
    if (!status?.available || status.running || !consent || !selected || !validPort) return
    void mutate('mobile-start', { bindAddress: address, port: Number(port), trustedLanConsent: true })
  }
  const pair = async (): Promise<void> => {
    if (!status?.running) return
    const result = await run('mobile-pair', undefined, (input) => {
      const next = readPairing(input)
      const url = new URL(next.url)
      if (url.hostname !== status.bindAddress || Number(url.port || 80) !== status.port) throw new Error('MANAGEMENT_INVALID')
      return next
    })
    if (result) {
      setStatus(previous => previous ? { ...previous, pairingExpiresAt: result.value.expiresAt } : previous)
      setPairing(result.value)
      setCopyState(undefined)
      setNotice(undefined)
    }
  }
  const copy = async (): Promise<void> => {
    if (!pairing || copying) return
    const signal = copyLifetime.current.signal
    setCopying(true)
    try {
      await bounded(() => navigator.clipboard.writeText(pairing.url), signal)
      if (!signal.aborted) setCopyState('copied')
    } catch {
      if (!signal.aborted) { urlField.current?.focus(); urlField.current?.select(); setCopyState('manualCopy') }
    } finally { if (!signal.aborted) setCopying(false) }
  }
  return <>
    <header className={css.header}><div><h2>{labels.mobile}</h2><p>{labels.mobileHelp}</p></div><Button variant="outline" disabled={Boolean(busy)} onClick={() => { void refresh() }}>{busy === 'mobile-status' ? labels.loading : labels.refresh}</Button></header>
    <Failure error={error} labels={labels} />
    <p className={css.warning}>{labels.risk}</p><p>{labels.operator}</p>
    {status && <>
      <section className={css.card}><h3>{status.running ? labels.running : labels.stopped}</h3>
        <dl className={css.facts}><div><dt>{labels.transport}</dt><dd>{labels.httpLan}</dd></div>
          {status.running && <>
            <div><dt>{labels.interface}</dt><dd>{status.bindAddress}</dd></div><div><dt>{labels.port}</dt><dd>{status.port}</dd></div>
          </>}
        </dl>
        {!status.available && <p>{status.reason || labels.unsupported}</p>}
      </section>
      <fieldset className={css.fields} disabled={Boolean(busy) || status.running || !status.available}>
        <label className={css.field}><span>{labels.interface}</span><select value={selected ? address : ''} onChange={(event) => { setAddress(event.target.value); setConsent(false) }}>
          <option value="">{labels.chooseInterface}</option>{interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}
        </select></label>
        {interfaces.length === 0 && <p>{labels.noInterfaces}</p>}
        <label className={css.field}><span>{labels.port}</span>
          <Input aria-label={labels.port} type="number" min={0} max={65535} step={1} value={port}
            aria-invalid={!validPort} onChange={(event) => { setPort(event.target.value) }} /><small>{labels.portHelp}</small>
        </label>
        <label className={css.consent}><input type="checkbox" checked={consent}
          onChange={(event) => { setConsent(event.target.checked) }} /><span>{labels.consent}</span></label>
      </fieldset>
      <div className={css.actions}>
        {!status.running && <Button variant="primary" disabled={Boolean(busy) || !status.available || !consent || !selected || !validPort} onClick={start}>{busy === 'mobile-start' ? labels.working : labels.start}</Button>}
        {status.running && <><Button variant="outline" disabled={Boolean(busy)} onClick={() => { void mutate('mobile-stop') }}>{busy === 'mobile-stop' ? labels.working : labels.stop}</Button>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => { void pair() }}>{busy === 'mobile-pair' ? labels.working : pairing ? labels.regenerate : labels.pair}</Button></>}
      </div>
      {pairing && <section className={css.pairing}><h3>{labels.pairingUrl}</h3><p>{labels.pairingHelp}</p>
        <label className={css.field}><span>{labels.pairingUrl}</span>
          <textarea ref={urlField} className={css.url} rows={3} readOnly value={pairing.url}
            onFocus={(event) => { event.target.select() }} />
        </label>
        <p>{labels.expires}: <time dateTime={pairing.expiresAt}>{new Date(pairing.expiresAt).toLocaleString(labels === chinese ? 'zh-CN' : 'en')}</time></p>
        <Button variant="outline" disabled={copying} onClick={() => { void copy() }}>{copying ? labels.working : labels.copy}</Button>
        {copyState && <p role="status">{labels[copyState]}</p>}
      </section>}
      <section className={css.card}><h3>{labels.devices}</h3>
        {status.devices.length === 0 ? <p>{labels.noDevices}</p> : <ul className={css.list}>
          {status.devices.map(device => <li key={device.id}>
            <div className={css.device}><strong>{device.name}</strong><dl className={css.facts}>
              <div><dt>{labels.pairedAt}</dt><dd>{device.pairedAt}</dd></div><div><dt>{labels.lastSeen}</dt><dd>{device.lastSeen}</dd></div>
              <div><dt>{labels.expires}</dt><dd>{device.expiresAt}</dd></div>
            </dl></div>
            <Button variant="outline" disabled={Boolean(busy)} aria-label={`${labels.revoke}: ${device.name}`}
              onClick={() => { void mutate('mobile-revoke', { deviceId: device.id }) }}>{labels.revoke}</Button>
          </li>)}
        </ul>}
      </section>
    </>}
    {notice && <p role="status">{labels[notice]}</p>}
  </>
}

/**
 * Render the active management page; all host I/O goes through the supplied request callback.
 * @param props - Active section, native request callback, and Chinese/English choice.
 * @returns The management surface, without registering shared settings, bridge operations, or locale keys.
 */
export function ManagementCenter(props: ManagementCenterProps) {
  const labels = props.chinese ? chinese : english
  return <div className={css.root} lang={props.chinese ? 'zh-CN' : 'en'}>
    {props.section === 'overview' && <Overview request={props.request} labels={labels} />}
    {props.section === 'enhancements' && <Enhancements request={props.request} labels={labels} registerLeaveGuard={props.registerLeaveGuard} />}
    {props.section === 'mobile' && <Mobile request={props.request} labels={labels} />}
  </div>
}
