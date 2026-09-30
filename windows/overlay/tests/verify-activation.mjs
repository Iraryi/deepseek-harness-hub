import assert from 'node:assert/strict'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

const args = process.argv.slice(2)
const option = name => {
  const index = args.indexOf(name)
  assert.ok(index >= 0 && args[index + 1], `Required: ${name}`)
  return resolve(args[index + 1])
}
const sourceRuntime = option('--runtime')
const sourceStage = option('--stage')
const testsRoot = dirname(fileURLToPath(import.meta.url))
const parent = join(testsRoot, 'fixtures')
assert.match(parent, /^D:/i)
mkdirSync(parent, { recursive: true })
const root = mkdtempSync(join(parent, 'activation-'))
const runtime = join(root, 'runtime')
const install = join(root, 'overlay')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const treeHashes = directory => {
  const result = {}
  const walk = current => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const stat = lstatSync(path)
      assert.ok(!stat.isSymbolicLink(), `No linked fixtures: ${path}`)
      if (stat.isDirectory()) walk(path)
      else result[path.slice(directory.length + 1)] = hash(readFileSync(path))
    }
  }
  walk(directory)
  return result
}
console.log(`Creating isolated copied-runtime fixture: ${root}`)
const sourceBefore = treeHashes(sourceRuntime)
cpSync(sourceRuntime, runtime, { recursive: true, errorOnExist: true, force: false })
treeHashes(sourceStage)
cpSync(sourceStage, install, { recursive: true, errorOnExist: true, force: false })
const baseBefore = treeHashes(runtime)
const inventory = JSON.parse(readFileSync(join(install, 'payload-manifest.json'), 'utf8'))
writeFileSync(join(install, 'overlay-binding.json'), JSON.stringify({ Schema: 1, AppId: 'DSH.Overlay.6E4AA8A1-93AD-47D7-AD79-75FA9A01DCBE', Paths: { RuntimeRoot: runtime, InstallRoot: install } }))
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|DSH|DEEPSEEK|NODE_OPTIONS/i.test(name)))
for (const [name, leaf] of Object.entries({ USERPROFILE: 'user', APPDATA: 'roaming', LOCALAPPDATA: 'local', TEMP: 'temp', TMP: 'temp', DSH_HOME: 'hub-isolated-home' })) {
  environment[name] = join(root, leaf)
  mkdirSync(environment[name], { recursive: true })
}
environment.NODE_OPTIONS = ''
environment.DEEPSEEK_HARNESS_OFFLINE = '1'
const node = join(runtime, 'tools', 'node', 'node.exe')
assert.ok(existsSync(node), 'This copied-runtime acceptance runner requires packaged tools/node/node.exe')
const runtimeResolver = pathToFileURL(join(runtime, 'runtime-resolver.mjs')).href
const overlayResolver = pathToFileURL(join(install, 'resolver.mjs')).href
const cli = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const result = { passed: false, fixture: root, packages: [], serviceStarted: false, baseUnchanged: false, sourceUnchanged: false }
const requiredPackages = ['ui-setup-hub', 'ui-settings-general', 'ui-sidebar', 'ui-workspace'].map(name => `@deepseek-ai/dsh-client-${name}`)
let executionVerified = false
let service
let output = ''
try {
  const probe = spawnSync(node, ['--import', runtimeResolver, '--import', overlayResolver, '--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    console.log(JSON.stringify({ nodeVersion: process.version, resolutions: ${JSON.stringify(requiredPackages)}.map(name => ({ name, host: import.meta.resolve(name), client: import.meta.resolve(name + '/client'), metadata: require.resolve(name + '/package.json') })) }));
  `], { cwd: runtime, env: environment, windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(probe.status, 0, probe.stderr)
  const resolved = JSON.parse(probe.stdout)
  for (const entry of resolved.resolutions) {
    for (const name of ['host', 'client', 'metadata']) assert.ok(entry[name].includes('overlay-packages'), `Real runtime resolution escaped Overlay: ${entry.name}/${name}`)
  }
  result.nodeVersion = resolved.nodeVersion
  result.resolutions = resolved.resolutions
  service = spawn(node, ['--import', runtimeResolver, '--import', overlayResolver, cli, 'web', '--no-open', '--port', '0'], {
    cwd: runtime, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  service.stdout.on('data', bytes => { output += bytes.toString() })
  service.stderr.on('data', bytes => { output += bytes.toString() })
  service.on('error', error => { output += `\n${error.stack}` })
  const deadline = Date.now() + 90000
  let launchUrl
  while (Date.now() < deadline) {
    launchUrl = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)?.[1]
    if (launchUrl) break
    if (service.exitCode !== null) throw new Error(`Service exited ${service.exitCode}: ${output.slice(-6000)}`)
    await new Promise(done => setTimeout(done, 200))
  }
  assert.ok(launchUrl, `Timed out waiting for actual web service: ${output.slice(-6000)}`)
  result.serviceStarted = true
  const login = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const origin = new URL(launchUrl).origin
  const indexResponse = await fetch(origin + '/', { headers: { cookie }, signal: AbortSignal.timeout(15000) })
  assert.equal(indexResponse.status, 200)
  const html = await indexResponse.text()
  writeFileSync(join(root, 'index.html'), html)
  const graphScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('__DSH_BOOT__'))
  assert.ok(graphScript, 'Actual index must expose its boot graph')
  const graph = JSON.parse(graphScript.slice(graphScript.indexOf('{'), graphScript.lastIndexOf('}') + 1))
  writeFileSync(join(root, 'boot-graph.json'), JSON.stringify(graph, null, 2))
  for (const entry of inventory.Packages) {
    if (!requiredPackages.includes(entry.Name)) continue
    const relative = join('node_modules', entry.Name, 'lib', 'client.js')
    const overlayPath = join(install, 'payload', 'overlay-packages', relative)
    assert.ok(existsSync(overlayPath), `Required client artifact missing: ${entry.Name}`)
    const expected = readFileSync(overlayPath)
    const basePath = join(runtime, relative)
    const baseHash = existsSync(basePath) ? hash(readFileSync(basePath)) : null
    const row = graph.entries.find(row => row.id === entry.Name)
    assert.ok(row, `Overlay package not activated in boot graph: ${entry.Name}`)
    const response = await fetch(new URL(row.url, origin), { headers: { cookie }, signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, 200, `${entry.Name}: ${await response.clone().text()}`)
    const served = Buffer.from(await response.arrayBuffer())
    let executable = expected.toString('utf8').replace(/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/, '').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '')
    if (!executable.endsWith('\n')) executable += '\n'
    const expectedCombo = Buffer.from(executable + ';\n')
    assert.ok(served.subarray(0, expectedCombo.length).equals(expectedCombo), `Actual HTTP executable bytes differ from Overlay bundle for ${entry.Name}`)
    assert.match(served.subarray(expectedCombo.length).toString('utf8'), /^\/\/# sourceMappingURL=\/plugins\/[^\r\n]+\n$/)
    if (entry.Name === '@deepseek-ai/dsh-client-ui-setup-hub') assert.ok(served.includes(Buffer.from('Management overview')), 'Served HUB must include new Management overview')
    result.packages.push({ name: entry.Name, overlaySha256: hash(expected), baseSha256: baseHash, servedSha256: hash(served), executableSha256: hash(expectedCombo), completeOverlayExecutableBytesServed: true, comparison: 'exact combo bytes; only sourceURL/sourceMappingURL trailers replaced by the server', differsFromBase: hash(expected) !== baseHash })
  }
  assert.ok(result.packages.some(entry => entry.name === '@deepseek-ai/dsh-client-ui-setup-hub' && entry.differsFromBase), 'Must prove new HUB bytes, not identical old runtime')
  assert.equal(result.packages.length, 4, 'Exactly four served package proofs are mandatory; serviceStarted alone is never success')
  assert.deepEqual(result.packages.map(entry => entry.name).sort(), requiredPackages.sort())
  executionVerified = true
} catch (error) {
  result.failure = error.message
  throw error
} finally {
  if (service && service.exitCode === null) {
    const exited = once(service, 'exit')
    service.kill()
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Owned fixture Node failed to stop')), 10000).unref())])
  }
  result.baseUnchanged = JSON.stringify(treeHashes(runtime)) === JSON.stringify(baseBefore)
  result.sourceUnchanged = JSON.stringify(treeHashes(sourceRuntime)) === JSON.stringify(sourceBefore)
  result.passed = executionVerified && result.baseUnchanged && result.sourceUnchanged
  writeFileSync(join(root, 'service.log'), output.replace(/token=[^\s&]+/g, 'token=REDACTED'))
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2))
}
assert.ok(result.baseUnchanged && result.sourceUnchanged, 'Base and source Runtime file inventories must remain unchanged')
console.log(JSON.stringify(result, null, 2))
