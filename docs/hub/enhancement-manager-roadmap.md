# Enhancement distributions and management plan

English | [中文](enhancement-manager-roadmap.zh.md)

This is a design and implementation-status reference, not a release announcement. Full remains the local alpha.2/WebView2 distribution; official Desktop integration and an Overlay installer are not qualified release products yet. Existing capabilities and data-retention requirements remain governed by [HUB requirements](../../HUB_REQUIREMENTS.md).

## Product forms

The initial engineering implementation is available in [Overlay](../../windows/overlay/README.md) and [mobile access](../../windows/mobile/README.md). HUB includes native runtime checks, width/paste/session-ID preferences, guarded saves and trusted-LAN pairing with device revocation. This does not complete the broader feature inventory below or qualify arbitrary upstream versions; [the implementation decision](../../.agents/notes/implemented/feature/2026-09-30-overlay-manager-mobile.md) defines the supported scope.

| Form | Ownership | Installation rule |
| --- | --- | --- |
| Full | Managed launcher, Runtime and HUB | Self-contained setup for a machine without DSH. Retain current update/repair/keep-data uninstall workflows. |
| Overlay, engineering preview | Enhancement launcher, manager, adapters and registered plugins | Requires a supported existing DSH; no replacement of the base executable, packaged archive or signature. Separate installer identity and uninstall receipt. |
| HUB management center | Shared management UI and adapters | Extend existing HUB rather than replace the catalog or create a second divergent configuration store. CONFIG remains a separate executable too. |

Overlay setup first detects a candidate path read-only, identifies the actual Desktop/runtime version, selects its profile and data home explicitly, and presents the supported capabilities. A tested adapter installs enhancements into an owned location with a before-state manifest and verifies activation before committing a receipt. Failure restores only owned changes. Removing Overlay never uninstalls DSH, removes its sessions or touches other applications. An unknown host exposes diagnostics instead of executing a guessed patch. Switching between Full and Overlay is a migration requiring duplicate-instance and data-home checks, not an AppId rename.

The [Codex++ repository](https://github.com/BigPizzaV3/CodexPlusPlus/tree/070be57b40bb53d4889f5a5bf8bf1c7212aabf63) was inspected as a product reference, including its launcher entry and core launcher. Its external-launcher/CDP approach does not establish DSH compatibility. Its [license](https://github.com/BigPizzaV3/CodexPlusPlus/blob/070be57b40bb53d4889f5a5bf8bf1c7212aabf63/LICENSE) is AGPL-3.0; no implementation is copied by this plan.

## Capability priorities

| Requested experience | DSH implementation direction | Current status |
| --- | --- | --- |
| Health and backend connection | Actual runtime/bridge status, recent failure and user-triggered repair | Native runtime/path/endpoint overview implemented; broader repair adapters pending. |
| CONFIG in manager sidebar | Reuse the guarded editor and independent DSH/HUB documents | Source implemented; independent CONFIG retained. |
| Fast HUB opening | Start after DSH readiness, bounded refresh, renderer sleep and same-instance activation | Source implemented with isolated Runtime verification; not a zero-memory service. |
| Provider/model discovery | Extend model Settings with per-provider discovery, timeout and capability reporting | Model Settings exists; discovery enhancement pending. |
| Fast/service tier | Expose only options the selected provider actually supports | No copy of Codex-specific model names or unsupported tier switch. |
| Session deletion, undo, Markdown export and import | Use session owner APIs; scoped backup/undo and format validation | Management extension pending; do not edit an assumed SQLite schema. |
| Historical session repair and identifiers | Dry-run diagnosis, timestamp-format verification, copied fixtures and explicit restore | Pending. A short ID is not proof that its encoding supplies a timestamp. |
| Conversation width, position restoration and plain-text paste | Configurable feature plugins; preserve file/image paste and per-session scroll anchors | Width and rich-text paste adapters implemented; upstream position restoration retained. |
| MCP/plugins/skills and scripts | Extend retained inventory, actual activation checks, per-profile editing and rollback | Existing HUB foundation retained; external lifecycle adapters pending. |
| Appearance and desktop pet behavior | Reversible themes and optional interactions; preserve keyboard access | Traffic-light chrome exists; broader themes/pet integration pending. |
| Suggested next steps and answer outline | Explicit action with visible model/token cost; existing task/session APIs | Pending; no hidden automatic model requests. |
| SSH editor links and upstream worktrees | Detect installed editor/Git, show target and branch before mutation | Pending; no automatic creation or branch switch. |
| Phone/WeChat connection | Pairing, expiry, revocation, device list and authenticated transport | Trusted-LAN HTTP phone relay implemented; TLS, public access and WeChat remain separate work. |

The mobile candidates include [DSH Mobile](https://github.com/guoyihub/deepseek-harness-mobile) and community Desktop pairing. Their newer runtime/profile assumptions require an adapter audit against this branch before reuse. “Phone connection” is not delivered by renaming an external-link button.

## Delivery order and acceptance

1. Finish responsiveness and layout regressions: independent footer, real browser scrolling, hidden preload, wake and parent-exit cleanup. Record cold start and wake separately; do not describe an arbitrary delay as a speed measurement.
2. Add the management overview and capability inventory using real adapters, then incremental session/export and presentation features with visible disabled reasons where a host lacks support.
3. Qualify Overlay on an isolated copy of a supported installed DSH, covering activation, base-app hash preservation, update, repair, rollback, uninstall and retained-data reinstall. Only then publish an Overlay EXE alongside Full.
4. Add paired mobile access and other network integrations after revocation, authentication and cancellation tests. Never use a host Shell Folder rewrite as test isolation.

Each delivered action needs behavior tests, assembled-client checks and constrained light/dark bilingual layout review. A roadmap row or capability probe does not count as an implemented feature; unavailable actions must not masquerade as successful installation or repair.
