# Agent Note: Packaged Desktop startup across CLI and browser authentication

Status: implemented

English | [中文](2026-09-12-packaged-desktop-startup.zh.md)

## Problem

A fresh installation of HUB alpha.2 hub.3 exits its local service with `unknown option '--patch'`: the native command places the Web app's `--no-open` before the launcher's `--patch`, but the CLI forwards every token after its first unknown option to the app. Correcting that command reveals two integration gaps: authentication discards the native routing query and the upstream Web kernel refactor omits the structured boot reports expected by Desktop. Mock service tests accept the broken command and cannot detect either browser issue.

## Decision

The native command passes launcher-owned patches before Web app arguments. BrowserAuth removes authentication tokens while preserving other root-query parameters during both fresh-token and stale-token redirects. AppWebEntry reports navigation-scoped progress and terminal state through WebView2, with readiness emitted after plugin activation and application mount. Pending-only failures retain the existing single-retry policy. This restores the mechanism owned by the [Desktop distribution note](../feature/2026-08-14-windows-desktop-distribution.md) and preserves the [HUB executable routing decision](2026-08-22-hub-executable-surface-activation.md).

Startup errors have a visible native panel even when loading animation is disabled. It exposes scrollable diagnostics, retry, CONFIG, log, and copy actions. Native logs redact URL authentication tokens. Retry resets the loading state and restarts only the owned service. A late browser-initialization event cannot replace a terminal error with loading progress.

## Alternatives considered

**Change CLI parsing to accept arbitrary flag order.** Rejected because its deliberate pass-through semantics belong to upstream; the Desktop command must follow them.

**Consider a loaded HTTP page sufficient.** Rejected because HTTP success cannot prove plugin activation, native bridge health, or that HUB is displaying its own interface.

**Remove authentication or clear existing profiles.** Rejected because neither fixes argument ordering or the missing lifecycle reports, and profile deletion would destroy unrelated user data.

## Consequences

The package smoke uses actual EXEs and an extracted Runtime with fresh explicit data paths, an isolated instance identity, and a system-only PATH. It requires structured Web readiness and a 15-second healthy period, retains diagnostic evidence, and does not modify Windows Shell Folders. Focused tests cover query preservation, token removal, successful mount, pending entries, and import failures. This is local packaged-runtime evidence, not a claim of testing the user's remote computer.
