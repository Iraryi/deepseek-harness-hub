# Setup Package Specification v1

[中文](setup-package-spec.zh.md)

## Purpose

Registry v1 is the machine-readable contract shared by the HUB UI, the CLI installer, standalone Setup evidence, offline imports, and future automation. It describes an installable Setup; discovery-only records from DSHMK or GitHub do not belong in this registry until they have a concrete, verifiable installation plan.

## Package kinds

### Virtual Setup

A virtual Setup is a manifest-backed recipe rendered by HUB and installed into a DSH profile. Its `install.mode` is `profile`, and its source is either an in-box bundle or a verified `package`/`archive` artifact. It is not a service that converts arbitrary GitHub repositories into EXEs.

### Executable Setup

An executable Setup points to a distributable installer artifact. Its `kind` is `executable`, its `install.mode` is `executable`, and its artifact must carry an HTTPS URL, SHA-256 digest, and optional Windows platform metadata. Windows execution also checks the actual Authenticode evidence before launching the installer.

## Registry entry

The registry is an object with `schemaVersion`, `generatedAt`, `source`, and `entries`. Each entry has a `manifest` and registry-owned `metrics`; ranking data is kept outside the maintainer-authored manifest.

## Manifest fields

- `schemaVersion`, `id`, `name`, `description`, and `version` identify the immutable Setup record. `name` and `description` may be plain strings or objects with a required `default` and optional `zh` and `en` values.
- `kind`, `categories`, and `tags` describe the install surface and discovery vocabulary. Categories and tags do not grant trust.
- `source` contains an HTTPS repository, a ref, and optional commit and release identifiers. A commit is a 40-character hexadecimal hash when present.
- `compatibility` declares the DSH range, supported surfaces (`cli`, `web`, or `desktop`), optional Node range, and optional Windows platform set.
- `license` contains an identifier, display name, optional HTTPS notice URL, optional notice text, and an explicit `redistributable` decision.
- `signature` records certificate or package-signature evidence. `audit` records review status and the checks that actually ran; neither field is a self-authenticated safety guarantee.
- `artifacts` is non-empty. An `in-box` artifact names a component already carried by DSH; a remote `package`, `archive`, or `installer` artifact must include an HTTPS URL and SHA-256 digest.
- `install` selects either an in-box bundle, a verified profile package/archive, or an executable artifact. Artifact IDs must resolve within the same manifest.
- `permissions` and `network` state the declared file, profile, privilege, and network effects shown before installation.

## Installation rules

The CLI parses the manifest before any download or process launch. Remote artifacts are stored in a content-addressed cache and accepted only after their SHA-256 digest matches. Profile installation passes only the verified local package/archive to the private Runtime package manager; executable installation is Windows-only and launches the verified installer without a shell.

Virtual and executable entries use the same evidence panel, but they do not share trust or execution semantics. A GitHub source classification requires explicit user acknowledgement, and an unverified non-GitHub source requires a stronger acknowledgement. A rejected audit status blocks installation.

DSHMK one-click candidates whose GitHub command is not `github:<owner>/<repository>#<40-character-commit>` are shown as unpinned candidates. HUB requires an in-product confirmation before installation; the native launcher then resolves the default branch HEAD when available, installs the resulting archive through the DSH Web Profile engine, and records the branch, resolved Commit, artifact URL, byte count, and SHA-256. If GitHub metadata cannot be resolved, it uses the declared default-branch archive and records the user-confirmed unpinned source.

## Schema and examples

The normative manifest schema is [`registry/schema/setup-package.schema.json`](../../registry/schema/setup-package.schema.json). The registry wrapper schema is [`registry/schema/setup-registry.schema.json`](../../registry/schema/setup-registry.schema.json). The maintained catalog is [`registry/catalog.json`](../../registry/catalog.json), mirrored byte-for-byte at [`apps/web/public/setup/registry.json`](../../apps/web/public/setup/registry.json). A minimal authoring example is [`examples/setup-package/manifest.json`](../../examples/setup-package/manifest.json).

Run `pnpm run validate:hub-catalog` before submitting a catalog change. The validator checks both catalog mirrors, rejects legacy manifest fields, verifies artifact references, and validates the setup-workspace examples.
