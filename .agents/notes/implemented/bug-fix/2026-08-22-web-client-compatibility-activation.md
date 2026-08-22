# Agent Note: Web client-only package compatibility activation

Status: implemented

[中文](2026-08-22-web-client-compatibility-activation.zh.md) | English

## Problem

Some DSH extensions ship a browser client bundle but do not declare `dsh.bundle`, so profile installation succeeds while the Web Loader cannot discover the client entry. The installer then reports that the dependency exists without activating a usable DSH layer.

## Decision

The CLI recognizes a dependency as a Web client-only package only when its manifest declares `dsh.client.platform: "web"`, exports `./client`, and resolves that export to an existing file inside the installed package. It keeps ordinary `dsh.bundle` activation unchanged and leaves every other bundle-less dependency ordinary.

For a qualifying package, the CLI maintains a marked HUB-owned section in the profile `cordis.patch.yml`. The generated row uses a stable package-derived id and points the Loader at the installed package. Reconciliation replaces only the marked section, preserves user-authored patch rows, removes stale entries after uninstall, and is idempotent.

The native HUB verifier accepts either a declared `dsh.bundle` layer or a generated Web client compatibility entry for the matching installed dependency. Installation progress and success copy use the generic component term so Web client-only packages are not presented as bundles.

## Alternatives considered

**Treat every dependency with `exports["./client"]` as a layer:** Rejected because a client export alone does not identify a DSH Web plugin and would activate unrelated packages.

**Modify every third-party package manifest during installation:** Rejected because it mutates installed package contents and makes upgrades and integrity checks ambiguous.

**Require every package to add `dsh.bundle`:** Rejected because existing Web client-only extensions can be valid browser plugins without a server-side profile patch.

## Consequences

Web client-only extensions can be installed and verified through the existing Setup/Profile path without being misclassified as full bundles. The generated patch section is an on-disk format owned by HUB and must remain marker-delimited. A package with a missing or out-of-package client file still fails the compatibility check and remains an ordinary dependency.

## Testing

The built CLI regression installs a synthetic Web client-only package, verifies the generated patch and dumped profile, repeats reconciliation, removes the package, and verifies that the generated section disappears. TypeScript compilation and the focused built-bin test pass.
