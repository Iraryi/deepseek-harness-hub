import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, directory] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find(item => item.type === 'page' && item.url.includes('dshSurface=hub'))
if (!target) throw new Error('Resumed HUB page target missing')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const callback = pending.get(message.id)
  if (callback) { pending.delete(message.id); callback(message) }
})
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 5000)
    pending.set(id, message => { clearTimeout(timeout); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
try {
  const response = await command('Runtime.evaluate', { expression: '({ready:document.readyState,home:!!document.querySelector("main[data-section=home]"),width:innerWidth,height:innerHeight})', returnByValue: true })
  if (!response.result.value?.home || response.result.value.ready !== 'complete') throw new Error(`HUB did not remain mounted: ${JSON.stringify(response)}`)
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(directory, 'resumed-hub.png'), Buffer.from(screenshot.data, 'base64'))
  console.log('PASS: resumed WebView DOM is complete, HUB home remains mounted, screenshot captured')
} finally { socket.close() }
