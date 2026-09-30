# Agent Note: HUB library persistence across the Setup lifecycle

Status: implemented

English | [中文](2026-08-22-hub-library-persistence-across-setup-lifecycle.zh.md)

## Problem

HUB stores installed Setup records and their editable workspaces under the active application data root. Portable uninstall retained the `data` directory but removed `portable.mode`, so a later launcher could select the standard data root and present an empty installed library even though every record and workspace still existed. An unreadable `hub/installed.json` also appeared as an empty library without attempting recovery.

## Decision

`AppPaths.IsPortable` recognizes both the application marker and owned portable data. A portable data root is identified by `.dsh-portable-data`, `config.json`, or the owned `hub` or `dsh` directories. The installer creates the portable data directory and both markers before seeding configuration, retains them when uninstall keeps user data, and removes them only when delete-data is explicitly selected. Recommended reinstall also selects portable mode from retained owned data, including data created by installers that removed `portable.mode` during uninstall.

`hub/installed.json`, `hub/library`, Setup receipts, offline packages, account data, and catalog state remain user data outside replaceable Runtime and launcher files. Installed-record writes retain one valid `installed.json.backup`. Reads recover the primary file from that backup when necessary and rebind each existing workspace to the active `hub/library/<setup-id>` directory, so a retained or moved portable data root does not keep stale absolute workspace paths.

## Alternatives considered

[Profile inventory reconciliation](2026-09-29-hub-profile-inventory-reconciliation.md) complements retained receipts with external component observations; it does not reconstruct or replace Setup history.

**Store HUB records beside the executable as application files.** Rejected because update, repair, and uninstall own that directory and must be free to replace binaries without risking user-managed Setup workspaces.

**Reconstruct installed state only from DSH profile dependencies.** Rejected because the profile does not retain the Setup manifest, provenance, receipt, editable workspace, uninstall metadata, or a stable mapping from one package dependency to one HUB entry.

**Remove the portable marker while keeping portable data.** Rejected because marker removal makes the retained data ambiguous and caused the launcher to select a different root. Legacy content detection remains as a recovery path, not the normal identity mechanism.

**Automatically copy retained portable data into the standard root.** Rejected because both roots may contain intentional and independently newer state. Reinstall preserves the selected root instead of merging unrelated sessions, credentials, or plugin records.

## Consequences

The [Setup retention helpers](../../../../windows/setup/README.md) preserve existing configuration bytes on retained-data reinstall and retain the previous Runtime after replacement. Root selection honors a custom application data directory; implicit standard/portable migration is blocked. A persistent transaction journal stops retries until an interrupted switch has been inspected. These protections do not implement a session-format migration or guarantee activation of plugins modified inside an older Runtime.

Update and repair replace application and Runtime files while preserving the installed Setup library. Default uninstall may leave the application directory because portable user data and its identity marker remain there by design. Explicit delete-data removes both standard and portable roots plus the portable marker. Installed-record recovery retains one prior valid snapshot and favors the workspace that exists under the active HUB library root.

## Testing

Promotion tests use a separate watcher to hold a staging file during validation and switching, then release it. Bounded retries complete the same-directory switch and retain the old Runtime; permanent locks still fail without replacing it. This models transient Windows handle contention, not proof of which application held a particular user's directory. The packaged Runtime also requires a real-archive replacement check; a version-only executable fixture cannot establish its behavior.

The isolated [retention harness](../../../../windows/setup/tests/verify-upgrade-retention.ps1) executes production Setup helpers with version-only Runtime fixtures and compares file hashes across standard, portable and custom roots. It covers archive/folder replacement and non-destructive rejection of malformed, locked and interrupted states. These checks do not run a historical installer, boot the application or qualify the official Desktop migration. Host-mutating legacy smoke scripts must not run on a user's computer.

The Windows launcher build compiles the portable-root detection and installed-record recovery paths. Focused HUB smoke coverage loads a retained installed record through the native snapshot path, corrupts the primary index, recovers the backup, and rebinds a stale workspace path. Setup smoke coverage exercises standard update retention and repeated portable install, update, keep-data uninstall, marker-less legacy reinstall, native HUB loading, and explicit delete-data cleanup. Full and Lite Inno Setup assets compile from the same hotfix sources and packaged Runtime.
