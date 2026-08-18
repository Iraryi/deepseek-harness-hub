# dsh-setup-protocol

English | [中文](README.zh.md)

`@deepseek-ai/dsh-setup-protocol` defines the shared manifest used by the DSH HUB and the maintained Setup library.

The manifest deliberately separates:

- `kind`: a HUB virtual Setup or a real executable Setup;
- `source`: repository, ref, and optional immutable commit provenance;
- `license`: redistribution and attribution information;
- `signature`: digital-signature evidence;
- `audit`: DSH Setup Library review evidence;
- `artifacts`: HTTPS locations and SHA-256 digests;
- `install`: profile installation by hashed artifact id, an in-box bundle, or executable installation.

HUB derives the displayed trust tier from evidence. A manifest cannot claim `certified` merely by writing a badge into its own JSON.

Profile package installation never forwards a mutable package or git spec directly to a package manager. The manifest names a `package` or `archive` artifact, the installer downloads and verifies its SHA-256 digest, and only the verified local file reaches the Desktop Runtime's private npm. npm lifecycle scripts stay disabled unless the manifest declares the `install-scripts` permission.

## Model Experience

None, as manifest validation runs outside model request assembly and registers no model-facing behavior.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Signature-chain verification is performed by the platform-specific installer layer; this package only validates the declared evidence fields. A remote registry therefore needs its own authenticated distribution before its certification claims can be trusted.
- The package does not execute installers, resolve GitHub releases, or grant permissions.
- Registry metrics such as stars and installs are kept outside the manifest and are never treated as certification evidence.
