# Architecture

DeepSeek Harness HUB separates discovery, evidence, installation, and runtime ownership so that a marketplace result never silently becomes an installation claim.

## Data flow

1. **Source adapters** read DSHMK, curated feeds, GitHub discovery, GitHub stars, offline packages, and local authoring directories.
2. **Normalization** maps source-specific fields into stable project, publisher, category, compatibility, and install-candidate models.
3. **Evidence resolution** records where each install command came from, which version/ref it targets, and which validation stages ran.
4. **Setup rendering** converts an eligible candidate into a consistent multi-step Setup experience.
5. **Execution** runs through the Desktop native bridge, never through arbitrary browser DOM code.
6. **Inventory** records prepared and installed components separately and associates changes with the Desktop or HUB profile.

## Process boundary

`dsh.exe` and `dsh-hub.exe` are separate native processes with separate taskbar identities, profile scopes, window state, and single-instance channels. Opening one from the other should focus the existing process without showing a duplicate-instance warning.

The local service runtime is owned by a job/process lifecycle controller. Restart and uninstall must stop only the service tree belonging to the selected installation.

## Catalog priority

The default source order is:

1. DSHMK-derived verified projects and installation references.
2. Curated registry entries with maintainer evidence.
3. GitHub-wide discovery and user-starred repositories.
4. Local and offline packages.

Source order affects ranking and confidence, not whether a project can be displayed. Dynamic source tags are normalized at runtime while a small baseline taxonomy remains available offline.

## Installation boundary

Virtual Setup recipes and standalone Setup EXEs share presentation concepts but not trust level or execution mechanism. See [setup-package-spec.md](setup-package-spec.md).
