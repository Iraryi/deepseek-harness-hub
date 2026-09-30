import http from 'node:http'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const PAIR_TTL = 120_000
const DEVICE_TTL = 8 * 60 * 60_000
const MAX_DEVICES = 16
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

class RelayError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function fail(code, message) {
  throw new RelayError(code, message)
}

function secret() {
  return randomBytes(32).toString('base64url')
}

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function privateAddress(value) {
  if (typeof value !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return false
  const octets = value.split('.').map(Number)
  if (octets.some(part => part > 255) || octets.join('.') !== value) return false
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function loopbackUrl(value) {
  let parsed
  try { parsed = new URL(value) } catch { fail('invalid_upstream', 'Provide an explicit HTTP loopback DSH origin.') }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('invalid_upstream', 'DSH upstream must be an HTTP loopback origin without path, query or credentials.')
  }
  if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
  return parsed
}

function cleanHeaders(headers) {
  const result = { ...headers }
  const nominated = String(headers.connection ?? '').toLowerCase().split(',').map(part => part.trim())
  for (const name of [...HOP_HEADERS, ...nominated]) delete result[name]
  for (const name of Object.keys(result)) {
    if (name.startsWith('x-forwarded-') || name.startsWith('access-control-')
      || ['forwarded', 'via', 'authorization', 'cookie', 'set-cookie', 'host', 'origin', 'referer'].includes(name)) delete result[name]
  }
  return result
}

function reply(response, status, value, extra = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  })
  response.end(JSON.stringify(value))
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 4096) fail('invalid_pair', 'Pairing request too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('invalid_pair', 'Invalid pairing request.') }
}

function probe(upstream, path, cookie) {
  return new Promise((resolve, reject) => {
    const request = http.request(upstream, { path, agent: false, headers: { cookie, origin: upstream.origin } }, response => {
      response.resume()
      resolve({ status: response.statusCode, cookies: response.headers['set-cookie'] ?? [], location: response.headers.location })
    })
    const timeout = setTimeout(() => request.destroy(new Error('timeout')), 4000)
    request.on('close', () => clearTimeout(timeout))
    request.on('error', () => reject(new RelayError('upstream_unreachable', 'DSH loopback endpoint is not reachable; start DSH first.')))
    request.end()
  })
}

export class MobileRelay {
  constructor({ allowLoopbackForTests = false, onStatus = () => {} } = {}) {
    this.allowLoopbackForTests = allowLoopbackForTests
    this.onStatus = onStatus
    this.server = null
    this.upstream = null
    this.upstreamCookie = ''
    this.origin = null
    this.devices = new Map()
    this.sockets = new Set()
    this.socketOwners = new WeakMap()
    this.requests = new Set()
    this.grant = null
    this.timer = null
    this.starting = false
    this.stopping = null
    this.pairAttempts = 0
    this.pairWindow = 0
  }

  status() {
    return {
      running: Boolean(this.server?.listening),
      bindAddress: this.server?.listening ? this.server.address().address : null,
      port: this.server?.listening ? this.server.address().port : null,
      url: this.origin ? `${this.origin}/__mobile/pair` : null,
      upstreamUrl: this.upstream?.origin ?? null,
      transport: 'http-trusted-lan',
      devices: [...this.devices.values()].map(({ id, name, pairedAt, lastSeen, expiresAt }) => ({ id, name, pairedAt, lastSeen, expiresAt })),
      pairingExpiresAt: this.grant ? new Date(this.grant.expires).toISOString() : null,
    }
  }

  changed() {
    try { this.onStatus(this.status()) } catch (error) { process.stderr.write(`Mobile status subscriber failed: ${error.name}\n`) }
  }

  async start(options) {
    if (this.starting || this.server || this.stopping) fail('already_running', 'Stop the current relay before starting again.')
    this.starting = true
    try {
      if (options.trustedLanConsent !== true) fail('consent_required', 'Explicit consent to unencrypted trusted-LAN access is required.')
      const bindAddress = options.bindAddress
      const testLoopback = this.allowLoopbackForTests && bindAddress === '127.0.0.1'
      const local = Object.values(networkInterfaces()).flat().some(address => address?.address === bindAddress && !address.internal)
      if (!testLoopback && (!privateAddress(bindAddress) || !local)) {
        fail('invalid_bind', 'Select an RFC1918 IPv4 address assigned to this computer; wildcard/public binds are forbidden.')
      }
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) fail('invalid_port', 'Port must be an integer from 0 through 65535.')
      const upstream = loopbackUrl(options.upstreamUrl)
      let cookie = options.upstreamCookie ?? ''
      if (typeof cookie !== 'string' || cookie.length > 8192 || /[\r\n]/.test(cookie)) fail('invalid_auth', 'Invalid DSH browser cookie.')
      if (options.upstreamAuthUrl) {
        let auth
        try { auth = new URL(options.upstreamAuthUrl) } catch { fail('invalid_auth', 'Invalid DSH launch URL.') }
        const authOrigin = loopbackUrl(auth.origin)
        if (authOrigin.origin !== upstream.origin || auth.pathname !== '/' || auth.username || auth.password || auth.hash
          || auth.searchParams.getAll('token').length !== 1 || [...auth.searchParams.keys()].some(key => key !== 'token')) {
          fail('invalid_auth', 'DSH launch URL must match the configured DSH loopback origin and contain only its token.')
        }
        const exchanged = await probe(upstream, `/${auth.search}`, cookie)
        if (exchanged.status !== 303 || exchanged.location !== '/') fail('upstream_auth_required', 'DSH launch-token exchange failed; supply its current launch URL.')
        cookie = exchanged.cookies.filter(value => value.startsWith('dsh-auth-')).map(value => value.split(';', 1)[0]).join('; ') || cookie
      }
      const health = await probe(upstream, '/', cookie)
      if (health.status === 401 || health.status === 403) fail('upstream_auth_required', 'DSH authentication required; supply a DSH launch URL or browser cookie, not HUB credentials.')
      if (health.status !== 200) fail('upstream_not_ready', 'DSH root did not return HTTP 200; no LAN listener was started.')
      this.page = await readFile(new URL('./pair.html', import.meta.url))
      this.script = await readFile(new URL('./pair.mjs', import.meta.url))
      this.upstream = upstream
      this.upstreamCookie = cookie
      const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) => {
        this.handle(request, response).catch(error => {
          if (!response.headersSent && !response.destroyed) reply(response, 400, { error: error.code ?? 'invalid_request' })
          else response.destroy()
        })
      })
      this.server = server
      server.maxConnections = 128
      server.keepAliveTimeout = 5000
      server.on('connection', socket => this.track(socket))
      server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head))
      server.on('clientError', (_error, socket) => socket.destroy())
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port, bindAddress, () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      server.on('error', () => { void this.stop() })
      this.origin = `http://${bindAddress}:${server.address().port}`
      this.cookieName = `dsh-mobile-${server.address().port}`
      this.timer = setInterval(() => this.expire(), 1000)
      this.timer.unref()
      this.changed()
      return this.status()
    } catch (error) {
      await this.stop()
      if (error instanceof RelayError) throw error
      fail('start_failed', 'Unable to start mobile relay; check local address, port and installed relay files.')
    } finally {
      this.starting = false
    }
  }

  track(socket, device) {
    if (!this.sockets.has(socket)) {
      this.sockets.add(socket)
      this.socketOwners.set(socket, new Set())
      socket.once('close', () => {
        this.sockets.delete(socket)
        for (const owner of this.socketOwners.get(socket)) owner.connections.delete(socket)
        this.socketOwners.delete(socket)
      })
      socket.on('error', () => socket.destroy())
    }
    if (device) {
      this.socketOwners.get(socket).add(device)
      device.connections.add(socket)
    }
  }

  pair() {
    if (!this.server?.listening) fail('not_running', 'Start the relay before creating a pairing link.')
    this.expire()
    if (this.devices.size >= MAX_DEVICES) fail('device_limit', 'Revoke a device before pairing another.')
    const token = secret()
    this.grant = { hash: digest(token), expires: Date.now() + PAIR_TTL }
    this.changed()
    return { url: `${this.origin}/__mobile/pair#${token}`, expiresAt: new Date(this.grant.expires).toISOString() }
  }

  revoke(deviceId) {
    const device = this.devices.get(deviceId)
    if (device) {
      this.devices.delete(deviceId)
      for (const socket of device.connections) socket.destroy()
      device.connections.clear()
      this.changed()
    }
    return this.status()
  }

  expire() {
    if (this.grant && this.grant.expires <= Date.now()) {
      this.grant = null
      this.changed()
    }
    for (const device of this.devices.values()) {
      if (Date.parse(device.expiresAt) <= Date.now()) this.revoke(device.id)
    }
  }

  trusted(request, requireOrigin = false) {
    return request.headers.host === new URL(this.origin).host
      && request.headers['sec-fetch-site'] !== 'cross-site'
      && (request.headers.origin === this.origin || (!requireOrigin && request.headers.origin === undefined))
  }

  authenticate(request) {
    const tokens = String(request.headers.cookie ?? '').split(';').map(part => part.trim())
      .filter(part => part.startsWith(`${this.cookieName}=`)).map(part => part.slice(this.cookieName.length + 1))
    if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tokens[0])) return null
    const hashed = digest(tokens[0])
    const device = [...this.devices.values()].find(candidate => timingSafeEqual(candidate.hash, hashed))
    if (!device || Date.parse(device.expiresAt) <= Date.now()) return null
    device.lastSeen = new Date().toISOString()
    return device
  }

  requestPath(request) {
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || /[\\\x00-\x20#]/.test(request.url)) return null
    let parsed
    try { parsed = new URL(request.url, this.origin) } catch { return null }
    if (parsed.origin !== this.origin || parsed.searchParams.has('token')) return null
    return parsed
  }

  async handle(request, response) {
    if (!this.origin || !this.trusted(request, !['GET', 'HEAD'].includes(request.method))) return reply(response, 403, { error: 'forbidden' })
    const path = this.requestPath(request)
    if (!path) return reply(response, 400, { error: 'invalid_path' })
    if (request.method === 'GET' && ['/__mobile/pair', '/__mobile/pair.mjs'].includes(path.pathname)) {
      response.writeHead(200, {
        'content-type': path.pathname.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      })
      response.end(path.pathname.endsWith('.mjs') ? this.script : this.page)
      return
    }
    if (request.method === 'POST' && path.pathname === '/__mobile/pair') {
      if (Date.now() - this.pairWindow > 60_000) { this.pairWindow = Date.now(); this.pairAttempts = 0 }
      if (++this.pairAttempts > 30) return reply(response, 429, { error: 'rate_limited' })
      if (request.headers['content-type'] !== 'application/json') return reply(response, 415, { error: 'json_required' })
      const body = await readJson(request)
      if (!body || body.consent !== true || typeof body.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.secret)
        || !this.grant || this.grant.expires <= Date.now() || !timingSafeEqual(this.grant.hash, digest(body.secret))) {
        return reply(response, 401, { error: 'invalid_or_expired_pair' })
      }
      if (this.devices.size >= MAX_DEVICES) return reply(response, 409, { error: 'device_limit' })
      const token = secret()
      const now = new Date().toISOString()
      const device = {
        id: randomBytes(16).toString('hex'),
        name: typeof body.name === 'string' ? body.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) || 'Phone' : 'Phone',
        hash: digest(token), pairedAt: now, lastSeen: now,
        expiresAt: new Date(Date.now() + DEVICE_TTL).toISOString(), connections: new Set(),
      }
      this.grant = null
      this.devices.set(device.id, device)
      reply(response, 200, { paired: true, redirect: '/' }, {
        'set-cookie': `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_TTL / 1000}`,
      })
      this.changed()
      return
    }
    const device = this.authenticate(request)
    if (!device) return reply(response, 401, { error: 'pairing_required' })
    if (path.pathname.startsWith('/__mobile/')) return reply(response, 404, { error: 'not_found' })
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return reply(response, 405, { error: 'method_not_allowed' })
    this.proxy(request, response, path, device)
  }

  headers(request, websocket = false) {
    const headers = cleanHeaders(request.headers)
    headers.host = this.upstream.host
    headers.origin = this.upstream.origin
    headers.cookie = this.upstreamCookie
    headers['sec-fetch-site'] = 'same-origin'
    if (websocket) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    return headers
  }

  ownRequest(upstream, device) {
    this.requests.add(upstream)
    upstream.once('close', () => this.requests.delete(upstream))
    upstream.on('socket', socket => {
      this.track(socket, device)
      if (!this.devices.has(device.id)) { socket.destroy(); upstream.destroy() }
    })
  }

  proxy(request, response, path, device) {
    this.track(request.socket, device)
    const upstream = http.request(this.upstream, {
      method: request.method, path: path.pathname + path.search,
      headers: this.headers(request), agent: false,
    }, incoming => {
      if (!this.upstream || !this.devices.has(device.id)) { incoming.destroy(); response.destroy(); return }
      const headers = cleanHeaders(incoming.headers)
      headers['cache-control'] = 'no-store'
      headers['referrer-policy'] = 'no-referrer'
      delete headers['clear-site-data']
      if (headers.location) {
        let location
        try { location = new URL(headers.location, this.upstream) } catch { incoming.destroy(); return reply(response, 502, { error: 'invalid_redirect' }) }
        if (location.origin !== this.upstream.origin || location.searchParams.has('token')) {
          incoming.destroy()
          return reply(response, 502, { error: 'external_redirect_blocked' })
        }
        headers.location = location.pathname + location.search + location.hash
      }
      response.writeHead(incoming.statusCode, headers)
      incoming.on('error', () => response.destroy())
      incoming.pipe(response)
    })
    this.ownRequest(upstream, device)
    upstream.setTimeout(60_000, () => upstream.destroy())
    upstream.on('error', () => {
      if (!response.headersSent && !response.destroyed) reply(response, 502, { error: 'upstream_failed' })
      else response.destroy()
    })
    request.on('aborted', () => upstream.destroy())
    response.on('close', () => upstream.destroy())
    request.pipe(upstream)
  }

  upgrade(request, socket, head) {
    const deny = status => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    if (!this.origin || !this.trusted(request, true)) return deny(403)
    const device = this.authenticate(request)
    if (!device) return deny(401)
    const path = this.requestPath(request)
    if (!path || path.pathname.startsWith('/__mobile/') || request.method !== 'GET'
      || request.headers.upgrade?.toLowerCase() !== 'websocket') return deny(400)
    this.track(socket, device)
    socket.pause()
    const upstream = http.request(this.upstream, {
      path: path.pathname + path.search, headers: this.headers(request, true), agent: false,
    })
    this.ownRequest(upstream, device)
    const timer = setTimeout(() => upstream.destroy(), 5000)
    upstream.on('close', () => clearTimeout(timer))
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.on('response', incoming => { incoming.destroy(); deny(incoming.statusCode === 401 ? 401 : 502) })
    upstream.on('upgrade', (incoming, carrier, upstreamHead) => {
      clearTimeout(timer)
      if (socket.destroyed || !this.devices.has(device.id)) { carrier.destroy(); socket.destroy(); return }
      const headers = cleanHeaders(incoming.headers)
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
      const lines = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`))
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) carrier.write(head)
      socket.on('close', () => carrier.destroy())
      carrier.on('close', () => socket.destroy())
      socket.pipe(carrier).pipe(socket)
      socket.resume()
    })
    upstream.end()
  }

  async stop() {
    if (this.stopping) return this.stopping
    this.stopping = this.close()
    try { return await this.stopping } finally { this.stopping = null }
  }

  async close() {
    clearInterval(this.timer)
    this.timer = null
    this.grant = null
    this.devices.clear()
    const server = this.server
    this.server = null
    this.origin = null
    this.upstream = null
    this.upstreamCookie = ''
    for (const request of this.requests) request.destroy()
    const closed = [...this.sockets].map(socket => new Promise(resolve => {
      if (socket.closed) return resolve()
      socket.once('close', resolve)
      socket.destroy()
    }))
    if (server) closed.push(new Promise(resolve => server.close(resolve)))
    await Promise.all(closed)
    this.requests.clear()
    this.sockets.clear()
    this.changed()
    return this.status()
  }
}

export function runControl(relay = new MobileRelay()) {
  const output = value => process.stdout.write(`${JSON.stringify(value)}\n`)
  relay.onStatus = status => output({ event: 'status', status })
  let pending = ''
  let queue = Promise.resolve()
  let ending = false
  let queued = 0
  const shutdown = () => {
    if (ending) return
    ending = true
    process.stdin.pause()
    void queue.finally(async () => { await relay.stop(); process.exit(0) })
  }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    if (ending) return
    pending += chunk
    if (pending.length > 65_536 || queued > 64) { shutdown(); return }
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      if (queued >= 64) { shutdown(); return }
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      queued++
      queue = queue.then(async () => {
        let command
        try {
          command = JSON.parse(line.replace(/^\uFEFF/, ''))
          if (!command || typeof command.id !== 'string' || command.id.length > 128) fail('invalid_command', 'Command requires a string id.')
          let result
          switch (command.command) {
            case 'status': result = relay.status(); break
            case 'start': result = await relay.start(command); break
            case 'pair': result = relay.pair(); break
            case 'revoke':
              if (typeof command.deviceId !== 'string') fail('invalid_command', 'Revoke requires deviceId.')
              result = relay.revoke(command.deviceId); break
            case 'stop': result = await relay.stop(); break
            default: fail('invalid_command', 'Unknown relay command.')
          }
          output({ id: command.id, ok: true, result })
        } catch (error) {
          output({ id: typeof command?.id === 'string' ? command.id : null, ok: false,
            error: { code: error.code ?? 'command_failed', message: error instanceof RelayError ? error.message : 'Relay command failed.' } })
        } finally { queued-- }
      })
    }
  })
  process.stdin.on('end', shutdown)
  process.stdin.on('error', shutdown)
  process.stdout.on('error', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  const parent = process.ppid
  const watcher = setInterval(() => {
    try { process.kill(parent, 0) } catch { shutdown() }
  }, 1000)
  watcher.unref()
  output({ event: 'ready', protocol: 1 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runControl()
