# Agent Note: Avoid POSIX native addon loading on Windows

Status: implemented

English | [中文](2026-09-08-windows-native-addon-startup.zh.md)

## Problem

The Windows runtime deploy intentionally skips package lifecycle scripts, so the `fs-ext` package can be present without its POSIX `fs_ext.node` build output. The JSONL session backend already uses a Win32 semaphore on Windows, but a top-level `fs-ext` import loaded the missing native addon before the platform branch ran. The local service then exited during boot at `session-persistence-jsonl`, producing the `BOOT 04/05` failure after an application update.

## Decision

Load `fs-ext` lazily inside the POSIX-only `flockAsync` path. The Windows lease path remains entirely backed by the existing Win32 semaphore implementation and no longer requires a POSIX addon during module evaluation. A Windows import regression test rejects any attempt to load `fs-ext` while evaluating the lease module.

## Alternatives considered

**Run native package lifecycle scripts during deployment.** Rejected because the self-contained runtime deliberately deploys without arbitrary install scripts; enabling them would broaden build-time execution and still make the artifact depend on a compiler/toolchain path.

**Bundle a Windows build of `fs_ext.node`.** Rejected because Windows never calls `flock`; shipping an unused POSIX addon adds native compatibility and release-maintenance cost.

**Remove `fs-ext` entirely.** Rejected because POSIX deployments still require kernel `flock(2)` for cross-process JSONL writer exclusion.

## Consequences

Windows startup no longer depends on an absent POSIX native artifact, while POSIX keeps the same lazy `flock` behavior. The package remains able to run from the existing script-free deployed layout, and the test pins the platform boundary so a future import refactor cannot reintroduce the startup failure.
