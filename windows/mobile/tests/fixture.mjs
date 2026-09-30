import http from 'node:http'
import { createRequire } from 'node:module'
import { once } from 'node:events'

const require = createRequire(new URL('../../../packages/api/gateway/package.json', import.meta.url))
export const { WebSocket, WebSocketServer } = require('ws')

export async function fakeDsh() {
  const received = []
  const sockets = new Set()
  const websocketServer = new WebSocketServer({ noServer: true })
  const token = 'fixture-launch-token-not-a-real-credential'
  const cookie = 'dsh-auth-fixture=fixture-local-session'
  let origin
  const authorized = request => request.headers.host === new URL(origin).host
    && request.headers.origin === origin && request.headers.cookie === cookie
  const server = http.createServer((request, response) => {
    received.push({ path: request.url, headers: request.headers })
    if (request.url === `/?token=${token}`) {
      response.writeHead(303, { location: '/', 'set-cookie': `${cookie}; HttpOnly; Path=/; SameSite=Strict` })
      response.end()
      return
    }
    if (!authorized(request)) { response.writeHead(401); response.end(); return }
    if (request.url === '/api/hold') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: ready\n\n')
      return
    }
    if (request.url.startsWith('/redirect')) {
      const location = request.url.endsWith('external') ? 'https://example.invalid/steal'
        : request.url.endsWith('token') ? `/?token=${token}` : `${origin}/sessions/demo`
      response.writeHead(302, { location, 'set-cookie': cookie })
      response.end()
      return
    }
    if (request.method === 'POST') {
      response.writeHead(200, { 'content-type': request.headers['content-type'] ?? 'application/octet-stream' })
      request.pipe(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': cookie, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' })
    response.end('<!doctype html><title>Existing DSH app</title><main>DSH fixture</main>')
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (request, socket, head) => {
    received.push({ path: request.url, headers: request.headers })
    if (!authorized(request)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
    websocketServer.handleUpgrade(request, socket, head, websocket => {
      websocket.on('error', () => websocket.terminate())
      websocket.on('message', (data, binary) => websocket.send(data, { binary }))
      websocketServer.emit('connection', websocket, request)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin, token, cookie, authUrl: `${origin}/?token=${token}`, received, server, websocketServer,
    async close() {
      for (const socket of sockets) socket.destroy()
      for (const websocket of websocketServer.clients) websocket.terminate()
      await new Promise(resolve => websocketServer.close(resolve))
      await new Promise(resolve => server.close(resolve))
    },
  }
}

export function request(origin, path = '/', { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(origin + path, { method, headers, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
      response.on('error', reject)
    })
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Fixture request timed out')))
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}
