# Agent Note: HUB executable surface activation

Status: implemented

[中文](2026-08-22-hub-executable-surface-activation.zh.md) | English

## Problem

The native `dsh-hub.exe` entry detected HUB mode and appended `dshSurface=hub`, but the shipped Web profile did not mount the HUB client plugin. The native window therefore had HUB identity while rendering the ordinary DSH surface.

## Decision

The `dsh-web-app` bundle declares `@deepseek-ai/dsh-client-ui-setup-hub` as a runtime dependency and inserts it into the browser plugin roster as `ui-setup-hub`. The plugin remains in the shared Web profile and activates its full-surface overlay only when the native launcher supplies `dshSurface=hub`; ordinary `dsh.exe` launches continue to render DSH.

## Alternatives considered

**Create a separate HUB server profile:** Rejected because it would duplicate the Web composition and allow the native and browser surface contracts to drift.

**Render HUB from native WinForms controls:** Rejected because HUB is a Web UI surface and must retain the existing plugin, theme, and future Web UI extension path.

## Consequences

The runtime must carry the HUB client package and the Web roster must keep its row. A launcher-only rebuild is insufficient; the frontend bundle and packaged Runtime must be rebuilt together. The focused bundle test now guards both the dependency declaration and roster entry.
