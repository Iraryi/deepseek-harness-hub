# Custom Setup Workspaces

[中文](custom-workspaces.zh.md)

A Setup Workspace is the editable authoring layer behind a virtual Setup. It gives maintainers, local users, and AI-assisted editors a stable directory to modify without changing the HUB executable or pretending that arbitrary source code is already a vetted installer.

## Design goals

- Pin every remote source to an immutable commit, tag, URL hash, or local path.
- Keep Desktop and HUB targets isolated by default.
- Declare dependencies, environment values, build steps, patches, overlays, and outputs before execution.
- Render component and option choices as normal Setup controls.
- Record every installed file and directory in a receipt that supports verification, removal, and rollback.
- Preserve a manual-download/import path when an online dependency cannot be fetched reliably.

## Workspace layout

```text
my-setup-workspace/
├─ manifest.json
├─ patches/
├─ overlays/
├─ scripts/
└─ assets/
```

The normative manifest schema is [`registry/schema/setup-workspace.schema.json`](../../registry/schema/setup-workspace.schema.json). A complete starter lives in [`examples/setup-workspace/manifest.json`](../../examples/setup-workspace/manifest.json).

## Source kinds

| Kind | Intended use | Required identity |
| --- | --- | --- |
| `git` | A repository checkout | HTTPS repository plus immutable `ref` |
| `zip` | A release/source archive | HTTPS URL plus lowercase SHA-256 |
| `local` | A user-supplied folder or archive | Explicit local path selected in Setup |
| `generated` | Files produced entirely by workspace scripts/templates | Workspace version and receipts |

## Execution model

1. **Preflight** resolves options, checks paths, permissions, dependencies, and network availability.
2. **Acquire** downloads or imports source and verifies the declared identity.
3. **Build** applies environment values, patches, overlays, and commands inside a staging directory.
4. **Install** copies only selected components into their declared Desktop or HUB profile.
5. **Verify** checks outputs and records a receipt before reporting success.
6. **Remove or rollback** consumes the receipt instead of guessing which files belong to the Setup.

The HUB should expose the workspace directory to the user. That path can be given to an AI editor, but generated changes remain reviewable files and must pass the same schema and preflight checks before installation.

## Profile isolation

`desktop` is the default scope for community UI components. A component affects HUB only when both conditions are true:

1. The workspace declares `hub` in `targets` or `both` in the component scope.
2. The user explicitly selects the HUB scope in the Setup interface.

This prevents a Desktop sidebar, theme, or injected script from silently changing the HUB itself.

## Publication path

- Publish the source repository or release asset normally.
- Publish a Setup Workspace beside it or in a dedicated Setup repository.
- Add a Registry entry that pins the source/ref and links the workspace.
- Attach clean-profile install, launch, update, removal, and residue evidence when requesting curated status.

Standalone Setup EXEs remain a separate, stricter release class. A workspace can be used to build one, but the resulting binary is not curated until lifecycle testing is complete.
