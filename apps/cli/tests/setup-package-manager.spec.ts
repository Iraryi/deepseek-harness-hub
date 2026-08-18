import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))

vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSetupPackage, resolveSetupPackageManager } from '../src/plugin.ts'

let directory: string | undefined

beforeEach(() => {
  spawnSyncMock.mockReset()
  spawnSyncMock.mockReturnValue({ status: 0 })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function fakeNodeDistribution(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-setup-npm-'))
  const node = join(directory, 'tools', 'node', 'node.exe')
  const cli = join(directory, 'tools', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await mkdir(join(directory, 'home'), { recursive: true })
  await mkdir(join(directory, 'tools', 'node', 'node_modules', 'npm', 'bin'), { recursive: true })
  await writeFile(node, '')
  await writeFile(cli, '')
  vi.stubEnv('DSH_HOME', join(directory, 'home'))
  return node
}

describe('Setup package manager', () => {
  it('resolves npm only from the Node distribution', async () => {
    const node = await fakeNodeDistribution()
    expect(resolveSetupPackageManager(node)).toEqual({
      node,
      cli: join(directory!, 'tools', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    })
  })

  it('installs without pnpm or a shell and denies lifecycle scripts by default', async () => {
    const node = await fakeNodeDistribution()
    expect(installSetupPackage('web', 'https://example.com/plugin.tgz', false, node)).toBe(0)
    expect(spawnSyncMock).toHaveBeenCalledOnce()
    const call = spawnSyncMock.mock.calls[0] as unknown as readonly [string, readonly string[], Record<string, unknown>]
    const [command, args, options] = call
    expect(command).toBe(node)
    expect(args).toEqual(expect.arrayContaining([
      join(directory!, 'tools', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      'install',
      '--save-exact',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--',
      'https://example.com/plugin.tgz',
    ]))
    expect(args).not.toContain('pnpm')
    expect(options).toMatchObject({ shell: false })
  })

  it('allows lifecycle scripts only for a declared Setup permission', async () => {
    const node = await fakeNodeDistribution()
    expect(installSetupPackage('web', 'https://example.com/plugin.tgz', true, node)).toBe(0)
    const args = spawnSyncMock.mock.calls[0]![1] as string[]
    expect(args).not.toContain('--ignore-scripts')
  })
})
