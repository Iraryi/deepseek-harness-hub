# dsh-client-ui-setup-hub

English | [中文](README.zh.md)

The DSH HUB tab inside Web/Desktop Plugin settings. It reads a Setup registry lazily, sorts and searches entries, and renders the complete source, license, digital-signature, audit, compatibility, permission, network, and artifact declarations before exposing installation.

Windows also exposes a complete workspace through the dedicated `dsh-hub.exe` entry. This entry owns the full WebView2 canvas rather than opening a browser or nesting another application window, provides native CONFIG and a normal-Desktop action that starts the separate `dsh.exe` process, and adapts navigation, filters, cards, and action rows for constrained high-DPI windows without overlapping controls.

The dedicated workspace uses functional navigation instead of category navigation: Home, GitHub discovery, reviewed catalog, the authenticated user's starred repositories, the local Setup library, the offline inbox, installed Setups, the Setup builder, a dedicated GitHub account surface, and the security center. Home summarizes each data plane and exposes direct folder and creation actions. Credentials can be entered only on the account surface; discovery and starred views never render token fields.

Discovery has three explicit sources in priority order. DSHMK is the default first-class source, the curated community market is the reviewed fallback, and Global GitHub remains a candidate-discovery input rather than an installation shortcut. DSHMK loads live catalog and detail metadata, writes a last-known-good cache, and falls back to a bundled 2,888-entry snapshot; its tags and categories come from synchronized source metadata rather than a hardcoded complete taxonomy. The curated community market independently loads the live `awesome-dsh-plugin` registry, caches it locally, and falls back to its bundled snapshot.

DSHMK and curated browsing provide localized search, category and validation filters, popularity/newness sorting, persisted page sizes of 12, 24, 48, 96, or 200, nearby page numbers, and bounded loading with retry. DSHMK cards expose a dedicated Details button beside one-click Setup by default, while CONFIG can restore whole-card detail activation. The detail includes provenance, license, validation evidence, declarations, permissions, compatibility, releases, installation guidance, related projects, and a prominent Setup action; CONFIG independently selects a side panel, themed modal, or full-surface presentation and can request contained original-site content instead. Closing details restores the originating filters, page, and scroll position.

One-click Setup never treats extraction into the HUB library as installation and never executes catalog command text. The native launcher resolves an immutable GitHub commit or npm release, restricts downloads to supported artifact hosts, enforces a 256 MB limit, computes SHA-256, stores the artifact in the CLI content-addressed cache, and constructs a normal Setup manifest. A Setup-style progress surface owns preflight, download, extraction, dependency installation, profile mutation, Bundle activation, post-install verification, logs, timeout, cancellation, retry, and terminal reset. Successful activation records a receipt and silently reloads the running Desktop service when needed; unsupported monorepo or custom-command cases fall back to the local Setup builder.

A user may connect GitHub with an access token to read their account and starred repositories; the token is validated against GitHub, encrypted with Windows DPAPI for the current user, and never returned to the WebView. Starred and global-search results can generate editable drafts for AI-assisted local building, but AI does not manufacture trust evidence or bypass the Setup protocol.

The native launcher owns `%LOCALAPPDATA%\DeepSeekHarness\hub`: `library` contains editable workspaces with `setup.json`, `options.schema.json`, and bilingual AI-editing guidance; `offline` is a non-executing drop folder; and `installed.json` records Setups installed through HUB. Profile bundles and newly added profile packages receive a real removal action. Standalone installers remain delegated to Windows Apps & features unless a reviewed uninstaller exists.

Certified, GitHub-source, and unverified entries remain visibly distinct. Non-certified entries require an explicit evidence acknowledgement in HUB and a second native confirmation. Browser-only sessions may inspect the catalog but cannot install; the desktop WebView bridge accepts only messages from the active loopback application origin, owns one installation at a time, and returns the final result.

The shipped reviewed catalog includes the in-box full-capability pack and pinned GitHub-source candidates that passed metadata, license, archive-hash, package-layout, and archive-install checks. The larger community market is a separate curated discovery source, not a certification authority. Its interaction and installation design is informed by the MIT-licensed `dsh-market`; its bundled catalog data comes from the CC0 `awesome-dsh-plugin` project, with notices shipped beside the launchers.

## Model Experience

None, as HUB is a user-operated installation surface that registers no model prompt or tool.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The reviewed Setup catalog remains shipped with the signed Web assets. The larger live community registry is discovery metadata only and cannot assert DSH certification.
- Download stages expose bounded progress and logs, but exact transferred-byte progress remains deferred for sources that do not report a stable content length.
- GitHub sign-in currently uses a user-supplied access token. OAuth device flow requires a registered project OAuth App and client ID before it can replace this fallback.
