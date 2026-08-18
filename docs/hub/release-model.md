# Release Model

HUB and Desktop assets use the same semantic version tag during the preview period.

## Channels

- `stable` — broadly recommended and migration-aware.
- `preview` — release candidates intended for active testing.
- `nightly` — automated artifacts without compatibility guarantees.

## Required release assets

- Full Setup EXE
- Lite Setup EXE
- Runtime ZIP
- Portable ZIP
- PowerShell download helper
- Release notes
- `release-manifest.json`
- `SHA256SUMS.txt`

## Promotion gates

1. Client and launcher type checks.
2. Desktop and HUB native launch smoke.
3. Runtime ready-gate and service recovery smoke.
4. Setup structure, UI, and install/uninstall smoke.
5. Release manifest and checksum verification.
6. Published-asset download verification.

Preview releases may document a failed non-blocking upstream test, but installer and runtime failures block publication.
