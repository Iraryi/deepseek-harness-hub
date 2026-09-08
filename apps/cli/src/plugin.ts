/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the profile layer
 * list against the installed state. Packages declaring `dsh.bundle` become
 * profile layers; narrowly-qualified Web client-only packages receive
 * HUB-owned compatibility rows so their browser bundles can load without
 * being treated as server bundles. Other dependencies remain ordinary
 * dependencies.
 * @module @deepseek-ai/dsh/plugin
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

const GENERATED_CLIENT_COMPAT_START = '# dsh-hub: generated web-client compatibility:start'
const GENERATED_CLIENT_COMPAT_END = '# dsh-hub: generated web-client compatibility:end'

interface InstalledPackageManifest extends ProfileManifest {
  exports?: unknown
  dsh?: ProfileManifest['dsh'] & {
    client?: {
      platform?: unknown
    }
  }
}

interface WebClientCompatibility {
  packageName: string
  entryId: string
}

/** Resolve one installed package manifest from the same anchors as Loader. */
function installedPackage(
  packageName: string,
  profileDir: string,
): { dir: string; manifest: InstalledPackageManifest } | undefined {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return undefined
  }
  return {
    dir,
    manifest: readProfileManifest(NAME, dir) as InstalledPackageManifest,
  }
}

/** Read the common string form of `exports["./client"]`. */
function clientExportPath(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const client = (value as Record<string, unknown>)['./client']
  if (typeof client === 'string') return client
  if (typeof client !== 'object' || client === null) return undefined
  const fallback = (client as Record<string, unknown>).default
  return typeof fallback === 'string' ? fallback : undefined
}

/** Return a narrowly-scoped activation adapter for a Web client-only package. */
function webClientCompatibility(
  packageName: string,
  profileDir: string,
): WebClientCompatibility | undefined {
  const installed = installedPackage(packageName, profileDir)
  const client = installed?.manifest.dsh?.client
  if (installed === undefined || client?.platform !== 'web') return undefined
  const clientPath = clientExportPath(installed.manifest.exports)
  if (clientPath === undefined || !clientPath.startsWith('.')) return undefined
  const resolvedClientPath = resolve(installed.dir, clientPath)
  const relativeClientPath = relative(installed.dir, resolvedClientPath)
  if (isAbsolute(relativeClientPath) || relativeClientPath === '..' || relativeClientPath.startsWith(`..${sep}`)
    || !existsSync(resolvedClientPath) || !statSync(resolvedClientPath).isFile()) return undefined
  const digest = createHash('sha1').update(packageName).digest('hex').slice(0, 12)
  return { packageName, entryId: `dsh-compat-${digest}` }
}

/** Remove the generated compatibility section without touching user-authored rows. */
function stripGeneratedClientCompatibility(content: string): string {
  const escapedStart = GENERATED_CLIENT_COMPAT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = GENERATED_CLIENT_COMPAT_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`(?:^|\\r?\\n)${escapedStart}\\r?\\n[\\s\\S]*?${escapedEnd}(?:\\r?\\n|$)`)
  return content.replace(block, (_match, offset: number) => offset === 0 ? '' : '\n')
}

/** Whether the patch text already contains a top-level YAML sequence. */
function hasTopLevelPatchSequence(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return trimmed.startsWith('- ') || trimmed === '[]' || trimmed.startsWith('[')
  })
}

/** Render the generated rows separately so reconciliation can replace them atomically. */
function renderGeneratedClientCompatibility(entries: readonly WebClientCompatibility[]): string {
  return [
    GENERATED_CLIENT_COMPAT_START,
    '- insert:',
    ...entries.flatMap(entry => [
      `    - id: ${entry.entryId}`,
      `      name: ${JSON.stringify(entry.packageName)}`,
    ]),
    GENERATED_CLIENT_COMPAT_END,
    '',
  ].join('\n')
}

/** Update only the HUB-owned Web client rows in a profile patch file. */
function reconcileGeneratedClientCompatibility(
  profileDir: string,
  entries: readonly WebClientCompatibility[],
): boolean {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const before = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
  let base = stripGeneratedClientCompatibility(before)
  if (entries.length === 0) {
    if (!hasTopLevelPatchSequence(base)) base = `${base.trimEnd()}\n[]\n`
  } else {
    const generated = renderGeneratedClientCompatibility(entries)
    const emptyRoot = /^\s*\[\]\s*$/m
    if (emptyRoot.test(base)) base = base.replace(emptyRoot, generated.trimEnd())
    else base = `${base.trimEnd()}${base.trim().length === 0 ? '' : '\n'}${generated}`
  }
  if (base === before) return false
  writeFileSync(patchPath, base)
  return true
}

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares a profile patch.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  return installedPackage(packageName, profileDir)?.manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order). A Web
 * client-only package with a valid `exports["./client"]` file receives a
 * generated compatibility row in `cordis.patch.yml`; other bundle-less
 * dependencies remain ordinary dependencies. Dependency-listed names that no
 * longer resolve to their supported activation form are removed. In-box
 * bundles from the profile template are not dependencies and are never
 * touched.
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  const compatibility = new Map<string, WebClientCompatibility>()
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle) {
      const clientAdapter = webClientCompatibility(packageName, profileDir)
      if (clientAdapter !== undefined) compatibility.set(packageName, clientAdapter)
      else if (!beforeDeps.has(packageName)) {
        process.stderr.write(
          `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
          + '(a later update that gains one activates it automatically)\n',
        )
      }
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (changed) {
    after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
    writeProfileManifest(profileDir, after)
  }
  reconcileGeneratedClientCompatibility(profileDir, [...compatibility.values()])
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}

/** Bundled npm files used by Setup package installation. */
export interface SetupPackageManager {
  /** Node executable that owns the npm distribution. */
  readonly node: string
  /** npm CLI JavaScript entry invoked through {@link node}. */
  readonly cli: string
}

/**
 * Resolve npm from the Node distribution that is running dsh. The Windows
 * desktop runtime carries this directory beside its private node.exe, so a
 * Setup never falls through to npm or pnpm on PATH.
 * @param nodeExecutable - Node executable whose bundled npm must be used.
 * @returns the private Node and npm CLI paths.
 */
export function resolveSetupPackageManager(nodeExecutable: string = process.execPath): SetupPackageManager {
  const node = resolve(nodeExecutable)
  const nodeDirectory = dirname(node)
  const candidates = [
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(nodeDirectory), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const cli = candidates.find(candidate => existsSync(candidate))
  if (cli === undefined) {
    throw new Error(`bundled npm is missing beside ${node}; repair or reinstall the DSH runtime`)
  }
  return { node, cli }
}

/**
 * Install one Setup package with the private npm carried by the running Node
 * distribution, then reconcile its bundle declaration into the profile.
 * Lifecycle scripts are denied unless the Setup manifest declares the
 * `install-scripts` permission.
 * @param profile - profile receiving the package.
 * @param packageSpec - registry, HTTPS, git, archive, or filesystem npm spec.
 * @param allowInstallScripts - whether npm lifecycle scripts may execute.
 * @param nodeExecutable - Node executable whose bundled npm performs the install.
 * @returns the npm exit code.
 */
export function installSetupPackage(
  profile: string,
  packageSpec: string,
  allowInstallScripts: boolean,
  nodeExecutable: string = process.execPath,
): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  const manager = resolveSetupPackageManager(nodeExecutable)
  const args = [
    manager.cli,
    'install',
    '--save-exact',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    ...(allowInstallScripts ? [] : ['--ignore-scripts']),
    '--',
    anchorPathSpec(packageSpec, process.cwd()),
  ]
  const result = spawnSync(manager.node, args, {
    cwd: dir,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  })
  if (result.error !== undefined) throw result.error
  const exitCode = result.status ?? 1
  if (exitCode === 0) reconcilePlugins(before, dir)
  else process.stderr.write(`${NAME}: bundled npm failed in profile directory ${dir}\n`)
  return exitCode
}

/**
 * Enable an installation-owned bundle without asking pnpm to download the
 * package that already ships inside the DSH runtime.
 * @param profile - profile receiving the bundle layer.
 * @param packageName - in-box bundle package name.
 * @returns zero on success.
 */
export function enableInBoxBundle(profile: string, packageName: string): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const bundleDir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, dir)
  const bundleManifest = readProfileManifest(NAME, bundleDir)
  if (bundleManifest.dsh?.bundle?.patch === undefined) {
    throw new Error(`${NAME}: ${packageName} is not an installable dsh.bundle`)
  }
  const manifest = readProfileManifest(NAME, dir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(packageName)) return 0
  bundles.push(packageName)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  writeProfileManifest(dir, manifest)
  return 0
}
