# HUB source layout

The `implementation/` directory is the complete, buildable source context for DeepSeek Harness HUB. It is included here so HUB development, review, and customization do not depend on the Desktop repository or unpublished packages.

## Primary customization points

| Area | Path |
| --- | --- |
| HUB catalog, home, filters, details, install surfaces, and themes | `implementation/packages/client/ui-setup-hub/` |
| Setup manifest and evidence model | `implementation/packages/setup/protocol/` |
| Maintained and cached Setup registry | `implementation/packages/setup/registry/` |
| Native WebView2 host, tray, process lifecycle, GitHub account, downloads, and install bridge | `implementation/windows/launcher/src/MainApp.cs` |
| Desktop/HUB configuration model | `implementation/windows/launcher/src/Config.cs` |
| Native CONFIG interface | `implementation/windows/launcher/src/ConfigApp.cs` |
| Bundled DSHMK and curated fallback catalogs | `implementation/windows/launcher/assets/` |
| Self-contained Node.js and pnpm Runtime assembly | `implementation/windows/runtime/` |
| Windows installer and release assembly | `implementation/windows/setup/` and `implementation/windows/release/` |

## Shared DSH build context

HUB runs on DeepSeek Harness, so `implementation/` retains the packages, applications, vendored Cordis source, workspace manifests, tests, and build scripts required to produce a reproducible Runtime. These files are build dependencies inside the HUB repository; they do not make the Desktop application part of a HUB release.

HUB-specific releases must package `dsh-hub.exe`, HUB configuration, the Runtime, WebView2 dependencies, catalogs, notices, and Setup metadata. They must not publish `dsh.exe` or Desktop shortcuts as HUB assets.

## Development commands

```powershell
npm run build:hub
cd implementation
pnpm install --frozen-lockfile
pnpm --filter @deepseek-ai/dsh-client-ui-setup-hub test
```

The repository-level build command is the supported entry for Windows artifacts. Package-level commands are intended for focused development and tests.
