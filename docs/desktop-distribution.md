# Desktop Distribution Boundary

The ecosystem is split across two repositories without splitting the product experience.

## `deepseek-harness-hub`

- User-facing project home and download channel.
- HUB product direction and ecosystem architecture.
- Setup Registry, schemas, submission workflow, and curated package policy.
- Release notes, checksums, and published Windows assets.

## `deepseek-harness-desktop`

- Fork/source integration of DeepSeek Harness.
- Native Windows launchers: Desktop, HUB, and CONFIG.
- WebView2 hosting, taskbar identity, tray behavior, process ownership, and first-run routing.
- Runtime construction, Setup compiler source, smoke tests, and release assembly.

The Desktop repository name remains unchanged for continuity. Its category is **Windows implementation and distribution layer**, not the entire HUB ecosystem.

## Release handoff

Desktop CI or a maintainer build produces Full Setup, Lite Setup, Runtime ZIP, Portable ZIP, release manifest, checksums, and notes. Those assets are published to the matching HUB release tag. Runtime download URLs embedded in Lite Setup resolve against HUB Releases.
