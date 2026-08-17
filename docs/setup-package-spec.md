# Setup Package Specification v1

## Purpose

Registry v1 makes installation behavior inspectable and portable across the HUB UI, independent Setup EXEs, offline imports, and future automation.

## Package kinds

### Virtual Setup

A virtual Setup is a manifest and deterministic recipe rendered inside the HUB. It may invoke the DSH CLI, a package manager, a release download, a source checkout, or an assisted manual action. It is **not** an EXE conversion service.

Use virtual Setup when upstream already has a stable installation method and the HUB can explain and execute it reliably.

### Standalone Setup

A standalone Setup is a real distributable installer, normally an EXE on Windows. The curated library accepts it only after clean-profile installation, launch, update/repair, uninstall, and residue checks.

## Required declarations

- Stable package ID, display name, version, publisher, summary, categories, and tags.
- Canonical source repository and immutable version/ref where practical.
- License identifier or an explicit `unknown` state.
- Supported DSH versions, surfaces, platforms, and architectures.
- Installation mode, target profile, restart behavior, and rollback/uninstall behavior.
- Network hosts, administrator privilege, external runtime, and expected file-write declarations.
- Signature/certificate state and audit level.
- Artifact URL, byte size, and SHA-256 for standalone packages.

## Setup UI contract

Every Setup surface must show:

1. Package and publisher identity.
2. Source, license, certificate/signature, and validation state.
3. Components to install and optional choices.
4. Dependencies and environment checks.
5. Download progress with per-artifact sub-progress.
6. A manual-download/import path during dependency acquisition.
7. Installation progress and meaningful current-step text.
8. Restart requirements and a clear completion result.
9. Failure details, retry, open-log, and cleanup/rollback actions.

Going backward in the wizard must reset progress visuals and stale results. Controls must not flicker, overlap, or change layout when state changes.

## Profile isolation

Components target `desktop`, `hub`, `both`, or a named DSH profile. `desktop` is the default for third-party UI components. A component may affect the HUB only when its manifest declares HUB compatibility and the user selects that scope.

## Lifecycle

Installed inventory records package ID, version, source/ref, target profile, files or workspace path, install timestamp, and restart state. Removal must either complete immediately or prompt for a restart; a plugin-load failure surface must provide the same restart path.

The normative machine-readable contract is [`registry/schema/setup-package.schema.json`](../registry/schema/setup-package.schema.json).
