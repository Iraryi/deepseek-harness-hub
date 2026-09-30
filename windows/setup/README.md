# Setup data retention

English | [中文](README.zh.md)

## Summary

This reference describes the Windows Setup helpers, not a qualified migration to the official Electron Desktop. Existing user data is not an installation payload.

Full and Lite share explicit launcher payload entries for Desktop/HUB/CONFIG, catalogs, the enhancement script and the mobile relay/pairing assets. Full also embeds the Runtime with matching built client packages; Overlay remains a separate add-on distribution, not a prerequisite for these features. `tests/verify-launcher-payload.ps1 -LauncherDirectory <clean-launcher-output>` verifies every launcher file's installer destination and build preflight requirement without executing Setup. New launcher assets must update both the shared Inno manifest and build requirements.

## Storage and replacement

Configuration seeding follows `DEEPSEEK_HARNESS_DATA_DIR`, then the selected portable or standard root. Existing JSON objects remain byte-for-byte unchanged, including unknown nested settings, language and onboarding state. Invalid configurations stop seeding without replacing them with defaults. First-run settings use a same-directory rename that refuses to overwrite an existing file.

Setup rejects a standard/portable switch when it would hide retained data. It does not merge roots. An existing `DSH_HOME` remains authoritative; a new default home is derived from the selected application data directory.

Runtime replacement validates a staged payload before renaming the old Runtime to `.runtime-backup-<operation>` beside it. The backup remains after success, including local modifications. These files are recovery material, not automatically activated plugins, and consume disk space until deliberately reviewed and removed. External profiles, HUB receipts, sessions and workspace files are outside this replacement.

Replacement rejects a configured data/home path inside Runtime and linked destination ancestors. Folder imports reject links; temporary cleanup retains linked trees rather than following them. Same-volume directory renames avoid partially moving a locked Runtime. An ordinary promotion failure restores the old directory when the destination is absent.

## Interrupted updates

Directory switches retry Windows access-denied, sharing and lock errors for up to ten seconds, including restoration of the old Runtime. They never fall back to recursive copying, destination removal, ACL changes or elevation. A persistent error names both directories and the Windows error code; successful task output records the retry count.

`.runtime-transaction.json` records the old Runtime backup, staged payload and destination before switching. An unresolved journal blocks another replacement. Preserve all recorded directories and inspect their manifests before recovery; do not delete the journal merely to bypass the check. The installer log includes the recovery path. Restoring Runtime alone cannot reverse a session-format migration.

## Isolated verification

From the repository root on Windows, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/setup/tests/verify-upgrade-retention.ps1
```

The fixture uses fresh D: directories and process-local environment overrides, not host Shell Folders, registry changes or a real installer/uninstaller. It executes production configuration and Runtime helpers with a version-only executable fixture; it does not boot DSH. Folder and archive replacements compare SHA-256 file inventories, retained Runtime contents, standard/portable/custom data, external homes, plugin files, session-like bytes and attachments. Failure cases include bad manifests, hash mismatch, locked files, unfinished transactions, invalid configuration and junctions. Inno wiring assertions are static, not installer UI tests.

## Release qualification

The official Desktop integration requires separate tests using copies from the previous release: actual session loading, plugin activation, file access, retained-data uninstall/reinstall, interruption recovery and restoration after a format change. Byte preservation does not establish those behaviors. The historical host-mutating `smoke.ps1` is not a safe substitute on a user's computer.
