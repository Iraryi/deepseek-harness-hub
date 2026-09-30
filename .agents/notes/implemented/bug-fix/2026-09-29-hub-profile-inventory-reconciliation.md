# Agent Note: Reconcile HUB receipts with Profile components

Status: implemented

English | [中文](2026-09-29-hub-profile-inventory-reconciliation.zh.md)

## Problem

HUB's installed view reads its own receipt index. Components installed through the CLI or another installer are absent, while externally removed components can retain stale removal actions. Installation history and observable Profile contents answer different questions.

## Decision

`PluginInventory` reads direct dependency and bundle declarations across the active DSH home and the current user's default `.dsh` home. It joins primary-home declarations with HUB receipts, retaining receipt metadata and separate home/Profile identities. It does not enumerate transitive dependencies as plugins. Discovery returns explicit origin, home, Profile, version, declaration/file states, and per-profile warnings without modifying profiles or receipt inputs.

Package manifests resolve from the Profile, its parent, the home, and the active runtime anchor. A malformed nearer manifest does not silently resolve to a different runtime version. Windows extended-path read handles support long npm junction paths without changing host policy. Package presence is not a runtime activation assertion.

The native bridge prepares receipt inputs before dispatching the read-only scanner off the UI thread. HUB and the component settings page display discovered entries, source/state labels, configuration location, and scan warnings. Inventory refresh retains results and search through pending and failed requests. Removal rechecks receipt/profile agreement and rejects shared receipt ownership before existing uninstall operations run. External rows do not inherit HUB removal permission.

This complements, rather than supersedes, [receipt retention](2026-08-22-hub-library-persistence-across-setup-lifecycle.md): profiles cannot reconstruct Setup provenance or editable workspaces, while receipts cannot describe all external installations.

Both HUB and component Settings render one inventory view with source, home/Profile, status and multi-term filtering. Settings refresh preserves the view through failures. Diagnostics copy uses an explicit metadata allowlist and a selectable-text fallback rather than reading raw profile configuration. Removal eligibility is also calculated for the displayed snapshot: unsupported methods, invalid or empty targets and shared receipt ownership disable the action with an explanation. The executor's check remains authoritative at mutation time.

## Alternatives considered

**Use only receipts.** Rejected because external installers do not create HUB records and external removal leaves misleading state.

**Replace receipts with a node_modules crawl.** Rejected because transitive packages are not user-installed plugins and a filesystem crawl cannot recover Setup provenance or ownership.

**Enable generic uninstall for every discovered path.** Deferred because homes and dependency ownership differ. A correct owning-runtime adapter is needed before presenting destructive actions.

**Maintain separate management controls in HUB and Settings.** Rejected because different refresh and filtering behavior had already caused Settings to lose its usable state. One view keeps both entry points aligned.

## Consequences

External direct components become visible without importing fabricated receipts. Corrupt configuration remains observable rather than silently authorizing deletion. Windows native APIs add platform-specific manifest I/O. Additional custom homes, Cordis-only entries, external lifecycle operations and live activation health remain outside this implementation; no complete product qualification follows from inventory tests.

## Testing

The isolated native harness covers two homes, deduplication, versions, stable identifiers, corrupt declarations/manifests, file immutability and external removal. The offline npm harness performs three real install/scan/uninstall/scan cycles without HUB receipts, including long paths and junctions. Component tests cover external rows, warnings, locating configuration, disabled unsupported actions, and retained search on rescan failure. Bilingual assembled tests exercise built client assets and bridge responses. Native and client builds check integration; pixel/DPI, real installation, Setup lifecycle and official Desktop migration are separate acceptance work. Tests must not redirect host Shell Folders or mutate real profiles.
