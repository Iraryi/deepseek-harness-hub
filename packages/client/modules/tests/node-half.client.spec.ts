/** Node-half composition diagnostics for package metadata and built client bundles. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ClientModuleRegistry } from '../src/index.ts'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable package whose client export points at the returned path. */
function writePackage(
  packageName: string,
  metadata: Record<string, unknown> = { dsh: { client: { platform: 'web' } } },
): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    ...metadata,
  }))
  return clientPath
}

/** Construct the node-half service and capture its plugin-bundle route plus index transform. */
function constructWithRoute(packageNames: string[]): {
  service: ClientModuleRegistry
  route: WebRoute
  transformIndex: (html: string) => string | Promise<string>
} {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield { options: { name: packageName }, fiber: {}, disabled: false }
      }
    },
    async await() {},
  })
  let route: WebRoute | undefined
  let transformIndex: ((html: string) => string | Promise<string>) | undefined
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: (transform) => {
      transformIndex = transform
      return () => {}
    },
  }
  ctx.provide('webServer', webServer as WebServer)
  const service = new ClientModuleRegistry(ctx)
  if (route === undefined) throw new Error('client bundle route was not registered')
  if (transformIndex === undefined) throw new Error('client boot-manifest transform was not registered')
  return { service, route, transformIndex }
}

/** Construct the node-half service over the enabled fixture entries. */
function construct(packageNames: string[]): ClientModuleRegistry {
  return constructWithRoute(packageNames).service
}

describe('client bundle activation', () => {
  it('discovers a client entry created by a later sibling plugin', async () => {
    const packageName = '@fixture/late-sibling'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')

    const entries: Array<{ options: { name: string }; fiber: {}; disabled: boolean }> = []
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(root!).href + '/'
    ctx.provide('loader', {
      *entries() {
        yield* entries
      },
    })
    const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
      port: 0,
      register: () => () => {},
      tapIndex: () => () => {},
    }
    ctx.provide('webServer', webServer as WebServer)
    await ctx.plugin(ClientModuleRegistry)
    const service = ctx.get('clientModules')
    expect(service?.graph().entries).toEqual([])

    await ctx.plugin((siblingCtx) => {
      const entry = { options: { name: packageName }, fiber: {}, disabled: false }
      entries.push(entry)
      siblingCtx.emit('internal/plugin', { entry } as Fiber)
    })
    await Promise.resolve()

    expect(service?.graph().entries.map(entry => entry.id)).toEqual([packageName])
    await ctx.fiber.dispose()
  })

  it('allows sibling dsh roles', () => {
    const currentName = '@fixture/current-client-field'
    const clientPath = writePackage(currentName, {
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    })
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    expect(construct([currentName]).graph().entries.map(entry => entry.id)).toEqual([currentName])
  })

  it('retries a package resolution miss before serving the boot manifest', async () => {
    const packageName = '@fixture/healed-fallback'
    root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
    const { service, transformIndex } = constructWithRoute([packageName])
    expect(service.graph().entries).toEqual([])

    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')

    const html = await transformIndex('<html><head></head></html>')
    expect(service.graph().entries.map(entry => entry.id)).toEqual([packageName])
    expect(html).toContain(packageName)
  })

  it('waits for Loader settlement before serving the first boot manifest', async () => {
    const packageName = '@fixture/settled-first-index'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')

    const entries: Array<{ options: { name: string }; fiber: {}; disabled: boolean }> = []
    let settleLoader!: () => void
    const loaderSettlement = new Promise<void>((resolve) => { settleLoader = resolve })
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(root!).href + '/'
    ctx.provide('loader', {
      *entries() {
        yield* entries
      },
      await() {
        return loaderSettlement
      },
    })
    let transformIndex: ((html: string) => string | Promise<string>) | undefined
    const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
      port: 0,
      register: () => () => {},
      tapIndex: (transform) => {
        transformIndex = transform
        return () => {}
      },
    }
    ctx.provide('webServer', webServer as WebServer)
    const service = new ClientModuleRegistry(ctx)
    if (transformIndex === undefined) throw new Error('client boot-manifest transform was not registered')

    let rendered = false
    const firstIndex = Promise.resolve(transformIndex('<html><head></head></html>')).then((html) => {
      rendered = true
      return html
    })
    await Promise.resolve()
    expect(rendered).toBe(false)

    entries.push({ options: { name: packageName }, fiber: {}, disabled: false })
    settleLoader()
    const html = await firstIndex

    expect(service.graph().entries.map(entry => entry.id)).toEqual([packageName])
    expect(html).toContain(packageName)
  })

  it('groups missing bundles under one source-build instruction with a package/path list', () => {
    const firstName = '@fixture/missing-first'
    const secondName = '@fixture/missing-second'
    const firstPath = writePackage(firstName)
    const secondPath = writePackage(secondName)
    expect(() => construct([firstName, secondName])).toThrow([
      'client-modules: 2 client packages failed to compose:',
      '  client bundles not found; run `pnpm run build` before launch:',
      `    - package: ${firstName}`,
      `      path: ${firstPath}`,
      `    - package: ${secondName}`,
      `      path: ${secondPath}`,
    ].join('\n'))
  })

  it('does not report other bundle read failures as missing builds', () => {
    const packageName = '@fixture/unreadable-client'
    const clientPath = writePackage(packageName)
    mkdirSync(clientPath, { recursive: true })
    let thrown: unknown
    try {
      construct([packageName])
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain('client-modules: 1 client package failed to compose:')
    expect(String(thrown)).toContain('  other failures:')
    expect(String(thrown)).toContain('EISDIR')
    expect(String(thrown)).not.toContain('pnpm run build')
  })

  it('serves the source map beside a registered client bundle', async () => {
    const packageName = '@fixture/source-map'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    const map = '{"version":3,"sources":["src/client/index.tsx"]}\n'
    writeFileSync(`${clientPath}.map`, map)
    const { route } = constructWithRoute([packageName])
    let status = 0
    let headers: Record<string, string> | undefined
    let body = ''
    const response = {
      writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
        status = nextStatus
        headers = nextHeaders
        return response
      },
      end(chunk?: Uint8Array) {
        body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8')
        return response
      },
    } as unknown as ServerResponse

    await route.handler({
      method: 'GET',
      url: `/plugins/${packageName}/client.js.map`,
    } as IncomingMessage, response)

    expect(status).toBe(200)
    expect(headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    })
    expect(body).toBe(map)
  })
})
