/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
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
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
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
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
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
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
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
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
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
