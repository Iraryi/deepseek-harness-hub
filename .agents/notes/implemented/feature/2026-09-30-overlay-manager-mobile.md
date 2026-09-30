# Agent Note: Overlay management and explicit mobile access

Status: implemented

English | [中文](2026-09-30-overlay-manager-mobile.zh.md)

## Problem

A full bundled distribution cannot also serve users who retain an existing DSH installation. HUB needs working management actions rather than roadmap-only switches, without rewriting the user's sessions or making a localhost service public by default.

## Decision

Overlay has a separate installer identity, owned payload, state directory and explicit host/runtime/home binding. Its versioned adapter redirects selected built packages through a process-local Node resolver, including native service starts after a CONFIG handoff. The base executable and Runtime are not replaced. Full remains a separate distribution. An unqualified runtime requires an adapter rather than a guessed migration.

The HUB management sidebar exposes read-only runtime facts, optional desktop enhancements and phone access. Enhancement saves use a separate file, revision checks, an exact prior-file backup and atomic replacement; foreign fields survive. Width, rich-text paste and optional session identifiers use a presentation adapter with teardown, not session-data mutations. A verified-ready callback reapplies saved settings after a service restart in the same WebView. Unsaved editor navigation and native close are guarded; CONFIG remains standalone and embedded.

Phone access is an explicitly enabled private-IPv4 HTTP relay to the existing DSH UI. A short-lived single-use pairing grant creates revocable device sessions; HTTP requests and WebSocket upgrades authenticate before contacting DSH. The relay exchanges the DSH launch token privately and retains its cookie in memory. Desktop discovery protects the launch URL with current-user DPAPI and associates it with the live owner process. Public status omits credentials. Stopping the relay or exiting HUB closes owned streams and the child process; no firewall or Shell Folder settings change.

## Alternatives considered

Replacing the base installation makes add-on removal and rollback own unrelated files. Copying an entire alternate Runtime is Full under another name. Inferring session formats from filesystem names risks data corruption. Reusing an unauthenticated localhost URL on the LAN bypasses the intended local trust model. Hard-freezing processes can retain locks and interrupt work.

## Consequences

HTTP is not encrypted: pairing does not defend against a hostile LAN observer. The UI requires explicit trusted-LAN consent, describes full operator access, and offers revoke and stop; previously accepted DSH tasks are not cancelled. TLS, public tunnels, WeChat, arbitrary official-Desktop versions and session-format migrations are not implied by this adapter. Native window settings and the bounded preload remain available. Existing provider controls and upstream scroll restoration are preserved instead of being replaced with empty toggles.

## Verification

Full and Lite explicitly install the same enhancement/mobile launcher assets; a file-by-file manifest check rejects missing entries or misplaced destinations. Full embeds matching built client packages in its Runtime, so installing Overlay is not required to obtain management and phone access. Explicit entries avoid recursively packaging test fixtures or credentials from a developer's launcher directory.

Verification covers isolated settings conflict/backup/validation and encrypted endpoint discovery; actual composer paste and adapter teardown; bilingual assembled management actions and constrained browser layouts; authenticated HTTP/WebSocket pairing, expiry, revocation and shutdown; and Overlay path separation, retention, resolver selection and served package identity on a copied Runtime. Engineering Setup compilation is separate from installed-upgrade and physical-phone acceptance. Fixtures stay on D: without host registry or real-profile mutation.
