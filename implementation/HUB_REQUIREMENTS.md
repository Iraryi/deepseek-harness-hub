# Mandatory Desktop, Setup, and DSH HUB requirements

This file records direct product-owner requirements for the DeepSeek Harness Windows Desktop distribution. Every agent or contributor working on the affected surfaces must read it before planning or editing. These requirements remain active across context compaction, task handoff, and later development sessions unless the product owner explicitly replaces them.

## Product identity and process model

- Deliver a user-facing Windows application rather than a browser launcher. The main Desktop, CONFIG, and DSH HUB are native EXE entry points hosting the Web UI through WebView2.
- Keep Desktop and HUB as independent sibling processes with different EXE and tray icons, independent single-instance identities, independent local-service ports, and independent settings. Either process must be able to open or foreground the other without a duplicate-instance warning.
- Opening HUB from Desktop or its tray menu must restore a normal independent HUB window with its own Windows taskbar button. Desktop and HUB use different explicit Windows AppUserModelIDs in addition to separate processes and icons. HUB never inherits Desktop borderless or exclusive launch modes, and restoring from the HUB tray must reassert normal taskbar-window styles and remove any native owner that would collapse it into a tray-only window.
- Keep application data, Runtime data, extensions, Setup packages, caches, and logs outside the EXE. The EXE is an entry point, not the storage container.
- Closing, tray behavior, dedicated tray buttons, loading screens, fullscreen behavior, and companion-process cleanup must be deterministic. A launcher must not leak Node.js processes or leave files locked after exit or uninstall.
- Do not open the WebView2 download page or an external browser as part of ordinary startup. External navigation is allowed only when the user explicitly chooses it.

## CONFIG

- First use opens CONFIG before the main application and asks for CONFIG language. Installation may preseed this choice when the installer owns the first-run flow.
- CONFIG edits Desktop and HUB settings through one integrated interface while keeping their values independent.
- Resolution configuration provides an aspect-ratio selector, a dependent list of common resolutions, and a lower-level custom width and height option. Controls must be compact enough to read as one group without crowding.
- Desktop startup modes include normal window, bordered maximized, borderless fullscreen, and exclusive/topmost fullscreen. Fullscreen settings independently control application-toolbar and Windows-taskbar visibility.
- Desktop settings include loading presentation, close action, tray behavior, toolbar behavior, hotkeys, browser-extension directories, Web UI CSS/JavaScript injection, DevTools, and external-link behavior.
- HUB settings include theme, default page, discovery source, loading presentation, close action, tray behavior, catalog page size, project-detail presentation mode, and whether a supported source opens as a reconstructed native detail page or the original website.
- Desktop plugins do not affect the HUB Web Profile by default. CONFIG exposes an explicit opt-in for sharing Desktop plugins with HUB.
- Project-detail presentation modes are side copilot panel, themed modal surface, and full-surface navigation.
- CONFIG must never contain overlapping text, clipped controls, inaccessible buttons, nested-window visual framing, ineffective page scrolling, or mouse-wheel value changes caused merely by hovering selectors.
- CONFIG must preserve correct layout at high DPI and through repeated Desktop/HUB switching in both normal and maximized windows. Dynamically rebuilt controls must not return to 96-DPI dimensions.

## Setup installer for the Desktop distribution

- The standalone installer is for a novice computer with no development environment installed. It must detect requirements, explain them, install or use bundled dependencies, install the application Runtime and source payload, create shortcuts, and provide a predictable first launch.
- The installer supports online installation, bundled/offline installation, and importing a locally downloaded GitHub source ZIP when network access is poor.
- Recommended installation is the simple default. Advanced pages remain available but must not crowd or obscure the normal path.
- Installation progress remains responsive, draggable, and visibly advances through meaningful stages. It must not freeze on a static page and then flash a progress bar at the end.
- The download stage has a separate byte-level sub-progress indicator beneath the overall Setup progress. It shows downloaded and total bytes plus a percentage when the total is known, uses an indeterminate state when it is unknown, and cannot make the overall progress move backward when installation changes download engines.
- Going backward and forward cannot duplicate pages, overlap controls, flicker options, or preserve stale progress state.
- Uninstall and upgrade must stop owned Desktop, HUB, CONFIG, Node.js, and helper processes before replacing or deleting files.
- Do not build or publish a new standalone Setup package during ordinary UI iteration. Build it only when release-level validation is intentionally requested or the implementation has reached a release checkpoint.

## DSH HUB product direction

- DSH follows “Everything is a Plugin”; this Desktop distribution follows “Everything is a Setup.” DSH HUB is the primary user-facing shell for discovering, inspecting, installing, editing, updating, disabling, and removing Setup-managed content.
- The left rail is a functional navigation area, not a vague category list. It includes Home, discovery, Setup library, installed Setups, offline packages, starred items, builder/editing tools, GitHub connection, settings, and other high-value management functions.
- Home summarizes the local Setup library, offline packages, starred packages, installed packages, update state, and actionable failures.
- GitHub login belongs only in its dedicated functional area. Other pages show account-derived content only after connection.
- GitHub discovery supports useful categorization and a global search, but one-click Setup is limited to sources with enough installation metadata. AI-assisted building is for local Setup package construction or unresolved installation cases, not a prerequisite for normal one-click installation.
- HUB theme follows the established dsh-market visual language: coherent light/dark surfaces, restrained contrast, rounded controls, real project icons, smooth menus, and no text standing in for an available icon.
- The Desktop settings `DSH HUB` tab is component management, not another discovery market. It lists installed components, prepared Setup workspaces, offline packages, uninstall actions, and paths intended for AI-assisted editing.

## Catalog source priority and synchronization

- Default source priority is: `dshmk.com` first, the project-maintained curated Setup market second, and global GitHub discovery third.
- `dshmk.com` is a first-class live source. Consume its public catalog and detail metadata, its dynamic tags/categories, validation levels, installation guide, source links, related projects, and available icon assets.
- Do not hardcode the complete DSHMK taxonomy. Synchronize tags and categories from the site without requiring a HUB application update. Keep a small stable set of fallback categories for offline and degraded operation.
- Cache successful catalog responses and retain a bundled last-known-good snapshot. Fetch through multiple paths when appropriate: DSHMK catalog endpoints, GitHub API/raw content, and GitHub source ZIP. A single Git or HTTP failure must not empty the catalog.
- Reject an online or cached catalog that suddenly loses most repositories or one-click-install candidates when a newer healthy bundled or cached snapshot is available. Installing one project cannot downgrade every other card to local-build-only state.
- The DSHMK implementation source may be studied and adapted under its MIT license, but HUB keeps its own product identity and theme.
- Catalog requests have bounded timeouts, retry/backoff, cancellation, stale-cache fallback, and a visible retry action. No catalog or install button may spin forever.

## Catalog browsing and pagination

- Browsing is paginated. The default page size is at least 12 and every offered page size is a multiple of four.
- Provide practical page-size choices such as 12, 24, 48, 96, and 200 where layout and performance permit. Persist the selected page size across launches.
- Pagination includes previous/next, current and nearby page numbers, first/last reachability, total pages, and ellipsis for long ranges.
- Changing source, query, filters, category, sort, trust level, or page size resets to a valid page. Returning from project details restores the originating source, query, filters, page number, and scroll position.
- DSHMK keeps sorting separate and places layered search scope, synchronized TAG/category, project type, validation/installability, local-build-only, and page-size choices behind one rounded `Filters` control beside search.
- Card actions and status indicators must not cause layout shifts, clipped labels, or endless rotating icons.

## Project details

- A catalog card opens a HUB detail experience rather than navigating directly to GitHub by default.
- The default detail page is reconstructed in HUB's own theme from source metadata. It includes project identity, icon, author, description, tags, popularity, releases, compatibility, validation evidence, declarations, permissions, source provenance, license, installation reference, installation plan, related projects, and a prominent one-click Setup action.
- The user may configure the detail presentation as a side copilot panel, a rounded themed modal with a complete backdrop, or a full-surface detail route.
- The user may configure supported sources to show HUB's reconstructed page or the original website page. Original-site mode remains contained in the application unless explicit external navigation is requested.
- Closing or navigating back from any detail mode restores the exact catalog page and scroll position without flashing, resizing the native window, or exposing an unthemed frame.

## Installation behavior

- “Install” must perform a real installation into the DSH profile or the target plugin's documented destination. Merely downloading or extracting repository files into the HUB library is not installation.
- The Setup library may retain source archives, manifests, receipts, and build inputs, but installed state is derived from a verified activation result, not from the presence of a downloaded directory.
- Every installation opens a Setup-style progress surface with project identity, source, declared actions, installation reference, log/progress stages, cancel/close behavior, and a final actionable result. Never replace this with a disabled grey card button and an indefinite spinner.
- Prefer direct, usable installation. Routine trusted-source installs must not show repeated blocking danger dialogs. Provenance, license, signatures, permissions, and declarations remain visible inline. Reserve explicit confirmation for destructive actions, credential disclosure, privilege escalation, or an unreviewed custom command.
- Preflight, download, extraction, dependency installation, profile mutation, activation, and post-install verification are separate bounded stages. Each stage has timeout, cancellation, useful logs, and a terminal success or failure state.
- During dependency acquisition, the Setup surface provides a subdued manual-download action. It lists every required artifact with its exact file name, declared size, download address, source repository, and SHA-256 when available; the user may open either address and select the completed local file. A local import must pass the same size limit, declared-size, file-header, and SHA-256 checks as an online download, enter the same content-addressed cache, cancel the competing transfer, and continue the existing installation request without restarting the workflow.
- A verification failure restores the card button and presents retry, advanced build, logs, and cleanup actions. It cannot leave the UI in “verifying” forever.
- Only an operation with an owned pending request may animate its icon. Download, installed, success, and disabled-state icons remain static.
- A successful component installation leaves a prominent persistent `Restart Desktop to apply` action in HUB. It restarts only the Desktop service/process path and keeps HUB open.
- A successful component uninstall immediately reports completion and offers `Restart now` or `Restart later`. Deferring keeps a persistent restart action; it must not leave the current page looking unchanged and then expose a stale-plugin failure only after manual refresh.
- A plugin-loading failure page provides a direct application restart action. Every plugin-change restart replaces the old surface immediately with a fast, minimal full-window spinner and `Restarting` text; process shutdown runs off the UI thread so the animation remains responsive until the replacement Web UI is ready or a terminal failure is shown.
- Installation receipts record exact source revision, artifact hash, actions performed, installed files, profile mutations, dependencies, verification output, and uninstall instructions.
- Uninstall reverses recorded profile and file changes where possible, stops owned processes, and reports leftovers rather than silently claiming success.
- The known `community-dshmarket` case must install and activate the dsh-market plugin according to its documented DSH profile procedure; a source dump under `hub/library/community-dshmarket` is insufficient.

## Setup package ecosystem

- HUB-managed virtual Setups present a Setup interface inside HUB. The independent Setup repository contains reviewed standalone EXE installers.
- Both virtual and standalone Setups show certificates, provenance, license, declarations, permissions, review status, hashes, and installation scope.
- Provide a simple Setup manifest and build engine so third parties can create installable extensions for this Desktop framework and publish them in a discoverable form.
- Automated Setup generation targets known DSH plugin patterns and explicit installation metadata. It does not claim that arbitrary GitHub source can safely or correctly become an EXE.
- AI-assisted editing receives a local package path and may add user-configurable options or resolve nonstandard build steps, but generated actions remain visible in the Setup plan and receipt.

## Reliability and visual acceptance

- Test every changed interaction in light and dark themes, constrained and large windows, normal and maximized states, and the machine's actual high-DPI scale.
- Exercise repeated navigation, repeated installation attempts, cancellation, timeout, offline cache, malformed catalog data, partial downloads, duplicate launch, and application restart.
- Verify the built application from the real installation directory with isolated user data before handoff. Preserve a rollback backup when deploying development Launcher files.
- Inspect screenshots or rendered frames for clipping, overlap, unintended nested-window framing, stale surfaces, white flashes, tearing, layout shifts, incomplete text, mismatched icons, and controls outside the viewport.
- Desktop-hosted third-party plugin settings must remain readable at the machine's actual DPI. Compatibility styling that prevents known plugin-card overlap must be installed only after the document can accept a style element and must keep descriptive content and action controls on separate wrapping rows.
- Use multiple independent checks for user-visible work: focused automated tests, production build, state-machine or bridge smoke tests, and visual/native-window verification.
- Never leave a button in a busy state without an owned operation, timeout, cancellation path, and terminal reset.

## Autonomous execution

- When the product owner states they are away, continue through planning, implementation, self-review, testing, visual iteration, and installed-path smoke testing without waiting for routine confirmation.
- If one network, tool, or packaging route is blocked, use a documented fallback and continue. Ask only when a decision cannot be inferred and proceeding would create irreversible user-data loss.
- Keep progress in the repository through plans, Agent Notes, tests, and this requirements file so context compaction cannot erase the active acceptance criteria.

## Clean-install VM regression gate

- The final Setup release must pass a clean Windows VM at `1024x768` as well as the development machine. Test normal window, bordered maximized, borderless fullscreen, and exclusive fullscreen separately; a mode may not expose an intermediate fixed-size loading frame, stale scaled WebView surface, torn frame, desktop background, or cropped UI while switching from loading to the Web UI.
- Normal, bordered, and borderless startup must establish the final native window bounds before presenting the loading surface or WebView. WebView creation, navigation, DPI changes, and mode transitions may not resize the visible window for one frame. Exclusive mode passing does not waive the other three modes.
- Setup and uninstall must distinguish application installation from user onboarding state. Reinstalling after uninstall must open CONFIG again unless the user explicitly retained a completed onboarding preference. A preserved stale `firstRunCompleted`, missing Runtime, or preserved profile may not send Desktop directly into a contradictory startup path.
- First-run routing must complete before Desktop starts its Node service. A failed or cancelled CONFIG launch must remain recoverable and may not leave Desktop waiting at `Activating Web UI plugins` before ending in `Access denied`.
- A clean installation must obtain a healthy DSHMK catalog and reconstructed detail data without relying on files, plugins, caches, or development tools from the maintainer's computer. Bundled catalog assets, runtime packages, source adapters, and Setup manifests required for that experience must be present in the release payload.
- Installing `plugin-store` or another market plugin may not be required to repair the built-in HUB catalog. Desktop plugins remain isolated from HUB unless the user explicitly enables sharing.
- DSHMK online failure must terminate within a bounded interval, show the exact degraded source, retain a usable bundled snapshot, and keep eligible Setup actions working when the bundled evidence is sufficient. A card or detail page may not incorrectly become local-build-only because an unrelated installation or refresh downgraded global catalog health.
- At `1024x768` and in ordinary window mode, catalog cards and reconstructed details must keep the full `One-click Setup` or `Local build required` action inside their rounded control. The label, icon, and hit target may wrap or compact but may not clip or extend beyond the viewport; fullscreen correctness alone is insufficient.
- The installed Runtime must contain every package-management tool required by built-in Setup flows. It includes private Node.js, npm, and pnpm shims or payloads where the implementation invokes pnpm. Normal users must not need system Node.js, npm, pnpm, Git, or a manually prepared development environment.
- Setup registers stable per-user command entry points for `dsh`, `dsh-hub`, and `dsh-config`, updates the current process and future user PATH without duplicating entries, and removes only its owned PATH entry during uninstall. Command registration must point to installed launchers or supported command shims rather than source-tree files.
- CONFIG uses a distinct gear-mark application, executable, shortcut, taskbar, and tray icon derived from the same product icon family. It may not reuse the Desktop icon. HUB retains its distinct HUB mark.
- All native tray and WebView context-menu labels use one product vocabulary: `DSH`, `HUB`, and `CONFIG`. Do not mix `DeepSeek Harness`, `DSH HUB`, bare `Open`, and `Show DeepSeek Harness` within one language. Chinese mode uses Chinese verbs such as `打开` or `显示`; English mode uses `Open` or `Show`. Desktop, HUB, and CONFIG processes must expose the same localized terminology.
- The final release gate includes a fresh-install test, uninstall-then-reinstall test, preserved-data test, empty-data test, clean HUB catalog test, `1024x768` visual captures for all four window modes, PATH/command tests, icon identity tests, Chinese and English tray/context-menu tests, installed-path process cleanup, and Full/Lite Setup compilation. Only the final validated checkpoint may produce the handoff Setup package, and it must remain local until upload is explicitly reauthorized.
