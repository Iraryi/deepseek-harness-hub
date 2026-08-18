# `@deepseek-ai/dsh-full-capability-pack`

English | [中文](README.zh.md)

An optional in-box Setup bundle for users who want the complete shipped DSH composition rather than the minimal preset. Installing it through HUB keeps the `standard` agent preset as the default for new sessions and enables durable full-text session search on first use.

The standard preset already supplies the platform shell tool, filesystem tools, skills, goals, planning, compaction, subagents, workflows, task tracking, and Web search. The pack does not enable telemetry, store API keys, or expose hidden model reasoning.

## Model Experience

Indirectly, through the `standard` agent preset selected for newly created sessions.

#### KV Cache effect

The package itself adds no model tokens or cache invalidation; the selected preset's plugins own their effects.

## Known Limitations and Deferred Work

- Existing sessions keep the preset under which they started.
- Third-party API connectors and community plugins remain separately reviewed Setup entries.
- The package does not claim that a provider will expose hidden chain-of-thought content.
