# Contributing

DeepSeek Harness HUB accepts catalog corrections, Setup manifests, documentation, validation tooling, and desktop ecosystem proposals.

## Before opening a pull request

1. Keep third-party ownership and licensing explicit.
2. Do not commit credentials, personal paths, generated user data, or private API responses.
3. Run `npm run validate`.
4. Keep a Setup recipe deterministic: pin a version, release, commit, or verified digest whenever possible.
5. Describe administrator privileges, network access, external runtimes, expected file changes, restart requirements, and rollback behavior.

## Catalog changes

Every entry needs a stable ID, canonical source, publisher, license state, compatibility range, installation mode, and trust declaration. A virtual Setup may reference an upstream repository or package manager. A standalone Setup must reference a release asset and include SHA-256.

Catalog inclusion is not an endorsement. The registry records evidence and behavior so the HUB can present an honest Setup experience.

## Review levels

- **Schema review** — the manifest is structurally valid.
- **Source review** — repository, license, publisher, and install instructions are identifiable.
- **Install review** — install and launch succeed in a clean profile.
- **Lifecycle review** — update, repair, restart, and uninstall behavior are documented and repeatable.

Standalone EXEs require all four levels. Virtual entries may be merged with lower review levels when the UI clearly displays the limitation.

## Commit style

Use short imperative subjects such as `docs: clarify offline import` or `catalog: add example setup`.

## Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security-sensitive reports should follow [SECURITY.md](SECURITY.md).
