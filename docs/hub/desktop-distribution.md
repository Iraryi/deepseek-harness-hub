# Project Boundary

[中文](desktop-distribution.zh.md)

HUB and Desktop are separate formal projects. HUB owns its source, Setup build system, formal Setup artifacts, catalog, and release channel. Desktop is not a hidden dependency of HUB releases.

## `deepseek-harness-hub`

- Complete HUB source tree, including the native HUB host, Web UI, Runtime, Setup builder, Setup Registry, schemas, tests, and catalog adapters.
- User-facing project home and download channel.
- Setup Registry, schemas, submission workflow, and curated package policy.
- Release notes, checksums, and published HUB-only Windows Setup assets.

## `deepseek-harness-desktop`

- Independent Desktop product source and Desktop-only Windows distribution.
- Desktop WebView2 hosting, taskbar identity, tray behavior, process ownership, and first-run routing.
- Desktop Runtime and Desktop Setup assets when the Desktop project chooses to publish them.

The Desktop repository name remains unchanged for continuity. Its category is **Desktop product**, not the HUB implementation or HUB release channel.

## Release handoff

HUB CI or a maintainer build produces the HUB Setup, HUB Runtime, portable package, release manifest, checksums, and update log in this repository. Desktop assets are never copied into a HUB release merely because both projects use DSH.
