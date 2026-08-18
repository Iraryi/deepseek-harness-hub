import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync, globSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const runtimeDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(runtimeDir, '..', '..')
const distRoot = resolve(runtimeDir, 'dist')
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const outOption = option('--out') ?? join(distRoot, 'runtime')
const archiveOption = option('--archive') ?? join(distRoot, 'DeepSeek-Harness-Runtime-win-x64.zip')
const nodeOption = option('--node') ?? process.execPath
const output = resolve(outOption)
const archive = resolve(archiveOption)
const workspaceDevelopmentSentinel = join(root, 'packages', 'client', 'ui-setup-hub', 'node_modules', 'react', 'jsx-runtime.js')
const hadWorkspaceDevelopmentSentinel = existsSync(workspaceDevelopmentSentinel)

assertInside(distRoot, output, 'runtime output')
assertInside(distRoot, archive, 'runtime archive')

run(process.execPath, [join(runtimeDir, 'generate-manifest.mjs'), '--check'])
run(process.execPath, ['--import', 'tsx/esm', join(root, 'scripts', 'verify-runtime-closure.ts'), '--manifest', join(runtimeDir, 'package.json')])
if (!skipBuild) run(pnpm(), ['run', 'build'], root)

await rm(output, { recursive: true, force: true })
await mkdir(dirname(output), { recursive: true })
run(pnpm(), [
  '--filter', '@deepseek-ai/dsh-windows-runtime', 'deploy', '--prod',
  '--config.inject-workspace-packages=true', '--config.node-linker=hoisted',
  '--ignore-scripts', output,
], root)
if (hadWorkspaceDevelopmentSentinel && !existsSync(workspaceDevelopmentSentinel)) {
  throw new Error('pnpm deploy modified the source workspace dependency installation')
}

await pruneDeployRoot(output)
await restoreMissingDirectPackages(output)
await materializeLinks(join(output, 'node_modules'))
await stageNode(output, nodeOption)
await stagePnpm(output)
await cp(join(runtimeDir, 'runtime-resolver.mjs'), join(output, 'runtime-resolver.mjs'))

const repositoryManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await writeFile(join(output, 'runtime-manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  product: 'DeepSeek Harness Windows Runtime',
  version: repositoryManifest.version,
  platform: 'win-x64',
  entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
  node: 'tools/node/node.exe',
  packageManager: {
    name: 'npm',
    command: 'tools/node/npm.cmd',
    cli: 'tools/node/node_modules/npm/bin/npm-cli.js',
    pnpmCommand: 'tools/pnpm/pnpm.cmd',
    pnpmCli: 'tools/pnpm/node_modules/pnpm/bin/pnpm.mjs',
  },
  resolver: 'runtime-resolver.mjs',
  minimumNode: '22.19.0',
  plugins: 'dsh plugin --profile <name> add <package-or-git-spec>',
  setups: 'dsh setup install <manifest.json>',
}, null, 2)}\n`)

await rm(archive, { force: true })
await mkdir(dirname(archive), { recursive: true })
run('tar.exe', ['-a', '-c', '-f', archive, '-C', output, '.'])

const remaining = await findLink(output)
if (remaining !== undefined) throw new Error(`runtime still contains a link: ${remaining}`)
console.log(`windows runtime: staged ${output}`)
console.log(`windows runtime: archived ${archive}`)

function option(name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function assertInside(parent, child, label) {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`
  if (child !== parent && !child.startsWith(normalizedParent)) {
    throw new Error(`${label} must stay under ${parent}: ${child}`)
  }
}

function pnpm() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function run(command, commandArgs, cwd = root) {
  const shell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}`)
}

async function pruneDeployRoot(staging) {
  const kept = new Set(['node_modules', 'package.json'])
  for (const entry of await readdir(staging, { withFileTypes: true })) {
    if (kept.has(entry.name)) continue
    await rm(join(staging, entry.name), { recursive: true, force: true })
  }
}

async function restoreMissingDirectPackages(staging) {
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  const workspace = new Map()
  for (const relativePath of globSync([
    'apps/*/package.json',
    'packages/*/*/package.json',
    'vendor/*/package.json',
    'native/landlock-run/package.json',
    'native/landlock-run/packages/*/package.json',
  ], { cwd: root })) {
    const path = join(root, relativePath)
    const packageManifest = JSON.parse(await readFile(path, 'utf8'))
    if (packageManifest.name !== undefined) workspace.set(packageManifest.name, dirname(path))
  }

  const restored = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = workspace.get(dependency)
    if (source === undefined) throw new Error(`missing deployed dependency has no workspace source: ${dependency}`)
    await mkdir(dirname(destination), { recursive: true })
    await copyPackageWithoutNodeModules(source, destination)
    restored.push(dependency)
  }
  if (restored.length > 0) console.log(`windows runtime: restored ${restored.join(', ')}`)
}

async function copyPackageWithoutNodeModules(source, destination) {
  const nestedNodeModules = join(source, 'node_modules')
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
  })
}

async function materializeLinks(nodeModules) {
  const links = []
  await collectLinks(nodeModules, links)
  for (const link of links) {
    if (!existsSync(link) || !(await lstat(link)).isSymbolicLink()) continue
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const source = await realpath(link)
      await rm(link, { recursive: true, force: true })
      await copyPackageWithoutNodeModules(source, link)
    }
  }
}

async function collectLinks(directory, links) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) links.push(path)
    else if (metadata.isDirectory()) await collectLinks(path, links)
  }
}

async function findLink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findLink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function stageNode(staging, nodeSource) {
  const source = resolve(nodeSource)
  if (!existsSync(source)) throw new Error(`node source does not exist: ${source}`)
  const destination = join(staging, 'tools', 'node')
  await mkdir(destination, { recursive: true })
  const sourceIsDirectory = (await lstat(source)).isDirectory()
  if (sourceIsDirectory) {
    await cp(source, destination, { recursive: true, dereference: true })
  } else {
    await cp(source, join(destination, 'node.exe'))
  }
  if (!existsSync(join(destination, 'node.exe'))) throw new Error('staged Node runtime has no node.exe')

  const sourceDirectory = sourceIsDirectory ? source : dirname(source)
  const npmDirectory = join(sourceDirectory, 'node_modules', 'npm')
  const npmCommand = join(sourceDirectory, 'npm.cmd')
  if (!existsSync(npmDirectory) || !existsSync(npmCommand)) {
    throw new Error(`Node distribution has no bundled npm: ${sourceDirectory}`)
  }
  const stagedNpmDirectory = join(destination, 'node_modules', 'npm')
  if (!existsSync(stagedNpmDirectory)) {
    await mkdir(dirname(stagedNpmDirectory), { recursive: true })
    await cp(npmDirectory, stagedNpmDirectory, { recursive: true, dereference: true })
  }
  for (const launcher of ['npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1']) {
    const launcherSource = join(sourceDirectory, launcher)
    const launcherDestination = join(destination, launcher)
    if (existsSync(launcherSource) && !existsSync(launcherDestination)) await cp(launcherSource, launcherDestination)
  }
  if (!existsSync(join(destination, 'npm.cmd'))) throw new Error('staged Node runtime has no npm.cmd')
  if (!existsSync(join(stagedNpmDirectory, 'bin', 'npm-cli.js'))) throw new Error('staged Node runtime has no npm CLI')
}

async function stagePnpm(staging) {
  const commandCandidates = []
  if (process.env.APPDATA !== undefined) commandCandidates.push(join(process.env.APPDATA, 'npm', 'pnpm.cmd'))
  const where = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8', windowsHide: true })
  if (where.status === 0) {
    for (const line of String(where.stdout).split(/\r?\n/)) {
      if (line.trim().length > 0) commandCandidates.push(line.trim())
    }
  }

  let packageDirectory
  for (const commandPath of commandCandidates) {
    const candidate = resolve(commandPath)
    const directory = join(dirname(candidate), 'node_modules', 'pnpm')
    if (existsSync(join(directory, 'bin', 'pnpm.mjs'))) {
      packageDirectory = directory
      break
    }
  }
  if (packageDirectory === undefined) throw new Error('pnpm package was not found; install pnpm before building the Windows Runtime')

  const destination = join(staging, 'tools', 'pnpm')
  await mkdir(join(destination, 'node_modules'), { recursive: true })
  await cp(packageDirectory, join(destination, 'node_modules', 'pnpm'), { recursive: true, dereference: true })
  await writeFile(join(destination, 'pnpm.cmd'), '@echo off\r\nsetlocal\r\n"%~dp0..\\node\\node.exe" "%~dp0node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n')
  await writeFile(join(destination, 'pnpm.ps1'), '& "$PSScriptRoot\\..\\node\\node.exe" "$PSScriptRoot\\node_modules\\pnpm\\bin\\pnpm.mjs" @args\r\n')
  if (!existsSync(join(destination, 'pnpm.cmd')) || !existsSync(join(destination, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))) {
    throw new Error('staged pnpm payload is incomplete')
  }
}
