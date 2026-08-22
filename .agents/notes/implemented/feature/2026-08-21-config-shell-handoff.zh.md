# Agent Note：通过 Shell 快捷方式脱离 CONFIG 交接

状态：已实现

[English](2026-08-21-config-shell-handoff.md) | 中文

## 问题

CONFIG 的“保存并运行”必须先保存配置、关闭 CONFIG，再启动同级 Desktop 或 HUB。若 CONFIG 直接启动子进程，子进程可能继承 CONFIG 所属的 Windows Job 并在 CONFIG 退出时一起被终止；若把参数直接追加给 `explorer.exe`，Explorer 又可能把这些参数当成路径处理，导致数据目录参数丢失。

## 决策

CONFIG 在用户临时目录写入短生命周期的 `.lnk` 文件。快捷方式保存目标 EXE、工作目录，以及准确的 `--dsh-data-dir`、`--dsh-home` 和可选的 `--dsh-instance-scope` 参数。CONFIG 请求已运行的 Windows Explorer Shell 解析该快捷方式，因此参数仍能传递，同时同级进程可以脱离 CONFIG 的 Job 启动。启动时顺带删除十分钟前的旧交接快捷方式。

## 验证

`windows/launcher/smoke-first-run-handoff.ps1` 会针对隔离的 portable 应用编译并运行原生测试器。测试器验证 `SaveAndClose(true)` 不会提前启动 Desktop，显式关闭 CONFIG 后能发现测试目录内的 `dsh.exe`，该进程能在外层 Job 结束后继续存活，并且启动日志没有拒绝访问错误。

## Alternatives considered

**直接使用 `Process.Start` 和 `UseShellExecute`：** 放弃，因为由 CONFIG 直接启动的进程可能仍在 CONFIG 所属的 Job 中，CONFIG 测试器退出时会把它一起回收。

**把应用参数追加到 `explorer.exe`：** 放弃，因为 Explorer 会把 EXE 和后续参数按 Shell 路径解析，不能稳定地把参数转发给目标进程。

## Consequences

交接会在临时目录留下一个小型 `.lnk` 文件，直到下一次清理。因此 CONFIG 不依赖同样会继承 Job 的清理进程，而是在启动时删除超过十分钟的旧快捷方式。该方案依赖受支持 Windows 桌面系统提供的 Windows Shell 快捷方式 COM 服务。
