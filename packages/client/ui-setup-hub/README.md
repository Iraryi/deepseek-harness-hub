# dsh-client-ui-setup-hub

English | [中文](README.zh.md)

The management sidebar includes a runtime overview, optional desktop enhancements and explicit phone pairing. Enhancement preferences use a separate revision-checked file with backup and require a DSH restart; dirty navigation is guarded. The width, rich-text paste and session-ID adapters affect Desktop only. Phone access relays the existing DSH interface with device authentication, expiry and revocation, but trusted-LAN HTTP is unencrypted and requires consent; see [mobile access](../../../windows/mobile/README.md) and the [Overlay distribution](../../../windows/overlay/README.md). The original market, inventory and standalone CONFIG remain available.

The DSH HUB tab inside Web/Desktop Plugin settings. It reads a Setup registry lazily, sorts and searches entries, and renders the complete source, license, digital-signature, audit, compatibility, permission, network, and artifact declarations before exposing installation.

Windows also exposes a complete workspace through the dedicated `dsh-hub.exe` entry. This entry owns the full WebView2 canvas rather than opening a browser or nesting another application window, provides native CONFIG and a normal-Desktop action that starts the separate `dsh.exe` process, and adapts navigation, filters, cards, and action rows for constrained high-DPI windows without overlapping controls.

The dedicated workspace uses functional navigation instead of category navigation: Home, GitHub discovery, reviewed catalog, the authenticated user's starred repositories, the local Setup library, the offline inbox, installed Setups, the Setup builder, a dedicated GitHub account surface, and the security center. Home summarizes each data plane and exposes direct folder and creation actions. Credentials can be entered only on the account surface; discovery and starred views never render token fields.

Discovery has three explicit sources in priority order. DSHMK is the default first-class source, the curated community market is the reviewed fallback, and Global GitHub remains a candidate-discovery input rather than an installation shortcut. DSHMK loads live catalog and detail metadata, writes a last-known-good cache, and falls back to a bundled 2,888-entry snapshot; its tags and categories come from synchronized source metadata rather than a hardcoded complete taxonomy. A cached page is shown immediately when available, then the native launcher refreshes the live catalog in the background and notifies the page so the provenance badge changes to live without requiring a HUB restart. The curated community market independently loads the live `awesome-dsh-plugin` registry, caches it locally, and falls back to its bundled snapshot.

DSHMK and curated browsing provide localized search, category and validation filters, popularity/newness sorting, persisted page sizes of 12, 24, 48, 96, or 200, nearby page numbers, and bounded loading with retry. DSHMK cards expose a dedicated Details button beside one-click Setup by default, while CONFIG can restore whole-card detail activation. The detail includes provenance, license, validation evidence, declarations, permissions, compatibility, releases, installation guidance, related projects, and a prominent Setup action; CONFIG independently selects a side panel, themed modal, or full-surface presentation and can request contained original-site content instead. Closing details restores the originating filters, page, and scroll position.

One-click Setup never treats extraction into the HUB library as installation and never executes catalog command text. The native launcher resolves an immutable GitHub commit or npm release, restricts downloads to supported artifact hosts, enforces a 256 MB limit, computes SHA-256, stores the artifact in the CLI content-addressed cache, and constructs a normal Setup manifest. A Setup-style progress surface owns preflight, download, extraction, dependency installation, profile mutation, Bundle activation, post-install verification, logs, timeout, cancellation, retry, and terminal reset. Successful activation records a receipt and silently reloads the running Desktop service when needed; unsupported monorepo or custom-command cases fall back to the local Setup builder.

A user may connect GitHub with an access token to read their account and starred repositories; the token is validated against GitHub, encrypted with Windows DPAPI for the current user, and never returned to the WebView. Starred and global-search results can generate editable drafts for AI-assisted local building, but AI does not manufacture trust evidence or bypass the Setup protocol.

The native launcher owns `%LOCALAPPDATA%\DeepSeekHarness\hub`: `library` contains editable workspaces with `setup.json`, `options.schema.json`, and bilingual AI-editing guidance; `offline` is a non-executing drop folder; and `installed.json` records Setups installed through HUB. Profile bundles and newly added profile packages receive a real removal action. Standalone installers remain delegated to Windows Apps & features unless a reviewed uninstaller exists.

Certified, GitHub-source, and unverified entries remain visibly distinct. Non-certified entries require an explicit evidence acknowledgement in HUB and a second native confirmation. Browser-only sessions may inspect the catalog but cannot install; the desktop WebView bridge accepts only messages from the active loopback application origin, owns one installation at a time, and returns the final result.

The shipped reviewed catalog includes the in-box full-capability pack and pinned GitHub-source candidates that passed metadata, license, archive-hash, package-layout, and archive-install checks. The larger community market is a separate curated discovery source, not a certification authority. Its interaction and installation design is informed by the MIT-licensed `dsh-market`; its bundled catalog data comes from the CC0 `awesome-dsh-plugin` project, with notices shipped beside the launchers.

The sidebar provides a localized Plugin market icon above Settings, with matching icon alignment and expanded/collapsed hit areas. Desktop sessions open or foreground the existing HUB through the native command; browser sessions navigate to the same-origin HUB preview without gaining installation privileges.

When an online refresh fails but a saved catalog is usable, a localized, non-blocking notice preserves browsing. Technical diagnostics remain collapsed until requested; the toolbar refresh button retries the request without duplicating actions inside the notice.

DSHMK's refresh action bypasses the in-memory catalog and requests HTTP revalidation. Concurrent native refresh requests share one transfer. Existing cards remain visible while refreshing and after a network failure, with retry feedback; filters and page selection remain intact. Source generation time and last successful synchronization are separate fields. A snapshot read from disk is cached data, even when it was downloaded online earlier. Refreshing a snapshot endpoint cannot discover changes that its publisher has not included in that snapshot; continuous provider updates and automatic periodic refresh are not implemented.

## Desktop CONFIG

CONFIG is available from the HUB system sidebar as well as the header and regular Settings. Its form scrolls independently of the bottom action area; fields cannot appear beneath Save and restart. HUB configuration includes optional preload after Desktop readiness: a one-minute startup/catalog budget followed by renderer sleep. The local service remains running for fast activation; this is not whole-process suspension or zero memory use. The standalone CONFIG entry remains available.

The Settings CONFIG section and HUB header open the same embedded editor. DSH and HUB are separate targets; changes remain drafts until saved. The enabled green Save and restart action validates and saves changed fields, then requests a restart of the selected application. Failed saves retain the draft. Leaving or switching targets offers keep editing, discard, or save and leave; the latter applies saved settings on the next application start. Native close also warns about outstanding changes.

The native bridge rejects stale revisions, unsupported fields and invalid values, preserves unedited fields and stores a previous-file backup before atomic replacement. Runtime paths, extensions, hotkeys, resolution presets, loading, fullscreen and market preferences remain editable. Independent CONFIG stays available for first-run setup and native file pickers. Its launcher passes the calling window as owner and preserves explicit data/home/instance arguments.

Window controls default to the system style. The optional traffic-light style supplies close, minimize and maximize/restore actions in normal windows, with caption dragging and edge resizing; fullscreen retains its existing presentation. DSH and HUB choose this style independently. Close follows the selected exit/tray policy.

## Component inventory

HUB and component Settings share source, data-home/Profile and management-state filters, multi-term search, result counts and reset. Equal Profile names in different homes remain separate choices. Both views retain results and filters during refresh or failure. Copy diagnostics exports selected package metadata and local paths, not raw configuration contents or credentials; blocked clipboard access exposes selectable text. A shared dependency, missing target metadata or unsupported removal method disables the action and explains why before the existing native revalidation runs.

The component inventory combines HUB receipts with direct dependencies and bundle declarations in the active DSH home and the current user's default `.dsh` home. Rows distinguish their home, Profile, source, and declaration/package-file state; neither a receipt nor a package file proves runtime activation. External components support configuration-location and path-copy actions. A rescan reflects external changes without replacing retained receipts, and preserves search and previous results while pending or failed. Unreadable profiles produce visible partial-scan warnings.

External enable/disable/update/uninstall requires an owning-runtime adapter and is not offered by this scanner. Arbitrary additional homes and Cordis-only entries without package declarations remain outside discovery. The [inventory decision](../../../.agents/notes/implemented/bug-fix/2026-09-29-hub-profile-inventory-reconciliation.md) defines the reconciliation and verification boundary.

## Model Experience

None, as HUB is a user-operated installation surface that registers no model prompt or tool.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The reviewed Setup catalog remains shipped with the signed Web assets. The larger live community registry is discovery metadata only and cannot assert DSH certification.
- Download stages expose bounded progress and logs, but exact transferred-byte progress remains deferred for sources that do not report a stable content length.
- GitHub sign-in currently uses a user-supplied access token. OAuth device flow requires a registered project OAuth App and client ID before it can replace this fallback.
- No invariant companion is published because the UI renders validated declarations and owns no independent runtime relation to observe.
