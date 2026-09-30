import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MobileRelay } from '../relay.mjs'
import { fakeDsh, request, WebSocket } from './fixture.mjs'

async function setup(context) {
  const upstream = await fakeDsh()
  const relay = new MobileRelay({ allowLoopbackForTests: true })
  context.after(async () => { await relay.stop(); await upstream.close() })
  const options = { upstreamUrl: upstream.origin, upstreamAuthUrl: upstream.authUrl, bindAddress: '127.0.0.1', port: 0, trustedLanConsent: true }
  await relay.start(options)
  return { upstream, relay, options, origin: relay.origin }
}

async function pair(relay, name = 'Test phone 手机') {
  const grant = relay.pair()
  const response = await request(relay.origin, '/__mobile/pair', {
    method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ secret: new URL(grant.url).hash.slice(1), name, consent: true }),
  })
  assert.equal(response.status, 200)
  return { cookie: response.headers['set-cookie'][0].split(';', 1)[0], id: relay.status().devices.at(-1).id, grant }
}

function openWs(origin, cookie, extra = {}) {
  const websocket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie, origin, ...extra } })
  return once(websocket, 'open').then(() => websocket)
}

async function deniedWs(origin, headers) {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers })
    websocket.on('unexpected-response', (_request, response) => {
      response.resume()
      websocket.terminate()
      resolve(response.statusCode)
    })
    websocket.on('error', error => { if (!error.message.includes('closed before')) reject(error) })
    websocket.on('open', () => { websocket.terminate(); reject(new Error('Unauthorized upgrade succeeded')) })
  })
}

test('production remains stopped without consent and rejects wildcard/public/loopback binds and non-loopback upstreams', async () => {
  const relay = new MobileRelay()
  assert.equal(relay.status().running, false)
  assert.equal(relay.sockets.size, 0)
  const options = { bindAddress: '127.0.0.1', upstreamUrl: 'http://127.0.0.1:1', port: 0, trustedLanConsent: true }
  await assert.rejects(relay.start({ ...options, trustedLanConsent: false }), { code: 'consent_required' })
  for (const bindAddress of ['0.0.0.0', '::', '127.0.0.1', '8.8.8.8', '192.168.999.1', 'localhost']) {
    await assert.rejects(relay.start({ ...options, bindAddress }), { code: 'invalid_bind' })
  }
  const isolated = new MobileRelay({ allowLoopbackForTests: true })
  for (const upstreamUrl of ['http://example.com', 'http://192.168.1.2', 'file:///D:/fixture', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/api', 'http://127.0.0.1/?token=x']) {
    await assert.rejects(isolated.start({ ...options, upstreamUrl }), { code: 'invalid_upstream' })
  }
  await relay.stop()
  await relay.stop()
  assert.equal(relay.status().running, false)
})

test('DSH reachability and authenticated root are checked before listening, without following auth redirects', async context => {
  const upstream = await fakeDsh()
  context.after(() => upstream.close())
  const relay = new MobileRelay({ allowLoopbackForTests: true })
  context.after(() => relay.stop())
  const options = { bindAddress: '127.0.0.1', upstreamUrl: upstream.origin, port: 0, trustedLanConsent: true }
  await assert.rejects(relay.start(options), { code: 'upstream_auth_required' })
  assert.equal(relay.server, null)
  await assert.rejects(relay.start({ ...options, upstreamAuthUrl: 'http://127.0.0.1:1/?token=wrong-server' }), { code: 'invalid_auth' })
  await assert.rejects(relay.start({ ...options, upstreamAuthUrl: `${upstream.origin}/?token=bad` }), { code: 'upstream_auth_required' })
  await assert.rejects(relay.start({ ...options, upstreamAuthUrl: `${upstream.authUrl}&other=1` }), { code: 'invalid_auth' })
  await relay.start({ ...options, upstreamCookie: upstream.cookie })
  assert.equal(relay.status().running, true)
  await relay.stop()
  const closedPort = upstream.server.address().port
  await upstream.close()
  await assert.rejects(relay.start({ ...options, upstreamUrl: `http://127.0.0.1:${closedPort}` }), { code: 'upstream_unreachable' })
})

test('unpaired HTTP and WS never contact any upstream endpoint, including credentials/files/static assets', async context => {
  const { relay, upstream, origin } = await setup(context)
  const before = upstream.received.length
  for (const path of ['/', '/api/session.list', '/api/credentials.set', '/api/fs/read?path=D:/fixture', '/assets/index.js', '/.env', '/__mobile/status']) {
    assert.equal((await request(origin, path)).status, 401)
  }
  assert.equal(await deniedWs(origin, { origin }), 401)
  assert.equal((await request(origin, '/__mobile/pair')).status, 200)
  assert.equal((await request(origin, '/__mobile/pair.mjs')).status, 200)
  assert.equal(upstream.received.length, before)
  assert.equal(relay.status().devices.length, 0)
})

test('pairing is explicit, short-lived, single-use, replaceable, origin fenced and never leaks backend credentials', async context => {
  const { relay, upstream, origin } = await setup(context)
  const grant = relay.pair()
  const token = new URL(grant.url).hash.slice(1)
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.ok(Date.parse(grant.expiresAt) - Date.now() > 119_000)
  assert.ok(Date.parse(grant.expiresAt) - Date.now() <= 120_000)
  const submit = (secret, extra = {}, headers = {}) => request(origin, '/__mobile/pair', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ secret, consent: true, ...extra }),
  })
  assert.equal((await submit(token, {}, { origin: 'http://evil.invalid' })).status, 403)
  assert.equal((await submit(token, { consent: false })).status, 401)
  relay.pair()
  assert.equal((await submit(token)).status, 401)
  const device = await pair(relay)
  assert.equal((await submit(new URL(device.grant.url).hash.slice(1))).status, 401)
  assert.equal(relay.status().devices[0].name, 'Test phone 手机')
  const status = JSON.stringify(relay.status())
  for (const privateValue of [token, device.cookie, upstream.token, upstream.cookie]) assert.ok(!status.includes(privateValue))
  const page = await request(origin, '/', { headers: { cookie: device.cookie } })
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('Existing DSH app'))
  assert.equal(page.headers['set-cookie'], undefined)
  assert.equal(page.headers['access-control-allow-origin'], undefined)
  assert.equal(page.headers['cache-control'], 'no-store')
  const expired = relay.pair()
  relay.grant.expires = Date.now() - 1
  assert.equal((await submit(new URL(expired.url).hash.slice(1))).status, 401)
  relay.expire()
  assert.equal(relay.status().pairingExpiresAt, null)
})

test('authenticated GET/POST assets, query, streaming and WebSocket use existing upstream with rewritten trust headers', async context => {
  const { relay, upstream, origin } = await setup(context)
  const { cookie } = await pair(relay)
  assert.equal((await request(origin, '/assets/app.js?version=1', { headers: { cookie } })).status, 200)
  const payload = JSON.stringify({ args: { message: 'Hello 手机', workspace: 'D:/fixture' } })
  const posted = await request(origin, '/api/session.send', {
    method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', authorization: 'Bearer do-not-forward', 'x-forwarded-host': 'evil.invalid' }, body: payload,
  })
  assert.equal(posted.status, 200)
  assert.equal(posted.body, payload)
  const seen = upstream.received.at(-1)
  assert.equal(seen.headers.cookie, upstream.cookie)
  assert.equal(seen.headers.origin, upstream.origin)
  assert.equal(seen.headers.authorization, undefined)
  assert.equal(seen.headers['x-forwarded-host'], undefined)
  const websocket = await openWs(origin, cookie)
  const received = once(websocket, 'message')
  websocket.send(JSON.stringify({ type: 'open', id: 'fixture-stream', endpoint: '$events', payload: { args: {} } }))
  const [data] = await received
  assert.equal(JSON.parse(data.toString()).endpoint, '$events')
  const binary = once(websocket, 'message')
  websocket.send(Buffer.from([0, 127, 255]))
  assert.deepEqual((await binary)[0], Buffer.from([0, 127, 255]))
  websocket.terminate()
})

test('authenticated requests reject hostile Host/Origin, query tokens and cross-site traffic before forwarding', async context => {
  const { relay, upstream, origin } = await setup(context)
  const { cookie } = await pair(relay)
  const before = upstream.received.length
  for (const headers of [{ host: 'evil.invalid' }, { origin: 'null' }, { origin: 'https://evil.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request(origin, '/api/session.list', { headers: { cookie, ...headers } })).status, 403)
  }
  assert.equal((await request(origin, '/api/session.send', { method: 'POST', headers: { cookie }, body: '{}' })).status, 403)
  assert.equal((await request(origin, '/?token=do-not-forward', { headers: { cookie } })).status, 400)
  assert.equal((await request(origin, '/__mobile/revoke', { method: 'POST', headers: { origin, cookie } })).status, 404)
  assert.equal(await deniedWs(origin, { cookie, origin: 'http://evil.invalid' }), 403)
  assert.equal(await deniedWs(origin, { cookie }), 403)
  assert.equal(upstream.received.length, before)
})

test('redirects cannot leak launch tokens or send the phone to loopback/external hosts', async context => {
  const { relay, origin } = await setup(context)
  const { cookie } = await pair(relay)
  const local = await request(origin, '/redirect', { headers: { cookie } })
  assert.equal(local.status, 302)
  assert.equal(local.headers.location, '/sessions/demo')
  assert.equal(local.headers['set-cookie'], undefined)
  for (const path of ['/redirect-external', '/redirect-token']) {
    assert.equal((await request(origin, path, { headers: { cookie } })).status, 502)
  }
})

test('revoke disconnects active WebSocket and streamed HTTP, rejects old cookies, leaves other devices working', async context => {
  const { relay, origin } = await setup(context)
  const first = await pair(relay, 'First')
  const second = await pair(relay, 'Second')
  const websocket = await openWs(origin, first.cookie)
  const wsClosed = once(websocket, 'close')
  const streaming = http.get(origin + '/api/hold', { headers: { cookie: first.cookie }, agent: false })
  const [response] = await once(streaming, 'response')
  const [chunk] = await once(response, 'data')
  assert.equal(chunk.toString(), 'data: ready\n\n')
  const httpClosed = new Promise(resolve => response.on('close', resolve))
  response.on('error', () => {})
  relay.revoke(first.id)
  await Promise.all([wsClosed, httpClosed])
  assert.equal((await request(origin, '/', { headers: { cookie: first.cookie } })).status, 401)
  assert.equal(await deniedWs(origin, { origin, cookie: first.cookie }), 401)
  assert.equal((await request(origin, '/', { headers: { cookie: second.cookie } })).status, 200)
  assert.equal(relay.status().devices.length, 1)
  relay.revoke(first.id)
  relay.devices.get(second.id).expiresAt = new Date(Date.now() - 1).toISOString()
  assert.equal((await request(origin, '/', { headers: { cookie: second.cookie } })).status, 401)
  relay.expire()
  assert.equal(relay.status().devices.length, 0)
})

test('stop reaches quiescence, closes WS, clears secrets and permits restart without resurrecting devices', async context => {
  const { relay, origin, options } = await setup(context)
  const device = await pair(relay)
  const websocket = await openWs(origin, device.cookie)
  const wsClosed = once(websocket, 'close')
  relay.pair()
  await Promise.all([relay.stop(), relay.stop(), wsClosed])
  assert.equal(relay.status().running, false)
  assert.equal(relay.status().devices.length, 0)
  assert.equal(relay.grant, null)
  assert.equal(relay.upstreamCookie, '')
  assert.equal(relay.sockets.size, 0)
  assert.equal(relay.requests.size, 0)
  await assert.rejects(request(origin), { code: 'ECONNREFUSED' })
  await relay.start(options)
  assert.equal((await request(relay.origin, '/', { headers: { cookie: device.cookie } })).status, 401)
  await assert.rejects(relay.start(options), { code: 'already_running' })
})

test('pairing attempts and control line input are bounded; protocol handles idle status and EOF', async context => {
  const { origin, relay } = await setup(context)
  const grant = relay.pair()
  for (let attempt = 0; attempt < 30; attempt++) {
    assert.equal((await request(origin, '/__mobile/pair', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}',
    })).status, 401)
  }
  assert.equal((await request(origin, '/__mobile/pair', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ secret: new URL(grant.url).hash.slice(1), consent: true }),
  })).status, 429)
  const child = spawn(process.execPath, [fileURLToPath(new URL('../relay.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  context.after(() => child.kill())
  let output = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.stdin.end('\uFEFF{"id":"bom","command":"status"}\n{bad}\n{"id":"check","command":"status"}\n{"id":"stop","command":"stop"}\n')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  const messages = output.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(messages.find(message => message.id === 'check').result.running, false)
  assert.equal(messages.find(message => message.id === 'bom').result.running, false)
  assert.equal(messages.find(message => message.id === 'stop').ok, true)
  assert.equal(messages.find(message => message.id === null).ok, false)
})

test('stdin EOF while serving closes authenticated WS, listener and Node process', async context => {
  const upstream = await fakeDsh()
  context.after(() => upstream.close())
  const child = spawn(process.execPath, [fileURLToPath(new URL('./control-fixture.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  context.after(() => child.kill())
  const replies = new Map()
  let buffer = ''
  child.stdout.setEncoding('utf8').on('data', chunk => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const response = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (response.id) { replies.get(response.id)?.(response); replies.delete(response.id) }
    }
  })
  const send = command => new Promise(resolve => {
    replies.set(command.id, resolve)
    child.stdin.write(JSON.stringify(command) + '\n')
  })
  const started = await send({ id: 'start', command: 'start', upstreamUrl: upstream.origin, upstreamAuthUrl: upstream.authUrl,
    bindAddress: '127.0.0.1', port: 0, trustedLanConsent: true })
  assert.equal(started.ok, true)
  const origin = new URL(started.result.url).origin
  const grant = await send({ id: 'pair', command: 'pair' })
  const paired = await request(origin, '/__mobile/pair', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ secret: new URL(grant.result.url).hash.slice(1), consent: true }) })
  const cookie = paired.headers['set-cookie'][0].split(';', 1)[0]
  const websocket = await openWs(origin, cookie)
  const wsClosed = once(websocket, 'close')
  const exited = once(child, 'exit')
  child.stdin.end()
  assert.equal((await exited)[0], 0)
  await wsClosed
  await assert.rejects(request(origin), { code: 'ECONNREFUSED' })
})

test('reused HTTP keep-alive sockets do not accumulate close/error listeners', async context => {
  const { relay, origin } = await setup(context)
  const { cookie } = await pair(relay)
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  context.after(() => agent.destroy())
  for (let iteration = 0; iteration < 25; iteration++) {
    await new Promise((resolve, reject) => {
      http.get(origin, { agent, headers: { cookie } }, response => {
        response.resume()
        response.on('end', resolve)
      }).on('error', reject)
    })
  }
  for (const socket of relay.sockets) {
    assert.ok(socket.listenerCount('close') < 8)
    assert.ok(socket.listenerCount('error') < 8)
  }
})
