# Desktop, Setup, and DSH HUB execution state

This file is the mandatory operational ledger for work governed by [HUB_REQUIREMENTS.md](HUB_REQUIREMENTS.md). It does not replace that requirements file or relax any acceptance criterion. Every agent must read both files before touching the affected surfaces, update this ledger when a checkpoint changes, and verify claims from commands or artifacts instead of relying on conversation memory.

## Standing execution rules

- Continue autonomously through implementation, self-review, focused tests, production builds, native smoke tests, visual inspection, and installed-path validation when the product owner is away.
- Preserve work across context compaction by recording completed checkpoints, active defects, next commands, and durable evidence here before moving to a new phase.
- Use multiple independent checks for every user-visible change. A typecheck or unit test alone is not enough for native window, WebView, installation, process-lifecycle, or high-DPI behavior.
- Do not build or publish the standalone Setup EXE during ordinary HUB and UI iteration. A Runtime or Launcher development build is allowed. Build Setup only at an intentional release checkpoint or after an explicit product-owner request.
- Do not delete or overwrite user installations, profiles, caches, or credentials during validation. Use isolated data roots and preserve rollback copies when testing an installed directory.
- If a network path fails, use the bundled snapshot, cache, alternate official endpoint, or local artifact path and continue. No catalog or installation operation may remain busy indefinitely.

## Current checkpoint

Status date: 2026-08-17

This checkpoint is active. A clean virtual-machine installation exposed release-blocking regressions that prior development-profile and large-window checks did not cover. Work continues until the clean-install VM regression gate in `HUB_REQUIREMENTS.md` passes and a new local Full/Lite Setup pair is built. GitHub upload is not authorized during this checkpoint.

## Active clean-install VM regression checkpoint

- Reproduce and eliminate startup tearing and stale fixed-size surfaces at `1024x768` in normal, bordered maximized, and borderless modes. Exclusive fullscreen is a control case, not the only accepted mode. The development machine also reproduces bordered-mode tearing.
- Repair uninstall-then-reinstall onboarding so a newly installed application opens CONFIG before Desktop even when user data or a prior completion flag survives uninstall. Prevent the contradictory Desktop startup that stalls at boot stage 5 and ends with `Start failed: Access denied`.
- Verify that Full Setup contains the current bundled DSHMK snapshot, Setup manifests, launcher source adapters, Web client, and internal package-management implementation. A clean machine must not require the maintainer's existing profile, cache, `plugin-store`, or system package managers to obtain correct catalog details and Setup eligibility.
- Repair constrained-window action controls so `Local build required` and `One-click Setup` remain fully visible and clickable in catalog cards and reconstructed details at `1024x768`.
- Add owned per-user command registration for `dsh`, `dsh-hub`, and `dsh-config`; bundle every package-management tool used by installed Setup flows, including pnpm when invoked; verify clean uninstall of only the owned command path.
- Replace CONFIG's reused Desktop icon with the gear variant across EXE resources, shortcuts, taskbar, window, and tray surfaces.
- Normalize and localize native and WebView context-menu terminology to `DSH`, `HUB`, and `CONFIG`, with language-selected verbs in Desktop, HUB, and CONFIG processes.
- Preserve the existing uncommitted resilient WebView2 vendor-download change in `windows/release/build.ps1`. Do not reset or clean the working tree, generated evidence, or prior release outputs while implementing this checkpoint.
- Required final evidence: focused tests, production Web and Launcher builds, clean isolated Runtime, empty-data first launch, uninstall/reinstall first launch, DSHMK online and bundled-cache paths, low-resolution screenshots for four window modes, command/PATH checks, icon and localization checks, installed-directory smokes, and one final local release build. Do not upload assets or commits until explicitly authorized.

## Setup release checkpoint

- The product owner explicitly requested a standalone Setup build, authorizing this release checkpoint under the standing Setup rule.
- `windows/release/build.ps1` completed successfully with Launcher, Web, Runtime, Full Setup, Lite Setup, portable archive, manifest, checksums, installation smoke, upgrade smoke, real WebView application smoke, process-job smoke, uninstall smoke, and portable HTTP smoke enabled.
- Full Setup: `windows/release/dist-hub-release/DeepSeek-Harness-Setup-Full-0.1.0-rc.5-win-x64.exe`, 332,921,731 bytes, SHA-256 `c56fb7312b03acf12b46b0d3189aa2b32c51024b7c59bffbf443502fbf5bdf87`.
- Lite Setup: `windows/release/dist-hub-release/DeepSeek-Harness-Setup-Lite-0.1.0-rc.5-win-x64.exe`, 4,208,718 bytes, SHA-256 `c2e44ed04e0fbb17b67e1d7d1507cf552abd15488af0d79df7409d1ac4e36f53`.
- `release-manifest.json` contains six assets and matches every asset's byte count and SHA-256. `SHA256SUMS.txt` was regenerated by the same release build.
- Release smoke cleanup left zero `smoke-install-*` directories, zero `portable-smoke-*` directories, and zero owned Desktop, HUB, CONFIG, or Node.js processes.
- The generated Setup EXEs are not Authenticode-signed because no code-signing certificate is configured. The embedded WebView2 installers retain their Microsoft signatures.
- The release runtime SHA-256 is `8aea7974f334f2ed35ee0f5d97bf8cee0ed6774811440055db7fea8a225ad854`; the Portable ZIP SHA-256 is `f2526fd2f6a6030c04cbab78274adf2f5aa8e36c1a7828d03f34be68cf2ff06d`.
- The installed WebView smoke initially exposed a test-only ordering race: structured boot confirmation was logged a few milliseconds before `Page loaded`. `windows/setup/smoke.ps1` now waits for both signals, and the full release chain passes.

## HUB repository checkpoint

- New public repository: `Iraryi/deepseek-harness-hub`.
- The HUB repository contains bilingual product documentation, architecture, Setup Registry v1 schema and catalog, package authoring example, MIT license, support/security/contribution policies, issue forms, CODEOWNERS, validation workflow, and release model.
- Runtime download URLs and the release manifest now point to HUB Releases. `deepseek-harness-desktop` remains the Windows implementation/distribution source repository and is no longer presented as the whole ecosystem.

## Retained-profile startup recovery checkpoint

- The reported stuck whale screen was captured at `[BOOT 05/05] Activating Web UI plugins` immediately after installing a new Runtime over preserved user data.
- The installed `config.json` had `FirstRunCompleted: true`, so Setup correctly preserved the existing configuration and `dsh.exe` did not open CONFIG. Skipping CONFIG exposed the main window immediately but did not cause the plugin activation failure.
- The actual installed launcher log showed the host service and page load succeed, followed by a structured Web UI failure: retained `dshmarket` and `@deepseek-ai/dsh-client-app-shell` entries remained pending while waiting for base client services. Closing and reopening the application restarted the owned Node service, after which the same profile reached ready normally.
- The launcher now keeps the existing one-time fresh-navigation retry for pending-only failures. If that navigation has no terminal result after 20 seconds, it restarts its owned Node service once, preserves the recovery count across that restart, generates a new navigation token, and makes any later failure terminal instead of looping.
- The initial navigation still has a 45-second structured-status limit and may use the same single service recovery. Import and activation failures remain terminal and do not trigger this recovery path.
- Desktop and HUB fast-retry smokes pass without restarting their services. The retained-plugin recovery smoke passed three consecutive runs with exactly one navigation retry, one Node-service restart, and a final ready status in each run.
- A separate isolated application assembled from the latest Runtime and Launcher used a copy of the real `dshmarket` 1.10.1 web profile and completed three real WebView startup and cleanup runs with zero remaining application-directory processes.
- The product owner's currently running installation was inspected read-only and was not stopped or overwritten. The fix exists in `windows/launcher/dist-webui-recovery-dev` and will enter the next intentional Setup release build.

## DSHMK packaged installation checkpoint

- The reported `DSH-better-sidebar` failure was not an administrator-permission failure. The installed Runtime contains private Node.js and npm but no global `pnpm`; the DSHMK path invoked `dsh plugin`, which opened `cmd.exe`, failed to find `pnpm`, and emitted a Chinese OEM-code-page diagnostic that the launcher decoded as UTF-8.
- DSHMK installation now resolves npm names and tags to an exact versioned tarball or retains the validated GitHub commit, downloads the asset through the existing allowlist and size limits, records its SHA-256, and passes a complete Setup manifest to the packaged Setup CLI and private npm. It no longer invokes `dsh plugin`, system `pnpm`, or `cmd.exe`.
- Routine profile installation remains unelevated because its target is the current user's `$DSH_HOME`. A real path or ACL failure remains an explicit permission error; the launcher does not request UAC merely because a development tool is absent.
- The new focused smoke installs and reinstalls repository `1326893710` (`DSH-better-sidebar`) in an isolated `DSH_HOME`, verifies `dsh-better-sidebar` in dependencies and Bundle layers, confirms one installed record, validates the cached SHA-256 artifact, and rejects legacy `pnpm` output or Unicode replacement characters. Both installation attempts completed with status `activated` against the repository-built Runtime and again against the product owner's existing `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness\runtime` without modifying its installed files or real profile.
- Headless HUB data mode now skips absent status and button controls while retaining file logging, so native data smokes exercise the production installation state machine without creating WebView2 or visible windows.
- The fix exists in `windows/launcher/dist-dshmk-internal-npm-dev` and will enter the next intentional Setup release build.

## DSHMK detail-entry and installed-path checkpoint

- DSHMK catalog refresh is an icon-only square control with an accessible label and tooltip, so narrow toolbars do not wrap the reload text.
- DSHMK cards expose a dedicated `Project details` button beside one-click Setup by default. `HubConfig.DetailEntry` accepts `button` or `card`; CONFIG defaults to the recommended button entry and can restore whole-card activation without changing the side, modal, full-surface, or original-content presentation choice.
- The focused HUB component suite passes 12 of 12 tests, including default button entry, restored whole-card entry, icon-only refresh, page and scroll restoration, and installation-state reset.
- Launcher and Web frontend development builds completed, and the installed Runtime's dynamically loaded `@deepseek-ai/dsh-client-ui-setup-hub/lib/client.js` was rebuilt and synchronized in addition to the frontend `dist`. Updating only `@deepseek-ai/dsh-web-frontend/dist` does not update this runtime-loaded client plugin.
- `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness` was copied to `artifacts/installed-detail-entry-backup-20260816-ac832be0ce53/app` before deployment; the backup contains 102,102 files and 1,098,177,953 bytes and has a deployment descriptor with installed hashes.
- The real installed directory installs and reinstalls `DSH-better-sidebar`, activates its Bundle, records SHA-256 `8d9dd6abd7cf5f01965856bf2bdd2a2ec0cc03535f158335391e31f74231381a`, emits no legacy pnpm output, and emits no Unicode replacement characters.
- The real installed HUB completed first-run CONFIG verification plus two WebView startup and cleanup runs with zero remaining installed-directory processes. Installed-path screenshots show the dedicated details buttons without clipping and the CONFIG `详情入口` selector with `独立详情按钮（推荐）` selected.
- Installed-path visual evidence is stored at `../outputs/installed-detail-entry-proof-20260817/installed-hub-toolbar.png`, `../outputs/installed-detail-entry-proof-20260817/installed-hub-detail-actions.png`, and `../outputs/installed-detail-entry-proof-20260817/installed-config-detail-entry.png`; the validated dark detail modal is at `../outputs/hub-detail-entry-validated-20260817/hub-dark-modal.png`.
- Successful capture data and the PowerShell 7 reflection-failure directory were removed after validation. The installation directory retains one matching Web frontend rollback and one matching Setup HUB client rollback under `dev-backups`, in addition to the complete repository-local backup.

## Component management, filtering, and HUB isolation checkpoint

- Desktop's DSH HUB settings tab renders installed components, prepared Setup workspaces, offline packages, uninstall actions, and AI-editing paths instead of embedding another discovery market.
- HUB installation completion persists a prominent Desktop restart action. The UI-to-native bridge smoke replaced Desktop's owned Node process, preserved HTTP 200 on the configured port, and kept both the HUB host and HUB Node service running.
- Static Download, installed, success, and disabled-state icons remain still. Only controls with `data-busy=true` animate.
- DSHMK search keeps sorting visible and moves search scope, dynamic TAG/category, project type, validation/installability, local-build-only, and page-size controls into one rounded layered filter surface.
- Catalog candidate selection ranks generation time, repository count, and one-click-install coverage. A stale one-entry cache loses to the bundled 2,888-entry snapshot, and a degraded refresh cannot overwrite a healthier cache or bundle.
- HUB child services use `%LOCALAPPDATA%\DeepSeekHarness\hub\runtime-home` by default. The profile-isolation smoke proved that the Desktop profile stays untouched by default and is used only when `HubConfig.AllowDesktopPlugins` is explicitly enabled.
- PowerShell reflection smokes relaunch under Windows PowerShell when invoked from PowerShell Core, matching the .NET Framework Launcher runtime and avoiding the recursive assembly-resource resolver stack overflow.
- The focused component suite passes 12 of 12 tests, including component management, grouped filters, persistent restart state, failure reset, details entry, and page/scroll restoration. The package typecheck, production client bundle, Web frontend build, and Launcher development build pass.
- The installed directory passed two Desktop and two HUB WebView readiness runs with zero remaining installed processes. Installed Runtime DSHMK install and reinstall both reached `activated` for `dsh-better-sidebar`, used private npm, preserved the fixed artifact hash, emitted no replacement characters, and did not invoke legacy pnpm.
- `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness` was backed up at `artifacts/installed-component-manager-backup-20260817-100229` before Launcher, Web frontend, and dynamically loaded Setup HUB client files were synchronized and hash-checked.
- Installed Runtime screenshots at `../outputs/installed-component-manager-20260817/` cover the light catalog, dark detail modal, constrained catalog, and opened layered filter without clipping or horizontal overflow.

## HUB taskbar, Setup download progress, and plugin layout checkpoint

- HUB launch no longer inherits Desktop's configured borderless or exclusive mode. It applies normal window mode and reasserts taskbar eligibility on load, tray restore, and silent activation by setting `ShowInTaskbar`, adding `WS_EX_APPWINDOW`, removing `WS_EX_TOOLWINDOW`, and refreshing the frame.
- The rebuilt installed `dsh-hub.exe` reported extended style `0x50100`, retained `WS_EX_APPWINDOW`, omitted `WS_EX_TOOLWINDOW`, and kept the primary process alive while a second `--activate-silent` process exited after activation.
- The Setup CLI emits `DSH_SETUP_PROGRESS` JSON Lines with file name, downloaded bytes, total bytes, and cache state. Launcher-native downloads and CLI downloads both forward byte progress through the WebView bridge.
- Setup progress surfaces render a separate download sub-progress row with transferred bytes, total bytes, and percentage when known, or an indeterminate bar when the server does not provide a total. The DSHMK handoff into the CLI now starts at 48 percent after the native download's 46 percent endpoint, so the overall progress cannot move backward.
- The reported installed-plugin overlap came from `dshmarket@1.10.1`, whose installed rows place long package paths, descriptions, switches, links, and uninstall actions in one flex row. Desktop-only compatibility styling makes descriptive content a complete wrapping row and places actions below it without changing the isolated HUB.
- The first compatibility build still showed the overlap because `BuildCssScript` tried to append to `document.head` during WebView2 document creation, before the head existed. CSS injection now waits for the head or document element, which also repairs user-configured injected CSS on early documents.
- Focused tests pass: 27 of 27 across Setup CLI progress, HUB bridge parsing, and Setup HUB components. Setup HUB typecheck, Setup HUB production bundle, Web frontend build, host library build, Launcher build, and the Setup bridge smoke all pass.
- Real installed-path visual verification at 200 percent DPI opens `设置 → 插件市场 → 已安装` and shows the description, activation state, switch, usage link, local-development link, and uninstall action on non-overlapping rows. Evidence is `../outputs/installed-taskbar-download-20260817/desktop-market-installed.png`.
- `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness` was fully backed up before deployment at `artifacts/installed-taskbar-download-backup-20260817-110928/app`; the backup contains 102,276 files and 1,126,348,453 bytes. `backup.json` and `deployment.json` record the rollback source and synchronized hashes.
- The installed Launcher, CLI Setup chunk, dynamically loaded Setup HUB client, and Web frontend were synchronized and hash-checked. No standalone Setup EXE was rebuilt during this ordinary UI iteration.

## Manual dependency acquisition checkpoint

- The Setup progress surface exposes a subdued manual-download action during dependency acquisition. Its panel lists each required artifact's exact file name, declared size, download address, source repository, and available SHA-256, with actions to open either address or select a completed local file.
- The WebView bridge owns `setup-manual-import` and `setup-open-manual-url`. A manual import competes with the online transfer inside the same pending installation request; successful import cancels the transfer and continues installation, online failure keeps the request available for import, and cancellation terminates both paths.
- Native import enforces the 256 MB limit, declared size, gzip, ZIP, or executable header, and declared SHA-256 before computing the content hash and atomically writing the file into the same content-addressed Setup cache. The resulting Setup audit evidence records that the artifact came from a manual import.
- The six installation stages use six columns at wide sizes and two or one column at constrained sizes. The manual-download component screenshots show no clipped labels, overlapping actions, or horizontal overflow at the tested wide and narrow layouts: `outputs/manual-download-visual-20260817/manual-download-component.png` and `outputs/manual-download-visual-20260817/manual-download-component-narrow.png`.
- Focused Setup HUB tests pass: 22 of 22 across bridge parsing and components. Setup HUB typecheck, Setup HUB production bundle, Web frontend production build, Launcher build at `windows/launcher/dist-manual-download-dev`, the native manual-import smoke, and `git diff --check` pass. The native smoke rejects an incorrect SHA-256 and a false gzip header, then proves that a valid local file wins the race against the online transfer.
- The installed application was backed up at `artifacts/installed-manual-download-backup-20260817-124903` before synchronizing the three Launcher EXEs, Setup HUB client bundle and source map, and complete Web frontend. `backup.json` and `deployment.json` contain 120 before/deployed file hashes; the installed HUB SHA-256 is `6E9A4DBC408C0B2ACEF44B7193731ED6C90D768ABD617E917E43C0938C5EAB79`, the Setup HUB client SHA-256 is `EB3A6789AB7537F66824B6DDCC0E0281E9BE82770CC00CE9CB54CA15DCF73725`, and the Web index SHA-256 is `F923E512D5961640FF3AE7412DA139EF22F4CD2A6B249BFE24FDB57CEBB255C6`.
- Real installed-directory isolation smokes for both `dsh.exe` and `dsh-hub.exe` verify first-run CONFIG behavior, structured WebView2 readiness, and zero remaining application-directory processes. No standalone Setup EXE was rebuilt during this ordinary feature iteration.

## Verified implementation

- `windows/launcher/src/MainApp.cs` compiles after repairing the launcher dictionary initializer.
- DSHMK is the default discovery source and supports dynamic categories, persisted pagination, reconstructed details, install and cancel operations, cache fallback, and malformed-directory rejection.
- `windows/launcher/assets/dshmk-catalog.json` is the bundled last-known-good DSHMK snapshot and contains 2,888 entries.
- Catalog startup reads the bundled or cached snapshot immediately and refreshes online in the background.
- DSHMK and curated-market installs use one Setup-style progress experience with bounded stages, logs, cancellation, failure reset, retry, Bundle activation, and a terminal result.
- The HUB bridge exposes `desktop-reload`; Desktop supports `--reload-silent` and restarts its owned Node service without replacing the Desktop process.
- HUB light, dark, and constrained-window frames have been visually inspected for clipping, overlap, stale enlarged surfaces, and detail-layer overflow.
- HUB-focused tests pass: 26 of 26.
- GUI tests pass: 277 files, 3,788 tests passed, 1 skipped.
- HUB production bundle, Web production bundle, and Launcher development build complete successfully.
- DSHMK offline catalog smoke passes in approximately 390 ms.
- Desktop reload smoke confirms an owned Node process replacement while the loopback service returns HTTP 200 on the same port.
- The rebuilt Runtime reports version `0.1.0-rc.5`, carries Node.js `v24.18.0` and npm `11.16.0`, installs an offline Setup fixture, returns HTTP 200, and leaves no reparse points.
- Runtime construction uses modern pnpm deploy with injected workspace packages and isolated hoisted output. The final build completed in 92.1 seconds and preserved the source workspace's React development dependency sentinel.
- A fresh 373 MB isolated application directory assembled from the Launcher and Runtime outputs passes real WebView startup with no system Node.js or source-tree path configured.
- Empty-data first launch opens the native CONFIG window without starting Node.js, and stopping CONFIG leaves no application-directory process.
- The installed Desktop passes ten consecutive WebView readiness and process-cleanup runs plus a three-run recheck after smoke-harness changes.
- The installed HUB passes ten consecutive WebView readiness and process-cleanup runs as an independent `dsh-hub.exe` process.
- Packaged-Runtime Desktop reload replaces the child Node process, preserves the selected port, returns HTTP 200 before and after reload, and keeps the Desktop host alive.
- The HUB data smoke discovers 1,054 live community entries and 36 GitHub repositories, prepares and installs `community-dsh-composer-expand`, mutates the isolated `web` profile, and reports `Installation completed.`.
- The HUB data smoke now uses a dedicated headless `MainForm` data mode that does not create WebView2, tray, timer, or window resources. The rebuilt Launcher completed the live one-click installation smoke in approximately 7.1 seconds, exited normally, and removed its temporary profile.
- DSHMK snapshot timestamps render by the source UTC calendar date, so the `2026-08-16T16:07:23Z` snapshot displays as August 16 rather than a future August 17 after local timezone conversion.
- The rebuilt Launcher was copied into the retained isolated application directory after preserving a same-directory rollback backup. One fresh Desktop run and one fresh HUB run each verified first-run CONFIG, real WebView2 readiness, and zero remaining application-directory processes.
- Final documentation gates pass: translation pairing checked 943 pairs, Markdown links checked 1,909 files, documentation references checked 2,018 files, Markdown wrapping checked 1,869 files, document budgets checked 9 files, and all 543 Agent Notes passed format and classification checks.
- Final repository and host cleanup checks report `git diff --check` success, valid PowerShell syntax for the three changed smoke scripts, zero owned installed-directory processes, zero HUB data-smoke directories, zero installed-WebView smoke directories, no `modern-*` Runtime experiments, and intact Runtime Node.js, npm, resolver, and React development sentinel files.

## Component uninstall restart and independent taskbar checkpoint

- Desktop component management and the dedicated HUB installed view now mark a successful uninstall as restart-required and open a rounded `Restart now` / `Restart later` decision surface. Deferring preserves the existing persistent restart action instead of silently refreshing into stale plugin state.
- The shell-owned plugin failure page now exposes `Restart application`. Activation immediately switches to a minimal spinner with `重启中`; rejection restores the diagnostic surface and reports the native bridge error.
- The WebView bridge operation `app-reload` restarts the current Desktop or HUB host. Native service shutdown now runs on the thread pool, while a double-buffered WinForms restart overlay continues animating on the UI thread until structured Web UI readiness or terminal failure.
- Desktop and HUB set different explicit AppUserModelIDs (`DeepSeek.Harness.Desktop` and `DeepSeek.Harness.Hub`). HUB additionally clears a native owner and reasserts `ShowInTaskbar`, `WS_EX_APPWINDOW`, and the absence of `WS_EX_TOOLWINDOW` on load, shown, tray restore, and activation.
- Focused component and shell tests pass 21 of 21. Both client package typechecks, the Setup HUB client bundle, Web frontend build, Launcher build, Desktop Node-service replacement smoke, and the new independent-taskbar smoke pass.
- The development files were synchronized to `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness` after a rollback backup at `C:\Users\65428\AppData\Local\Programs\DeepSeek Harness\dev-backups\restart-taskbar-20260817-132013`. Fresh installed Desktop and HUB WebView smokes each verified first-run CONFIG, packaged-runtime readiness, and zero remaining installed-directory processes.
- No standalone Setup EXE was rebuilt for this ordinary UI and lifecycle iteration.

## Plugin startup asset recovery and uninstall progress checkpoint

- The first-start failure after component removal was traced to WebView2 retaining the removed plugin's client bundle reference and cache state, not to the final DSH Web Profile. The installed log recorded `failed to import loader entry cb193bf4 (@dsh-external/dsh-ads)` after the package and profile entry had already been removed.
- `MainApp` now recognizes the stale client-bundle failure signature, navigates to `about:blank`, clears `DiskCache`, `CacheStorage`, and `ServiceWorkers`, then restarts the owned Node service once with a fresh boot token. This path is separate from pending-only plugin service recovery and cannot enter an unbounded retry loop.
- HUB and Desktop component removal now expose native progress from the confirmation point through receipt cleanup, Profile update, launch-reference cleanup, and verification. The Web UI presents a dedicated rounded progress surface instead of leaving a silent gap before the restart decision.
- Launcher and HUB foreground activation now use the current UI thread, temporary TopMost promotion, thread-input attachment, and explicit taskbar-frame restoration. This keeps HUB in front when opened from Desktop while preserving independent HUB and Desktop taskbar windows.
- Focused validation on 2026-08-18 passed: Setup HUB component and bridge tests (`23/23`), Setup HUB typecheck, Launcher build at `windows/launcher/dist-latest-issues-check`, normal Web UI gate, pending-only service recovery gate, stale client-asset recovery gate, independent Desktop/HUB taskbar smoke, and Setup bridge smoke. The stale-asset gate observed zero controlled navigation retries, one cache-clearing recovery, two service starts, and final structured ready status.
- The HUB-to-Desktop packaged-runtime restart smoke was not rerun in this checkpoint because the selected Launcher development directory does not contain `runtime/runtime-manifest.json`; this is an artifact-selection limitation, not a test failure. No Setup EXE was rebuilt or published.

## Setup rebuild checkpoint — 2026-08-18

- The product owner explicitly requested a new Setup EXE build. The current Launcher, Web client, private Runtime, Full Setup, and Lite Setup inputs were rebuilt on D with no GitHub upload.
- The first release-chain attempt compiled both Setup EXEs successfully but exposed a smoke-harness-only failure: Inno Setup resolves `{localappdata}` through the Windows Shell Folders registry, while the harness only changed the `LOCALAPPDATA` environment variable. The current machine's `C:\Users\65428\AppData\Local\DeepSeekHarness` is a D-drive Junction, which Inno's reparse-point guard correctly rejected.
- `windows/setup/smoke.ps1` now temporarily redirects both HKCU Shell Folders entries to isolated real D-drive directories, restores the original values in `finally`, and keeps the product's standard data-mode behavior unchanged. Full upgrade, uninstall with a locked bundled Node process, reinstall-first-run CONFIG routing, and Lite portable install then passed.
- Final release output: `windows/release/dist-setup-rebuild-20260818`.
- Full Setup: `343,311,275` bytes, SHA-256 `2e47add6cb13cbb6c0a39f59ec524e64e1a6a342c243ebd4fde97b2de5ac456a`.
- Lite Setup: `4,886,756` bytes, SHA-256 `dcb13bf5f82ee1d38923775b0c5dbb5fe7379c7b3de4960de78ddb32c8e0ad4a`.
- Runtime archive: `127,464,594` bytes, SHA-256 `d367bf8573db4ab729d6c6b4ad0467079462ce9acb9bc7636d314f9a3b30f28b`; Portable archive: `129,687,798` bytes, SHA-256 `1100931cae93a793731aa137be3d0e567097452434323c5b3d91231dbba5ba72`.
- `release-manifest.json` matches all six release assets by byte count and SHA-256. Shell Folders were restored to `C:\Users\65428\AppData\Local`, no owned DSH/Node processes remain, and no GitHub upload was performed.

## Durable evidence

- Launcher development output: `windows/launcher/dist-dshmk-dev`
- DSHMK catalog smoke: `windows/launcher/smoke-dshmk-catalog.ps1`
- Desktop reload smoke: `windows/launcher/smoke-desktop-reload.ps1`
- Desktop/HUB taskbar independence smoke: `windows/launcher/smoke-taskbar-independence.ps1`
- HUB visual smoke: `windows/launcher/smoke-hub-visual.ps1`
- HUB profile-isolation smoke: `windows/launcher/smoke-hub-profile-isolation.ps1`
- HUB-to-Desktop restart smoke: `windows/launcher/smoke-hub-desktop-restart.ps1`
- Installed WebView smoke: `windows/launcher/smoke-installed-webview.ps1`
- Web UI startup and service-recovery smoke: `windows/launcher/smoke-ready-gate.ps1`
- DSHMK packaged install and retry smoke: `windows/launcher/smoke-dshmk-install.ps1`
- Startup-recovery Launcher development output: `windows/launcher/dist-webui-recovery-dev`
- DSHMK internal-package-manager Launcher development output: `windows/launcher/dist-dshmk-internal-npm-dev`
- Latest isolated installation descriptor: `artifacts/latest-isolated-install.json`; it points to the retained modern-hoisted local smoke copy and is not a release asset.
- Isolated Launcher rollback backup: `artifacts/isolated-installed-official-20260816-f3aa399c/launcher-backup-before-headless-smoke-808aa3a72ee04e08a87300cad805cfe8`
- Light catalog screenshot: `../outputs/hub-visual-final/hub-light-catalog.png`
- Dark modal screenshot: `../outputs/hub-visual-final/hub-dark-modal.png`
- Constrained catalog screenshot: `../outputs/hub-visual-final/hub-narrow-catalog.png`
- Final date-corrected light screenshot: `../outputs/hub-visual-datefix-final-20260816/hub-light-catalog.png`
- Final date-corrected dark screenshot: `../outputs/hub-visual-datefix-final-20260816/hub-dark-modal.png`
- Final date-corrected constrained screenshot: `../outputs/hub-visual-datefix-final-20260816/hub-narrow-catalog.png`
- Installed component-management visual set: `../outputs/installed-component-manager-20260817/`

## Completed validation sequence

1. Re-recorded and verified the changed bilingual documentation pairs after the Runtime and headless-smoke documentation updates.
2. Ran the documentation link, pairing, budget, wrapping, Agent Note, focused HUB, Launcher build, installation, and WebView smoke checks.
3. Inspected `git diff`, generated artifacts, the retained isolated copy, Runtime contents, temporary directories, and residual owned processes without resetting unrelated working-tree changes.
4. Recorded the initial command evidence and completed the ordinary UI checkpoint without building Setup.
5. After the product owner's explicit request, ran the complete release pipeline, verified both Setup EXEs and all release assets, and recorded their hashes and signing state.
6. Diagnosed the retained-profile first-start stall from the installed configuration and launcher log, added bounded automatic service recovery, and verified fast retry, synthetic retained-plugin recovery, and real cloned-profile startup paths without rebuilding Setup.

## Known risks and incomplete evidence

## Published HUB release checkpoint

- Public HUB Release `v0.1.0-rc.5`: `https://github.com/Iraryi/deepseek-harness-hub/releases/tag/v0.1.0-rc.5`.
- The release contains Full Setup, Lite Setup, Runtime ZIP, Portable ZIP, the PowerShell installer, release notes, the release manifest, and SHA-256 checksums. Remote asset sizes and GitHub SHA-256 digests match the locally built artifacts.
- The two cataloged standalone Setup URLs resolve to the published HUB release and match their declared byte counts and SHA-256 values.
- The HUB catalog source entries pin desktop implementation commit `4af6b2a0abdff7684695639ebab84e66b8e6743f`; the older desktop `v0.1.0-rc.5` tag remains unchanged because it already has a public release.
- HUB Registry validation passes on the published catalog commit. Desktop CI, Landlock, Sandbox, both release workflows, and the manually dispatched documentation deployment pass for the implementation commit. The documentation run also confirms the repaired generated catalog, JSDoc, and README pairing gates.

- `artifacts/legacy-profile-recovery-a19206059f01` and `artifacts/latest-legacy-profile-recovery.json` remain as an inert 427,209,499-byte isolated test copy and descriptor. No process references the directory, but the host command policy rejected recursive deletion after the absolute path was verified under the repository `artifacts` root.
- Five failed `dsh-dshmk-install-smoke-*` directories remain under the system temporary directory from intermediate harness failures. They total approximately 196 MB, match the smoke's fixed name pattern, and have no referencing process; the host command policy rejected their verified recursive deletion.
- One 563-byte `dshmk-catalog-smoke-8a0eba30774343d48e381b62e724f7e4` directory remains from the PowerShell Core stack-overflow run. It contains only the synthetic stale catalog and generated HUB data, has no referencing process, and the host command policy rejected its verified recursive deletion.
- `windows/launcher/smoke-companion-processes.ps1` was removed from the working tree by an external cleanup. `smoke-desktop-reload.ps1` covers the new reload path, but the broader companion-process scenario still needs either restoration or equivalent coverage.
- The Full and Lite Setup EXEs are suitable for local testing but will show Windows as unsigned until an Authenticode certificate is configured and the release assets are signed.
- The already-built Full and Lite Setup EXEs predate the retained-profile recovery and DSHMK internal-package-manager changes. Do not represent them as containing either fix; build a new Setup only at the next explicit release checkpoint.
- The installed development copy contains the component-management, layered-filter, catalog-health, restart-action, and profile-isolation changes. The standalone Setup EXEs were intentionally not rebuilt during this ordinary UI iteration.
- The working tree contains extensive pre-existing product work. Do not reset, clean, or rewrite files merely because they are modified or untracked.

## Completion condition for this checkpoint

Result: complete. The Runtime build, Runtime smoke, isolated installed-directory WebView smoke, DSHMK offline smoke, DSHMK packaged installation and retry smoke, Desktop reload smoke, bounded retained-profile startup recovery, Full and Lite Setup compilation, installation and uninstall smoke, portable smoke, relevant documentation, diff inspection, manifest verification, and owned-process cleanup all pass. The final local release output is `windows/release/dist-vm-regression-final` and includes the current startup-recovery, DSHMK package-manager, onboarding, window-geometry, environment-variable, runtime-pnpm, icon, and localization fixes. GitHub upload remains intentionally disabled for this checkpoint.

## Final local VM-regression release checkpoint

- The release pipeline completed with exit code `0` after geometry, Desktop/HUB service-gate, Node recovery, DSHMK installation, Full/Lite Setup compilation, Setup install/uninstall, and portable HTTP smoke checks.
- Full Setup: `windows/release/dist-vm-regression-final/DeepSeek-Harness-Setup-Full-0.1.0-rc.5-win-x64.exe`, `343,310,365` bytes, SHA-256 `7fddb7deabe331cf2a0325b2e04aa4916d3a470e088897e70aa9ba24baf7f170`.
- Lite Setup: `windows/release/dist-vm-regression-final/DeepSeek-Harness-Setup-Lite-0.1.0-rc.5-win-x64.exe`, `4,884,889` bytes, SHA-256 `f1b1f404a98049cefc9750ffef92f7b97d70535df2bca4cc5e2d576113e4a4b5`.
- Portable ZIP: `129,683,942` bytes, SHA-256 `e44af194f889c48a2292fc7d2fca2a62c517403742e93f1b019d0f73b4c718eb`; Runtime ZIP: `127,465,536` bytes, SHA-256 `347ca7b3966b57d90f1ab21d8de67da7c41344fa85d1816183cb4864c84f8a7f`.
- `release-manifest.json` and `SHA256SUMS.txt` match every generated asset. The release smoke reached HTTP 200 using the packaged private Node runtime and removed its temporary portable process tree.
- No `dsh.exe`, `dsh-hub.exe`, `dsh-config.exe`, or Node process remains from the final smoke. The only locally produced deliverables are retained; no GitHub upload or commit was performed.

## CONFIG save-and-run cold-start checkpoint — 2026-08-18

- The reproduced path is now recorded as the authoritative regression path: fresh Setup installation, automatic CONFIG routing, `保存并运行`, first WebView/plugin cold start, and final startup outcome. The failure is not treated as retained configuration by default.
- The first-run handoff now uses one owned `DSH_HOME` resolution for CONFIG, Desktop, HUB, and the bundled Node process. When no explicit environment value exists, the profile is created under the application data directory instead of silently falling back to the user's unrelated `.dsh` directory.
- Web UI startup now emits a navigation-scoped progress heartbeat every five seconds and reports concrete stages. Launcher verification uses both an idle-progress timeout and a hard upper bound, so a slow but advancing first boot is not restarted at 45 seconds. First navigation allows 120 seconds; a controlled retry uses a 60-second hard limit.
- The client activation wait is bounded at 60 seconds and the native launcher retains one bounded service recovery for a terminal pending-only failure. Recovery counts and navigation tokens remain scoped so stale status messages cannot settle a later navigation.
- Added a slow-progress regression to `windows/launcher/smoke-service-gate.ps1`. A synthetic first navigation sends active heartbeats for 50 seconds, then becomes ready; the rebuilt Launcher kept one service process, one navigation, and zero retry/recovery actions.
- Focused Web tests passed: `28/28` across the changed boot settlement, AppRoot, Setup HUB, and component surfaces. The Web frontend build, Launcher build, normal ready gate, pending-service recovery gate, stale-client-asset recovery gate, and 50-second slow-progress gate passed.
- A real Full Setup install smoke passed the exact CONFIG save-and-run path with one bundled Node launch, HTTP 200, settled plugin graph, completed WebView navigation, and no automatic recovery. Full/Lite Setup compilation completed in `windows/setup/dist-first-run-fix-20260818`.
- Current local deliverables: Full Setup `343,311,901` bytes, SHA-256 `337348e03fb64b0b06570b00691f7c7f49ae26cbb756cac4aec8ff1d1c620592`; Lite Setup `4,886,800` bytes, SHA-256 `5fac5074e7984a2b77dbd95ec21ba917fa8ae7f4afcbca3e51c9f4db51ed7b2d`; Runtime ZIP `127,465,193` bytes, SHA-256 `f93332d47af28792cc83aa5c43241744593ae534d1e675c6d461da9157e4f847`.
- The first smoke attempts exposed test-harness cleanup defects: one run tracked installed `dsh.exe` as a CIM process object and did not terminate the descendant WebView2 tree; another run placed Windows AAD Broker state files inside a per-run Shell Folder sandbox. Smoke cleanup now accepts process IDs, terminates the full tree, matches the isolated data directory, and uses a reusable real Shell Folder sandbox while deleting only DSH-owned data. The final smoke rerun passed. The two inert intermediate directories `windows/setup/dist/smoke-install-0c3ea505` and `windows/setup/dist/smoke-install-b51d78e9` remain without referencing processes because host deletion policy rejected recursive cleanup.
- No GitHub upload or commit was performed. The new Setup EXEs remain local testing artifacts until a release checkpoint is explicitly authorized.

## First CONFIG-to-Desktop startup and restart checkpoint — 2026-08-18

- The VMware first-run failure is an early index-response race, not a CONFIG handoff Job failure. The HTTP port can open while the Loader is still settling; the first `index.html` response could therefore inject an empty or incomplete `window.__DSH_BOOT__` graph. The WebView then remained pending for `slots`, `sessions`, and `layout` even though the service was reachable.
- `packages/host/webserver` now accepts asynchronous index transforms and applies them in order. `packages/client/modules` awaits Loader settlement before reconciling and injecting the boot manifest, so the first request receives the settled graph rather than relying on a refresh or recovery navigation.
- The same VM log exposed a separate restart defect: the old server Job was reused after shutdown, the replacement Node could not be assigned, and the old service still occupied port 3080. `MainApp.StopServer()` now terminates, disposes, and clears the old Job, waits for the port to close, and lets the next start create a fresh containment Job. Inherited external Job access denial remains a non-fatal containment fallback, not the first-run root cause.
- Direct VM evidence: the failing run started at 18:49:34, first reached `http://127.0.0.1:3080` at 18:50:06, stalled through two pending boot attempts, and moved to 55266 during recovery because 3080 remained occupied. After the final relaunch at 19:13:03, one Node process reached structured ready status at 19:13:09.
- Validation passed with the rebuilt artifacts: Runtime offline smoke, first-index smoke (first response 39 entries and second response 39 entries), packaged Desktop reload (HTTP 200 before and after reload on the same configured port), and forced Launcher termination cleanup.
- Full/Lite Setup smoke passed twice consecutively after the first exploratory run exposed a transient missing `Page loaded` observation. The final local candidate is under `outputs/final-setup-20260818/`; SHA-256 values are recorded in its `SHA256SUMS.txt`.
- No GitHub upload or commit was performed. Testing and outputs remain on the D drive.

## VMware first-run observation checkpoint — 2026-08-18

- VMware Workstation guest `D:/VMware/Windows 11 x64.vmx` was inspected as `AAA`; the closed-tail capture is under `outputs/vm-live-monitor/direct-20260818-200402`.
- The closed-tail capture contained one active `dsh.exe` and one product-owned `node.exe`. Those product processes, probe Nodes, and temporary capture PowerShell processes were later terminated before the final Setup transfer; the current guest has no DSH/Node process from this test.
- The read-only monitor scripts remain diagnostic tools only. The detached monitor was stopped before the final direct capture; do not describe it as continuously active.
- A final Full Setup copy is already present at `C:/Users/AAA/Desktop/DeepSeek-Harness-Setup-Full-final.exe`. Its automated install was intentionally stopped at the user's request before any new DSH/Node process started; the remaining VMware install step is manual.

## CONFIG save-then-launch sequencing checkpoint — 2026-08-18

- `Save & Launch` now persists Desktop and HUB configuration, closes the CONFIG message loop, and launches the sibling application only after CONFIG has closed. It no longer starts the application from inside `SaveAndClose`.
- The post-close handoff uses Windows Shell/Explorer so the new Desktop or HUB process is not attached to CONFIG's parent Job. The regular `Save` button remains save-and-close only.
- `windows/launcher/smoke-first-run-handoff.ps1` now asserts that the Desktop process is absent immediately after `SaveAndClose(true)`, then launches it only after the form is disposed, verifies survival outside the outer Job, and checks for no access-denied startup.
- Launcher build and the updated first-run handoff smoke pass at `windows/launcher/dist-save-then-launch-20260818`. Full/Lite Setup compilation and the local Setup smoke pass at `windows/setup/dist-save-then-launch-20260818`; Full is `343,313,584` bytes with SHA-256 `96beb88d5c1a70c0c55c4f745b525520f9038c9a907ae8d4a5b886a2c86d8388`, and Lite is `4,887,958` bytes with SHA-256 `6156328d91114bfc75f8401328457f9c81d7af334b7f6139a1e6ad6c0ab6e3fd`. No VMware desktop files were modified, and no GitHub upload or commit was performed.
