# dsh-setup-registry

English | [中文](README.zh.md)

`@deepseek-ai/dsh-setup-registry` parses the maintained Setup catalog and provides conditional HTTP fetching for HUB.

The registry keeps popularity metrics outside each Setup manifest. HUB may sort by certification, stars, installs, or update time, but metrics never grant certification. A cached index can remain usable after a `304 Not Modified` response or a temporary network failure; the installer still owns artifact hash and signature verification before execution. The Desktop build ships a validated registry inside its signed Web assets; automated GitHub discovery contributes only pinned, hashed drafts and quarantine records until a release review promotes them.

## Model Experience

None, as catalog parsing and ranking run outside model request assembly and register no model-facing behavior.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The registry client does not persist cache files or download artifacts; the desktop HUB owns those policies.
- The independent [Setup library](https://github.com/Iraryi/deepseek-harness-setups) owns GitHub discovery, standalone EXE construction, quarantine, audits, SBOMs, and signing records. Live remote certification refresh remains disabled until the registry itself has authenticated distribution.
