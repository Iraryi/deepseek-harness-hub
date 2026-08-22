# AGENTS.md — GitHub Actions

[English](AGENTS.md) | 中文

在 Windows Runner（`windows-*` 标签）上使用原生 `pwsh` 运行作业。Pull Request 的 `windows` 作业是有意设置的例外：它在托管 Linux 上通过 Wine 运行 Windows Node，并会阻塞 `all checks passed`；`windows-native` 会在 `windows-2025` 上自动运行（或者在 `DSH_CI_FAILOVER_WINDOWS=selfhosted` 时使用自托管 `[self-hosted, dsh-win-ci, windows]` 池），但独立报告。主 `serial-windows` standby 会持续验证自托管故障转移目标，详见[故障转移运行手册](../../../.agents/notes/implemented/process/2026-07-26-ci-failover-runbook.md)。
