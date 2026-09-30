import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { fakeDsh } from './fixture.mjs'

const upstream = await fakeDsh()
try {
  const harness = spawn(process.argv[2], [process.execPath, fileURLToPath(new URL('./control-fixture.mjs', import.meta.url)), upstream.origin, upstream.authUrl], {
    windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
  })
  const timer = setTimeout(() => harness.kill(), 60_000)
  const [code] = await once(harness, 'exit')
  clearTimeout(timer)
  process.exitCode = code ?? 1
} finally {
  await upstream.close()
}
