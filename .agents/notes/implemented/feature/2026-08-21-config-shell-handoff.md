# Agent Note: Detach CONFIG save-and-run through a Shell shortcut

Status: implemented

English | [中文](2026-08-21-config-shell-handoff.zh.md)

## Problem

CONFIG `Save & Launch` must save the selected profile and start the sibling Desktop or HUB process after CONFIG closes. A direct process launch from a CONFIG process attached to a Windows Job can either inherit the Job and be terminated with CONFIG or lose the explicit data-directory arguments when those arguments are appended to `explorer.exe` as though they were paths.

## Decision

CONFIG writes a short-lived `.lnk` file in the user's temporary directory. The shortcut stores the target executable, working directory, and exact `--dsh-data-dir`, `--dsh-home`, and optional `--dsh-instance-scope` arguments. CONFIG asks the existing Windows Explorer shell to resolve the shortcut, which preserves the arguments while allowing the sibling process to start outside CONFIG's Job. Old handoff shortcuts older than ten minutes are removed opportunistically.

## Verification

`windows/launcher/smoke-first-run-handoff.ps1` compiles and runs the native harness against an isolated portable app. The harness verifies that `SaveAndClose(true)` does not start Desktop early, the expected test-directory `dsh.exe` appears after the explicit post-close handoff, the process survives outer Job shutdown, and the startup log contains no access-denied failure.

## Alternatives considered

**Direct `Process.Start` with `UseShellExecute`:** rejected because a process started directly by CONFIG can remain in CONFIG's Job and be terminated when the CONFIG harness exits.

**Appending application arguments to `explorer.exe`:** rejected because Explorer treats the executable and following arguments as shell paths instead of reliably forwarding the arguments to the target process.

## Consequences

The handoff leaves a small temporary `.lnk` file until the next cleanup pass, so CONFIG removes shortcuts older than ten minutes rather than relying on a cleanup process that would itself inherit the Job. The approach depends on the Windows Shell shortcut COM service, which is available on supported Windows desktop installations.
