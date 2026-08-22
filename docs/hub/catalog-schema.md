# Catalog Contract

[中文](catalog-schema.zh.md)

`registry/catalog.json` is the canonical first-party Setup Registry source. `apps/web/public/setup/registry.json` is its byte-for-byte Web UI mirror; the catalog validator rejects drift between the two files.

## Registry wrapper

The wrapper contains four fields:

- `schemaVersion` is the integer `1`.
- `generatedAt` is the ISO timestamp for the catalog snapshot.
- `source` is the HTTPS address that identifies the maintained catalog source.
- `entries` contains `{ "manifest": ..., "metrics": ... }` listings.

The wrapper is defined by [`registry/schema/setup-registry.schema.json`](../../registry/schema/setup-registry.schema.json). A manifest is defined by [`registry/schema/setup-package.schema.json`](../../registry/schema/setup-package.schema.json).

## Entry ownership

The `manifest` is maintainer-authored evidence for one installable Setup. `metrics` is registry-owned ranking data and may contain `stars`, `installs`, and `updatedAt`. Discovery-only results, dynamic DSHMK metadata, GitHub search results, and local builder drafts stay in their owning source adapters until they have a verified Setup manifest.

## Stability rules

- `schemaVersion` changes only for a breaking protocol change.
- Entry IDs are lowercase and stable once published.
- Source refs and artifact digests identify the exact content used by installation.
- Artifact URLs and source URLs use HTTPS.
- Corrections update the canonical source and its mirror together; they do not create a second legacy field vocabulary.
- Release assets are published separately and are not duplicated into the catalog unless the corresponding Setup manifest is current, hash-verified, and owned by this HUB project.

## Trust and ranking

`signature` records signing evidence, while `audit` records the checks that were performed. Neither field is a promise created by the catalog itself. `metrics` can influence sorting, but popularity never upgrades the trust tier derived by the Setup protocol.
