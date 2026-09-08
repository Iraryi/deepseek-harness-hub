# Agent Note: DSH Alpha.2 upgrade direction for HUB

Status: proposed

English | [中文](2026-09-08-dsh-alpha2-hub-upgrade-direction.zh.md)

## Problem

An upstream DSH release changes more than the version string: Alpha.2 adds or reshapes capability packs, client and Host package boundaries, session controls, web boot behavior, and release metadata. HUB must expose those changes without silently enabling experimental capabilities, discarding installed component records, or falling back to an unverified local package.

## Proposal

HUB treats the upstream release as a capability-diff input and keeps DSH, HUB, and each installed component on separate version tracks. The release record stores the upstream commit, source archive digest, runtime manifest digest, client artifact digest, and the compatibility result used by the Setup page.

### P0 — intake and recovery

- Compare the upstream package graph, profile bundles, CLI commands, Web patch roster, and runtime manifest against the previous pinned release before publishing an update.
- Render a compatibility matrix in HUB for DSH version, HUB version, Setup schema, profile, platform, and installed component; unknown or experimental capabilities remain opt-in.
- Keep Update, Repair, and Uninstall as separate operations. All three preserve `%LOCALAPPDATA%\DeepSeekHarness`, the installed component library, and session data unless the user explicitly selects data removal.
- Stage every update beside the active installation, verify hashes and required entry points, then switch atomically with a rollback record. A failed switch leaves the active installation usable.

### P1 — capability-aware HUB

- Add an Update Center that groups upstream changes by user-visible capability: full-capability pack, queue and steering controls, subagents and jobs, session history and telemetry, Web reconnect and stale-asset recovery, and open-in-app integrations.
- Let a profile declare the capabilities it consumes instead of inferring them from package presence. HUB reports missing, incompatible, disabled, and user-enabled capabilities distinctly.
- Keep HUB child plugins isolated from Desktop by default. A component may request an explicit Desktop integration, and the review page shows the affected surface, restart requirement, permissions, network use, and rollback scope.
- Make the installed library authoritative. Refreshing a catalog may change discovery results, but it cannot turn an installed component into a local-only or missing entry.

### P2 — resilient Setup and Web experience

- Use one Setup progress protocol for online transfer, cache reuse, manual file import, verification, activation, and rollback. Each transfer exposes a byte sub-progress, current log line, cancellation state, and a retryable failure reason.
- Start the bundled or cached catalog immediately, refresh it in the background, and preserve the last known-good snapshot when an online source is unavailable or malformed. Details pages retain their page, filters, and scroll position.
- Give Web boot a bounded readiness state with actionable retry and restart controls. Stale client assets trigger one cache-recovery attempt and then a diagnostic result rather than an unbounded spinner.
- Keep the default visual language consistent across Desktop, HUB, CONFIG, and Setup: independent taskbar identity, rounded surfaces, no layout overlap, no flashing selection state, and no blank white transition.

### Release gates

The Alpha.2-derived HUB release passes source and package dependency checks, Host and Client type checks, focused HUB and first-load tests, Web production build, Launcher build, isolated runtime readiness, update/repair/uninstall data preservation, offline catalog fallback, manual dependency import, and rollback verification. No release job may run a smoke test that mutates the host Shell Folders registry; any temporary test state is isolated and restored by both a watchdog and `finally` cleanup.

## Alternatives considered

**Only replace the upstream source tree.** This keeps package code current but leaves HUB manifests, Setup evidence, profile selection, and recovery behavior stale. Rejected because the user-visible contract spans the runtime, Web client, and installer.

**Enable every new Alpha.2 capability by default.** This makes the first launch unpredictable and can activate experimental packages without a compatible profile. Rejected; capability declarations and opt-in state belong to the profile and HUB review flow.

**Let the online catalog define installed state.** A failed refresh would make working local components appear missing and could offer destructive reinstall actions. Rejected; the installed library and profile records remain authoritative.

**Update in place and repair after failure.** Partial replacement can leave a mixed DSH/HUB graph that is harder to diagnose than the original failure. Rejected; staged verification and atomic switching provide a bounded rollback point.

## Acceptance criteria

- An upstream release record identifies the exact source commit and digests, and HUB displays DSH and HUB versions separately.
- A profile can consume Alpha.2 capabilities explicitly, while unsupported or experimental capabilities stay disabled and visible as such.
- Update, repair, uninstall, reinstall, and rollback preserve installed component records and user data by default.
- Catalog failure, stale Web assets, interrupted Setup transfer, and failed activation each produce a bounded, retryable state with actionable evidence.
- The release gates exercise the installed path in an isolated directory and leave no application processes, Shell Folder mutations, or test data behind.

## Risks

Capability metadata can drift from upstream package behavior if it is maintained by hand; the release pipeline must derive the package and profile portions from manifests and fail on an unreviewed diff. Alpha.2 changes may require separate compatibility adapters for old community packages, but those adapters must not weaken the installed-library authority or the data-preservation guarantee. A full-capability profile increases download size and startup work, so HUB must keep it manually selectable and show its resource cost before activation.
