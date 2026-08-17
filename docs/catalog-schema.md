# Catalog Contract

`registry/catalog.json` is the first-party index consumed by tooling and mirrored by release automation.

## Stability rules

- `schemaVersion` changes only for breaking contract changes.
- Entry IDs are permanent and lowercase.
- Published versions are immutable; corrections create a new version or metadata revision.
- Artifact hashes are lowercase SHA-256.
- URLs must use HTTPS.
- Dynamic third-party catalogs are normalized at runtime and do not need to be copied wholesale into this repository.

## Trust fields

`trust.signature` describes code-signing or package-signing evidence. `trust.review` describes repository review and lifecycle testing. Neither field is a promise of safety; both exist to make the install decision legible.

## Source precedence

When two sources describe the same project, immutable release/ref data wins over mutable branch data, reviewed install evidence wins over guessed commands, and the UI retains source attribution instead of erasing conflicts.
