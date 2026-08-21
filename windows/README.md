# DeepSeek Harness Desktop for Windows

English | [中文](README.zh.md)

This project is the Windows **Desktop** product only. It owns the normal Desktop window, Desktop CONFIG, Desktop Runtime, and Desktop Setup pipeline. DSH HUB is a separate formal project at [`Iraryi/deepseek-harness-hub`](https://github.com/Iraryi/deepseek-harness-hub); Desktop does not contain or require the HUB application.

## Distribution boundary

- Desktop releases contain `dsh.exe` and `dsh-config.exe`.
- Desktop releases do not contain `dsh-hub.exe`, HUB catalogs, HUB shortcuts, or HUB-only Setup pages.
- Desktop user data, Runtime data, extensions, caches, and logs remain outside the EXE.
- HUB installation, catalog discovery, Setup library management, and HUB Setup releases belong to the HUB repository.

## Install

Use the Desktop repository's Releases page for Desktop assets. The recommended Full Setup carries the private Node.js Runtime and the WebView2 offline installer. Lite Setup can download or import a verified Runtime ZIP. Portable builds require WebView2 to already be installed.

Normal Desktop installation does not require system Node.js, npm, pnpm, Git, or a development environment. The first launch routes through `dsh-config.exe`, which owns Desktop language, resolution, fullscreen, loading, tray, extension, and Web UI settings.

## Build

From a Windows x64 checkout with Node.js 24, pnpm, the .NET Framework compiler, and Inno Setup 6:

```powershell
pnpm install --frozen-lockfile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/release/build.ps1
```

The default launcher build intentionally omits HUB. `windows/launcher/build.ps1 -IncludeHub` is reserved for transitional local diagnostics and is not used by the Desktop release pipeline.

## Data and uninstall

Standard data lives under `%LOCALAPPDATA%\DeepSeekHarness`. Portable data lives beside the Desktop executable. Upgrade and uninstall preserve user-created data while removing Desktop-owned Runtime and launcher files. HUB data is never managed by the Desktop uninstaller.
