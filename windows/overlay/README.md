# DSH Overlay

English | [中文](README.zh.md)

Independent, per-user add-on for an existing DSH installation. This is neither Full nor Lite: it contains copies of the compiled enhanced Desktop/HUB/CONFIG applications, complete launcher assets and updated UI packages, but no Node, base Runtime, downloader, base-profile seeder, PATH registration or base uninstaller. Microsoft Edge WebView2 Runtime and Windows PowerShell 5.1 must already be available. The installer does not install them or launch applications on completion.

## Build and inspect

Run from the repository root in Windows PowerShell. All generated outputs stay in a fresh directory under `windows/overlay/artifacts`; no existing build is removed. Inno is found in `.tools/inno`, PATH or standard Inno Setup 6 locations; alternatively pass `-IsccPath`. The explicit launcher directory must contain the required EXEs/DLLs/catalogs and native Overlay binding support; it is never rebuilt or modified. Every file is copied recursively, including `enhancements.js`, `mobile/relay.mjs` and future assets; use a clean release directory without debug fixtures or private data. Linked files/directories are rejected before traversal.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/build.ps1 -LauncherDirectory 'D:\Builds\final-launcher' -OverlayPackagesDirectory 'D:\Builds\overlay-packages'
```

Both input paths must be absolute. `overlay-packages/node_modules/@deepseek-ai/` must contain complete `package.json` and built `lib`/assets for `dsh-client-ui-setup-hub`, `dsh-client-ui-settings-general`, `dsh-client-ui-sidebar` and `dsh-client-ui-workspace`, plus any new dependencies. Alternatively embed `overlay-packages` in launcher output and omit the separate argument. A build produces `DSH-Overlay-Setup-0.1.0.exe`, a compiler log, staged file hashes and `build-result.json`. This is an unsigned local engineering package, not a release-qualified or official Desktop distribution. Building does not execute Setup.

The same read-only plan used by Setup runs independently. It emits JSON and fails with a nonzero exit code on invalid input; it does not create directories, execute Node/CLI, read credentials or alter configuration/registry/environment. Paths may contain spaces, Unicode and `=`. Use explicit local absolute paths; UNC/device paths, drive roots and linked path ancestors are rejected.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/plan.ps1 -HostRoot 'D:\DSH' -RuntimeRoot 'D:\DSH\runtime' -NodePath 'D:\DSH\runtime\tools\node\node.exe' -DshHome 'D:\UserData\dsh' -StateRoot 'D:\UserData\overlay' -InstallRoot 'D:\Apps\DSH-Overlay'
```

Setup asks for these paths. For unattended use supply `/HOST=`, `/RUNTIME=`, `/NODE=`, `/DSHHOME=`, `/STATE=` and Inno's `/DIR=` (quote entire arguments containing spaces). Missing values fail preflight rather than selecting an ambient profile. Ready shows the write/retention scope. Validation occurs again immediately before installation. Only normal Inno per-user registration and the dedicated Start Menu `DSH enhanced Desktop (Overlay)`, `HUB (Overlay)` and `CONFIG (Overlay)` shortcuts are created. No original desktop/base shortcuts are replaced.

## Runtime and host support

Adapters use the compiled CLI priority already implemented by the legacy launcher: `node_modules/@deepseek-ai/dsh/lib/bin.js`, `lib/bin.js`, then `apps/cli/lib/bin.js`. The adjacent package must identify `@deepseek-ai/dsh`, version `0.1.3-alpha.2`, with `bin.dsh = lib/bin.js`. A packaged runtime marker requires its JSON and `runtime-resolver.mjs`. Node's Windows product metadata must report 22.19+ (22.x) or 24+. The plan records hashes of CLI, package, Node and resolver, observed host package/EXE metadata and the explicit home. It does not execute unknown code to discover compatibility.

Legacy compiled repository runtimes work without copying their dependencies. Source-only TS/tsx repositories, missing dependencies, a generic desktop EXE, arbitrary CLI versions and opaque Electron/ASAR internals are not treated as supported runtimes. A newer inspectable host may be explicitly selected with a separate supported legacy CLI runtime. Host metadata is evidence of selection, not a claim that HUB understands that host's managed profile or session formats. An explicit existing home is required, but its contents are not parsed or migrated. **Do not use component operations against a newer host's managed home until its owning adapter is qualified.** Actual dependency availability, Web UI readiness, plugin activation and historical session compatibility remain separate runtime acceptance gates.

To support another CLI version, add an explicit adapter with version/profile expectations and executable fixtures rather than widening the version check or guessing flags. To support another host's managed profile, implement its owning API and preservation tests first. There are no custom shell-command adapters.

## Frontend activation without base writes

`resolver.mjs` maps only the inventoried packages to the private `payload/overlay-packages/node_modules` directory. It redirects selected bare imports/subpaths, resolved base file URLs and declared repository paths, and resolves unchanged dependencies from the base runtime. The alpha.2 adapter also wraps Node's CommonJS `_resolveFilename` for `require.resolve` package metadata lookup, which synchronous ESM hooks alone do not redirect on the tested Node version. This is an explicit adapter-level dependency on Node internals, not a generic version compatibility claim. Missing selected package files fail instead of silently serving the old frontend.

Updated native launchers explicitly import this resolver after the base runtime resolver. The wrapper clears child-local `NODE_OPTIONS` to avoid ambient injection or duplicate early preload; it never edits the user environment. Native reapplication covers CONFIG's Explorer handoff and companion starts. No base `node_modules`, resolver, CLI, package metadata or profiles are patched. See `INTEGRATION.md` for the parent-owned launcher requirements and `tests/verify-activation.mjs` for actual HTTP bundle-byte verification on a copied Runtime and isolated home.

## Ownership and lifecycle

Install directory, Overlay state and base/home/runtime paths must not overlap. A nonempty install directory needs this Overlay's binding; a nonempty state directory needs its matching state marker. Setup writes `overlay-binding.json` only inside its own directory, through a normal Inno file entry. It never writes the state directory, base config, onboarding flags, language, profiles or sessions. The uninstaller uses only Inno's tracked files and shortcuts: no custom uninstall code, recursive deletion, process killing, Runtime removal, profile cleanup or user-data checkbox. Unknown files are not swept away. External Overlay state is always retained.

Update and repair reuse the stable Overlay AppId and directory. Re-enter the same explicit six paths (available in `overlay-binding.json`); changing the binding is refused. Same version means repair, higher version means update, lower version is refused. Payload replacement and uninstall are handled by normal Inno; close Overlay processes first. Base DSH may remain installed/running, but do not perform concurrent profile operations. Runtime changes are accepted only by a fresh inspection during repair/update. Existing state/configuration bytes are retained; this is not rollback of migrated data. A missing binding in a nonempty directory fails closed; recover it from backup, rather than adopting arbitrary files.

The shortcut wrapper verifies the runtime evidence and its payload hashes before launching. On first explicit launch, it creates only the separate Overlay state marker and minimal `config.json` with the selected RepoPath/NodePath and incomplete onboarding, using create-new writes. HUB/CONFIG shortcuts open CONFIG in HUB mode; the enhanced Desktop shortcut uses Desktop onboarding. Existing state is never reseeded. If retained CONFIG paths disagree, startup refuses with a recovery message rather than overwriting preferences or allowing launcher fallback. Runtime/home/data/scope are passed explicitly; environment overrides are process-local. HUB's default isolated Web Profile remains the existing launcher behavior. Subsequent explicit user actions inside Desktop/HUB/CONFIG can modify their configured data/home; installation safety is not a sandbox for those applications.

After uninstall, reinstall at the same paths reuses retained Overlay settings including its onboarding choice; it does not reset base onboarding. An empty, different state path gives a fresh CONFIG. Neither repair nor uninstall deletes state. For a deliberate rebind, uninstall Overlay, retain the old state, and install with a fresh state path; do not edit markers to bypass validation.

## Launcher integration requested from the owning contributor

No `MainApp`, `Config` or shared build/Setup file is changed here. The parent owns `OverlayBinding.cs`, bound runtime/node selection, home/data defaults, post-runtime resolver imports and process AppUserModelIDs. Build rejects older launchers missing the marker literal; this static check is not a substitute for native handoff tests. Companion Desktop actions target the enhanced owned copy, not the original host EXE. `INTEGRATION.md` records the actual marker and required handoffs. Newer official Desktop management remains unsupported without its own tested profile adapter.

## Isolated verification

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/tests/verify.ps1
node windows/overlay/tests/verify-resolver.mjs
node windows/overlay/tests/verify-activation.mjs --runtime 'D:\Builds\baseline-runtime' --stage 'D:\Builds\overlay-stage'
```

Plan tests use unique, retained D: fixtures under this folder, a compiled metadata-only Node stub that is **never executed**, minimal synthetic CLI layouts, and hash inventories. They invoke the production planner, state initializer and prepare entry point, not an installer. Resolver tests execute synthetic modules in both import orders. Activation tests copy the explicitly provided packaged Runtime and Overlay stage, boot only the copy with a scrubbed environment and isolated home, fetch actual served client bundles and compare complete bytes, then stop and await only their own Node process. They do not touch host installation, Shell Folders, registry, real profiles or the old Setup smoke. Static Inno ownership checks are not actual installer/uninstaller or UI acceptance. See `TESTING.md` for exact results and remaining qualification.
