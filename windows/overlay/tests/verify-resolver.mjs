import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const testsRoot = dirname(fileURLToPath(import.meta.url))
const fixtureParent = join(testsRoot, 'fixtures')
assert.match(fixtureParent, /^D:/i)
mkdirSync(fixtureParent, { recursive: true })
const root = mkdtempSync(join(fixtureParent, 'resolver-'))
const runtime = join(root, 'base runtime')
const install = join(root, 'Overlay space 中文')
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const packageName = '@deepseek-ai/dsh-client-ui-setup-hub'
const basePackage = join(runtime, 'node_modules', packageName)
const overridePackage = join(install, 'payload', 'overlay-packages', 'node_modules', packageName)
const metadata = JSON.stringify({ name: packageName, type: 'module', exports: { '.': './index.mjs', './client': './client.mjs', './package.json': './package.json' } })
put(join(basePackage, 'package.json'), metadata)
put(join(basePackage, 'index.mjs'), 'export const identity = "OLD"')
put(join(basePackage, 'client.mjs'), 'export const bytes = "OLD-CLIENT"')
put(join(overridePackage, 'package.json'), metadata)
put(join(overridePackage, 'index.mjs'), 'export { identity } from "base-only-dependency"')
put(join(overridePackage, 'client.mjs'), 'export const bytes = "NEW-CLIENT"')
put(join(runtime, 'node_modules', 'base-only-dependency', 'package.json'), '{"name":"base-only-dependency","type":"module","exports":"./index.mjs"}')
put(join(runtime, 'node_modules', 'base-only-dependency', 'index.mjs'), 'export const identity = "NEW-HOST-USING-BASE-DEPENDENCY"')
put(join(install, 'overlay-binding.json'), JSON.stringify({ Schema: 1, Paths: { RuntimeRoot: runtime } }))
put(join(install, 'payload-manifest.json'), JSON.stringify({ Schema: 1, Packages: [{ Name: packageName, RepositoryDirectory: 'packages/client/ui-setup-hub' }] }))
copyFileSync(join(testsRoot, '..', 'resolver.mjs'), join(install, 'resolver.mjs'))
copyFileSync(join(testsRoot, '..', '..', 'runtime', 'runtime-resolver.mjs'), join(runtime, 'runtime-resolver.mjs'))
const oldBytes = readFileSync(join(basePackage, 'client.mjs'), 'utf8')
const probe = join(runtime, 'probe.mjs')
put(probe, `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { identity } from '${packageName}'
import { bytes } from '${packageName}/client'
import { bytes as absoluteBytes } from ${JSON.stringify(pathToFileURL(join(basePackage, 'client.mjs')).href)}
assert.equal(identity, 'NEW-HOST-USING-BASE-DEPENDENCY')
assert.equal(bytes, 'NEW-CLIENT')
assert.equal(absoluteBytes, 'NEW-CLIENT')
assert.match(import.meta.resolve('${packageName}/client'), /overlay-packages/)
assert.match(createRequire(import.meta.url).resolve('${packageName}/package.json'), /overlay-packages/)
assert.match(readFileSync(new URL(import.meta.resolve('${packageName}/client')), 'utf8'), /NEW-CLIENT/)
console.log('PASS: bare, subpath, require metadata, absolute URL, base dependency and new client bytes')
`)
const argumentsList = ['--import', pathToFileURL(join(runtime, 'runtime-resolver.mjs')).href, probe]
const result = spawnSync(process.execPath, argumentsList, {
  cwd: runtime, encoding: 'utf8', timeout: 20000, windowsHide: true,
  env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(join(install, 'resolver.mjs')).href}` },
})
assert.equal(result.status, 0, result.stderr)
process.stdout.write(result.stdout)
const reversed = spawnSync(process.execPath, ['--import', pathToFileURL(join(runtime, 'runtime-resolver.mjs')).href, '--import', pathToFileURL(join(install, 'resolver.mjs')).href, probe], {
  cwd: runtime, encoding: 'utf8', timeout: 20000, windowsHide: true,
  env: { ...process.env, NODE_OPTIONS: '' },
})
assert.equal(reversed.status, 0, reversed.stderr)
console.log('PASS: runtime-first / overlay-last import order')
assert.equal(readFileSync(join(basePackage, 'client.mjs'), 'utf8'), oldBytes)
put(join(overridePackage, 'package.json'), JSON.stringify({ name: packageName, type: 'module', exports: { '.': './index.mjs', './client': './missing.mjs' } }))
const rejected = spawnSync(process.execPath, argumentsList, {
  cwd: runtime, encoding: 'utf8', timeout: 20000, windowsHide: true,
  env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(join(install, 'resolver.mjs')).href}` },
})
assert.notEqual(rejected.status, 0)
assert.match(rejected.stderr, /missing.mjs|ERR_MODULE_NOT_FOUND/)
writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: true, checks: 9, runtimeExecuted: 'synthetic module fixture only', fixture: root }, null, 2))
console.log(`PASS: selected package failure cannot fall back to old client; base bytes retained. ${root}`)
