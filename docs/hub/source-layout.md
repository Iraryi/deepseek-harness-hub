# HUB source layout

The repository root is the complete, buildable source context for DeepSeek Harness HUB. HUB development, review, and customization do not depend on the Desktop repository or unpublished packages.

## Primary customization points

| Area | Path |
| --- | --- |
| HUB catalog, home, filters, details, install surfaces, and themes | `packages/client/ui-setup-hub/` |
| Setup manifest and evidence model | `packages/setup/protocol/` |
| Maintained and cached Setup registry | `packages/setup/registry/` |
| Native WebView2 host, tray, process lifecycle, GitHub account, downloads, and install bridge | `windows/launcher/src/MainApp.cs` |
| Desktop/HUB configuration model | `windows/launcher/src/Config.cs` |
| Native CONFIG interface | `windows/launcher/src/ConfigApp.cs` |
| Bundled DSHMK and curated fallback catalogs | `windows/launcher/assets/` |
| Self-contained Node.js and pnpm Runtime assembly | `windows/runtime/` |
| Windows installer and release assembly | `windows/setup/` and `windows/release/` |

## Shared DSH build context

HUB runs on DeepSeek Harness, so this repository retains the packages, applications, vendored Cordis source, workspace manifests, tests, and build scripts required to produce a reproducible Runtime. These are first-class HUB project files; they do not make the Desktop application part of a HUB release.

HUB-specific releases must package `dsh-hub.exe`, HUB configuration, the Runtime, WebView2 dependencies, catalogs, notices, and Setup metadata. They must not publish `dsh.exe` or Desktop shortcuts as HUB assets.

## Development commands

```powershell
npm run build:hub
pnpm install --frozen-lockfile
pnpm --filter @deepseek-ai/dsh-client-ui-setup-hub test
```

The repository-level build command is the supported entry for Windows artifacts. Package-level commands are intended for focused development and tests.
