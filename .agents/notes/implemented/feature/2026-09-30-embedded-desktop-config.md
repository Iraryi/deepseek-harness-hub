# Agent Note: Embedded Desktop CONFIG with guarded drafts

Status: implemented

English | [中文](2026-09-30-embedded-desktop-config.zh.md)

## Problem

An independently launched CONFIG window can be obscured by HUB, and a detached editor does not participate in the Settings navigation lifecycle. Users need visible pending changes, explicit save/restart, guarded departures and an optional traffic-light caption without losing independent DSH/HUB settings or standalone setup.

## Decision

The HUB plugin contributes a CONFIG settings section and uses the same editor in its dedicated workspace. The owning shell supplies an optional asynchronous departure guard. The editor retains local drafts and offers keep, discard or save-and-leave; failed saves retain the draft. Save-and-restart writes the selected target first and requests restart only after success. Browser-only sessions cannot edit native configuration.

The native editor validates an allowlisted patch against known configuration fields, checks a SHA-256 file revision, preserves unrelated and unknown fields, and replaces the file atomically with a previous-file backup. DSH and HUB remain separate files. Configuration restarts reconstruct the selected native form and hosted service while retaining its instance mutex; a sibling reconfiguration uses a distinct signal and leaves the initiating application running. Running Setup work blocks reconfiguration. This is not session-format migration or an update to the official Electron baseline.

Independent CONFIG receives its invoking window as native owner and is explicitly brought forward. Companion launches carry data/home/instance arguments. The existing [standalone save-and-run handoff](2026-08-21-config-shell-handoff.md) remains in place for first-run setup; it is not superseded by the embedded editor.

The optional traffic-light caption is separately stored for DSH and HUB. Normal windows receive native close/minimize/maximize controls, caption dragging and edge resizing. Fullscreen modes retain their existing controls. System chrome remains the default, and the red close action honors the configured tray/exit policy.

## Alternatives considered

Making CONFIG permanently topmost would obscure unrelated applications. Removing standalone CONFIG would break onboarding and native file picking. Replacing complete configuration documents from the Web UI would discard fields unknown to that UI. Globally intercepting clicks would block unrelated controls and couple feature packages; the settings owner instead guards only its navigation.

## Consequences

Save-and-leave defers applying native settings until the selected application next starts. A saved configuration whose restart fails remains saved and exposes retry. Native close uses a default-cancel confirmation if a draft is outstanding. Revision conflicts are surfaced rather than merged silently; an external writer that ignores this protocol is not a transaction participant.

## Verification

Focused tests exercise draft state, save-before-restart, failed-save retention, target switching, departure decisions and settings-shell close paths. Built-client integration exercises Chinese/English and DSH/HUB entry points. Isolated D: native fixtures cover preservation, invalid values, conflicts, backups and configuration-target separation. Static 1024x768 light/dark renders check the editor and decision layout; offscreen native renders check the caption controls. These do not qualify real installed-path foreground ordering, cross-process restart under load or the complete DPI/fullscreen matrix. No Setup package or host installation is changed by these tests.
