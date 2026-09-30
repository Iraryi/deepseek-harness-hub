# Independent Overlay installer decision

## Scope and ownership

Read root AGENTS, HUB_REQUIREMENTS and defensive patterns. The explicit task restricts all changes to new `windows/overlay/**`; therefore execution state and this Agent Note live here instead of changing shared `HUB_EXECUTION_STATE.md` or `.agents/notes`. Existing concurrent repository changes are not owned or reverted by this task. Parent owns all native launcher and shared build integration.

## Implemented

Separate Inno AppId/install directory and independent enhanced Desktop/HUB/CONFIG shortcuts; read-only explicit host/runtime/home planning; named alpha.2 compiled CLI adapters; stable binding and retained Overlay-only state; normal Inno tracked-file uninstall with no base/data cleanup; recursive launcher/package payload staging with hashes; standalone preparation, validation and resolver/HTTP activation tests. New frontend packages resolve from private Overlay payload without editing base Runtime files. Source-only or unknown CLI versions fail closed rather than claiming compatibility.

## Integration and evidence

`INTEGRATION.md` gives the actual parent marker path and native handoff requirements. Parent provides bound path selection, Overlay process identity and post-Runtime resolver imports. `TESTING.md` records exact successful fixtures and engineering build, failed test iterations, package hashes and unqualified release gates. English and Chinese README files describe actual behavior and limitations.

## Remaining release work

Parent clean-builds final launcher/packages, compiles a fresh Setup and rechecks changed stage bytes. Authorized disposable-VM installation/uninstall, native UI/Explorer handoff, historical data/profile compatibility and publisher signing remain separate gates. No host install, registry/profile change, old smoke, commit or publication occurs in this task.
