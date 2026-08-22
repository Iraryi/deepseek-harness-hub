# Agent Note: DSHMK installation survives catalog candidate regression

Status: implemented

[中文](2026-08-22-dshmk-install-snapshot-fallback.zh.md) | English

## Problem

The DSHMK live catalog can retain a repository while changing a previously usable single install candidate into an ambiguous or local-only entry. The detail view should reflect the live catalog, but an install request must not lose a known-good candidate merely because the background refresh arrived between browsing and installation.

Pinned archive verification also failed on repeated installation when npm stored only a content-addressed local `.tgz` path in the Web Profile.

## Decision

Keep the live catalog for browsing, details, and live metadata. For installation only, use the current repository when it has a supported one-click candidate; otherwise try the previous in-session snapshot and then the bundled snapshot, selecting the first installable entry. If none is installable, return the terminal catalog error without creating an installed record.

Pass the verified Setup artifact SHA-256 into Profile activation verification. A dependency matches when it is newly added, names the resolved npm package, contains the repository or commit identity, matches the artifact digest in its cached path, or exposes matching package source metadata.

## Alternatives considered

**Freeze the first catalog response for the entire HUB session.** Rejected because browsing and details would stop receiving corrected metadata, tags, and validation results.

**Accept every dependency present after installation as proof of activation.** Rejected because unrelated existing packages could produce a false success and an installed HUB record without the requested plugin.

**Delete package-manager caches before every repeated install.** Rejected because it makes installation slower and still does not establish source identity when the package manager rewrites a dependency to a local archive path.

## Consequences

Background catalog refreshes can improve metadata without invalidating an installation already presented to the user. Stale DSHMK candidates fail visibly and leave no partial HUB record. Repeated installs of pinned GitHub archives remain attributable even when the package manager rewrites their dependency spec to a local cache path.

## Testing

The extended DSHMK smoke passed first and repeated installation for eight real plugins plus the existing sidebar and Web-client cases. It also verified fallback for a live catalog regression, explicit failure for an expired npm candidate, activation/package-set stability, duplicate-record prevention, and absence of Unicode replacement characters. Full and Lite Setup smoke passed after rebuilding the Launcher and Setup packages.
