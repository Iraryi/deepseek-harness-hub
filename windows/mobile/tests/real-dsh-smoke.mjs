import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { MobileRelay } from '../relay.mjs'

const [runtimeInput, bindAddress, browserExecutable] = process.argv.slice(2)
if (!runtimeInput || !bindAddress || !browserExecutable) throw new Error('Usage: node real-dsh-smoke.mjs <copied-runtime> <explicit-private-IP> <installed-browser.exe>')
const runtime = resolve(runtimeInput)
const fixture = fileURLToPath(new URL(`./.output/real-${randomUUID()}/`, import.meta.url))
if (process.platform === 'win32' && (!fixture.toLowerCase().startsWith('d:') || !runtime.toLowerCase().startsWith('d:'))) throw new Error('Runtime and fixtures must be on D:')
await mkdir(fixture, { recursive: true })
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)))
for (const key of ['DSH_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
  environment[key] = join(fixture, key.toLowerCase())
  await mkdir(environment[key], { recursive: true })
}
environment.DEEPSEEK_HARNESS_OFFLINE = '1'
const relay = new MobileRelay()
const node = join(runtime, 'tools', 'node', 'node.exe')
const child = spawn(node, ['--import', pathToFileURL(join(runtime, 'runtime-resolver.mjs')).href,
  join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'web', '--no-open', '--port', '0'], {
  cwd: runtime, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
const record = chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-100_000) }
child.stdout.on('data', record)
child.stderr.on('data', record)
let browser
let socket
const pending = new Map()
let sequence = 0
const errors = []
const responses = []
const wsFrames = []
const calls = []

async function waitFor(check, milliseconds = 30_000) {
  const until = Date.now() + milliseconds
  while (Date.now() < until) {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Fixture wait timed out')
}

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 15_000)
    pending.set(id, message => {
      clearTimeout(timeout)
      if (message.error) reject(new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`))
      else resolve(message.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error('Browser evaluation failed')
  return result.result.value
}

async function rpc(method, request) {
  const message = { type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }
  const result = await evaluate(`fetch(${JSON.stringify('/api/' + method)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(message))}}).then(response=>response.json())`)
  assert.equal(result.result?.ok, true, JSON.stringify(result))
  return result.result.value
}

async function terminate(process) {
  if (!process || process.exitCode !== null) return
  const closed = once(process, 'exit')
  process.kill()
  await closed
}

try {
  const authUrl = await waitFor(() => {
    if (child.exitCode !== null) throw new Error('Isolated DSH exited before readiness')
    return serverOutput.match(/dsh web: (http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/\?token=[^\s]+)/)?.[1]
  }, 90_000)
  const upstream = new URL(authUrl)
  await relay.start({ upstreamUrl: upstream.origin, upstreamAuthUrl: authUrl, bindAddress, port: 0, trustedLanConsent: true })
  const publicOrigin = relay.origin
  const profile = join(fixture, 'browser')
  await mkdir(profile)
  browser = spawn(browserExecutable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--no-proxy-server', 'about:blank'], {
    env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  })
  browser.stderr.on('data', chunk => process.stderr.write(chunk))
  const debugPort = await waitFor(async () => {
    try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return null }
  })
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const callback = pending.get(message.id)
    if (callback) { pending.delete(message.id); callback(message); return }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Network.responseReceived') responses.push({ status: message.params.response.status, path: new URL(message.params.response.url).pathname })
    if (message.method === 'Network.requestWillBeSent') calls.push({ method: message.params.request.method, path: new URL(message.params.request.url).pathname })
    if (message.method === 'Network.webSocketFrameReceived') wsFrames.push(message.params.response.payloadData)
  })
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Network.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await command('Page.navigate', { url: relay.pair().url })
  await waitFor(() => evaluate('!!document.querySelector("#consent")'))
  const security = await evaluate('({secure:isSecureContext,randomUUID:typeof crypto.randomUUID,subtle:typeof crypto.subtle,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,hash:location.hash})')
  assert.equal(security.secure, false)
  assert.equal(security.randomUUID, 'undefined')
  assert.equal(security.hash, '')
  assert.ok(security.scrollWidth <= security.width)
  await writeFile(join(fixture, 'pair-phone.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await evaluate('document.querySelector("#name").value="Private-IP browser fixture";document.querySelector("#consent").checked=true;document.querySelector("#submit").click()')
  await waitFor(() => evaluate('location.pathname === "/" && !!document.querySelector("#root")'))
  await waitFor(() => wsFrames.length > 0)
  await waitFor(() => evaluate('document.body.innerText.length > 100'))
  await evaluate('[...document.querySelectorAll("button")].find(button=>/^(继续|Continue)$/.test(button.textContent.trim()))?.click()')
  const workspacePath = join(fixture, 'workspace')
  await mkdir(workspacePath)
  const workspace = await rpc('workspace/create', { path: workspacePath })
  await writeFile(join(fixture, 'workspace-result.json'), JSON.stringify(workspace, null, 2))
  const session = await rpc('session/create', { workspaceId: workspace.workspace.workspaceId })
  assert.ok(session.sessionId)
  await writeFile(join(fixture, 'session-result.json'), JSON.stringify(session, null, 2))
  await waitFor(() => wsFrames.some(frame => frame.includes(workspace.workspace.workspaceId)))
  await evaluate(`[...document.querySelectorAll('button')].find(button => ['新建会话', 'New session'].includes(button.getAttribute('aria-label'))).click()`)
  await waitFor(() => evaluate('!!document.querySelector("textarea,[contenteditable=true]")'))
  await new Promise(resolve => setTimeout(resolve, 2500))
  const app = await evaluate('({title:document.title,text:document.body.innerText,inputs:document.querySelectorAll("textarea,[contenteditable=true]").length,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,secure:isSecureContext,randomUUID:typeof crypto.randomUUID})')
  await writeFile(join(fixture, 'dsh-phone.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await writeFile(join(fixture, 'browser-observation.json'), JSON.stringify({ security, app, errors, responses, calls, receivedWebSocketFrames: wsFrames.length }, null, 2))
  assert.equal(app.secure, false)
  assert.ok(app.inputs > 0, 'Actual DSH composer must mount after selecting a workspace')
  assert.ok(calls.some(call => call.method === 'POST' && call.path.startsWith('/api/')), 'Actual DSH should make existing RPC POSTs')
  assert.equal(errors.length, 0, `Browser exception: ${errors.join('\n')}`)
  const failed = responses.filter(response => response.status >= 400 && response.path !== '/favicon.ico'
    && !(response.path === '/manifest.webmanifest' && response.status === 401))
  assert.equal(failed.length, 0, `DSH HTTP requests must succeed: ${JSON.stringify(failed)}`)
  const device = relay.status().devices[0]
  relay.revoke(device.id)
  assert.equal(await evaluate('fetch("/api/remote.mux").then(response=>response.status)'), 401)
  const result = { fixture, publicOrigin, security, app, errors, responses, calls, receivedWebSocketFrames: wsFrames.length,
    revocationDeniedHttp: true, workspaceCreated: workspace.created, sessionCreated: Boolean(session.sessionId), runtime,
    note: 'Actual copied DSH Runtime, no fake API. No LLM prompt or provider credential. HTTP private-IP origin, not loopback secure context. Credential-free PWA manifest intentionally receives 401.' }
  await writeFile(join(fixture, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ fixture, privateIpBrowserPassed: true, receivedWebSocketFrames: wsFrames.length, httpCalls: calls.length, appInputs: app.inputs }))
} finally {
  await writeFile(join(fixture, 'dsh.log'), serverOutput.replace(/([?&]token=)[^\s&#]+/g, '$1[redacted]'))
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close') } catch { socket.close() }
  }
  await terminate(browser)
  await relay.stop()
  await terminate(child)
}
