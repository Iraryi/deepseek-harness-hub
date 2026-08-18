# Changelog

## 0.1.0-rc.6 — 2026-08-18

- Move the complete, buildable HUB implementation into this repository instead of delegating source ownership to the Desktop repository.
- Add a repository-level HUB build entry and a source map for the native host, Web UI, Setup protocol, registry, Runtime, and installer customization points.
- Define HUB releases as HUB-only artifacts; `dsh.exe` and Desktop shortcuts are excluded from future HUB release assets.
- Keep Registry v1, Setup authoring examples, bilingual interface snapshots, and the novice Setup animation brief beside the implementation source.

## 0.1.0-rc.5 — 2026-08-17

- Establish the DeepSeek Harness HUB publishing and ecosystem repository.
- Publish Registry v1, a Setup package schema, authoring example, and validator.
- Keep `deepseek-harness-desktop` as a separate Desktop product rather than treating it as the HUB implementation layer.
- Publish Full Setup, Lite Setup, Runtime, Portable, release manifest, and checksums through HUB Releases.
