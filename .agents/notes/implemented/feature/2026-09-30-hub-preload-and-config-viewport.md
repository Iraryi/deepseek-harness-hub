# Agent Note: Bounded HUB preload and CONFIG viewport

Status: implemented

English | [中文](2026-09-30-hub-preload-and-config-viewport.zh.md)

## Problem

An outer padded scrolling container leaves form controls visible below a sticky CONFIG action bar. Opening a separate HUB process also repeats service and renderer startup on the user's navigation path.

## Decision

CONFIG owns a full-height flex viewport with a scrolling form and a non-scrolling footer. The Settings shell removes its own padding and scrolling around the marked viewport. The HUB system sidebar opens the same guarded editor; standalone CONFIG remains available.

HUB preferences include enabled-by-default, user-disableable `PreloadOnDesktopStart`. Five seconds after Desktop reports structured Web UI readiness, Desktop requests a separate hidden HUB with the same data/home/instance identity. An already running HUB ignores preload requests. Background startup does not display the taskbar entry, tray icon, duplicate-instance notice or startup-error dialogs. It has a one-minute startup/catalog budget and cancels HTTP acquisition before committing a cancelled catalog; existing snapshots remain available.

A ready background HUB hides its WebView control before requesting renderer suspension, yielding to visibility handling first. This uses [WebView2 page suspension](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.trysuspendasync?view=webview2-dotnet-1.0.4129.50), not forced suspension of Node or file operations. Activation resumes the renderer and claims independent lifetime. An unclaimed instance observes its initiating Desktop process and exits when that process ends; unavailable or late startup falls back to ordinary user-initiated startup.

## Alternatives considered

Preloading before Desktop readiness competes with its critical startup path. Freezing the entire process tree can interrupt installation and retain locks. Repeated background polling adds work without user navigation. A fake progress timer cannot improve service startup latency.

## Consequences

The local service remains running and consumes memory while the renderer sleeps. WebView suspension is best effort; a declined request is logged rather than advertised as successful. An offline or slow source retains cached data; the one-minute budget does not guarantee a fresh catalog. Opening HUB before preload is complete still requires the remaining startup work. New frontend assets and native launchers must be deployed together.

## Verification

The isolated native fixture boots a copied real Runtime with separate data and home paths, waits beyond the warm budget, verifies renderer suspension, ignores duplicate preload, activates the same process and requests graceful exit. A loopback HTTP fixture verifies cancellation of an in-flight request. CONFIG persistence tests exercise the preload default and opt-out. Assembled bilingual settings tests and real-browser geometry checks cover both scroll extremes at 1024×768 and 1440×900. These do not qualify every native DPI configuration or live-market network condition. Tests never modify host Shell Folders or real user profiles.
