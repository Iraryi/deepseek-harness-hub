# Agent Note: Explicit installation of unpinned GitHub DSHMK candidates

Status: implemented

[中文](2026-08-22-unpinned-github-dshmk-install.zh.md) | English

## Problem

Some DSHMK entries declare an executable GitHub installation command without fixing the repository to a validated Commit. The native HUB rejected these candidates even when the user explicitly chose one-click installation, and the old path did not install the source into the DSH Web Profile.

## Decision

The HUB classifies executable GitHub candidates without an exact validated Commit as `one-click-unpinned`. The Web UI shows a rounded confirmation surface before installation. Only the confirmation path sends `allowUnpinned: true` to the native launcher; cancellation never starts the install request, and failed-install retry preserves the decision.

After confirmation, the launcher validates the repository identity, resolves the GitHub default branch and current HEAD when possible, downloads a codeload archive, and installs it through the existing DSH Setup/Profile engine. The generated manifest records the repository, branch, resolved Commit when available, audit decision, artifact URL, byte count, and SHA-256. If GitHub metadata cannot be resolved, the launcher falls back to the catalog's default branch archive and records that the source was user-confirmed and not pinned.

## Alternatives considered

**Continue rejecting every unpinned GitHub candidate.** Rejected because it prevents the explicit user-directed one-click path requested for otherwise executable DSHMK entries.

**Install the catalog branch without a confirmation step.** Rejected because a moving branch is materially different from a validated Commit and the user must knowingly authorize that source policy.

**Treat the catalog validation SHA as the installed revision.** Rejected because it may be stale or unrelated to the archive actually downloaded; receipts record the resolved revision and artifact digest instead.

## Consequences

Fixed Commit candidates keep their previous behavior and remain ranked above unpinned candidates. The DSHMK installable filter includes both modes. Install receipts record the actual resolved source revision instead of copying a possibly stale catalog validation SHA. Profile activation verification accepts the resolved Commit for unpinned installs while retaining the repository identity check.
