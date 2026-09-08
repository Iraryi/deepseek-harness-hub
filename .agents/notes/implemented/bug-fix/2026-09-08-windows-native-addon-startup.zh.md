# Agent Note: 避免 Windows 加载 POSIX 原生模块

Status: implemented

[English](2026-09-08-windows-native-addon-startup.md) | 中文

## Problem

Windows Runtime 的部署流程会有意跳过依赖包的 lifecycle scripts，因此 `fs-ext` 包可能存在，但其中的 POSIX `fs_ext.node` 构建产物不存在。JSONL 会话后端在 Windows 上本来已经使用 Win32 信号量，但顶层 `fs-ext` 导入会在平台分支执行前加载这个缺失的原生模块。于是应用更新后，本地服务在 `session-persistence-jsonl` 启动阶段退出，产生 `BOOT 04/05` 故障。

## Decision

把 `fs-ext` 延迟到 POSIX 专用的 `flockAsync` 路径中加载。Windows 租约路径继续完全使用现有的 Win32 信号量，模块求值时不再要求 POSIX 原生模块。新增 Windows 导入回归测试，任何在加载租约模块时尝试加载 `fs-ext` 的行为都会失败。

## Alternatives considered

**部署时运行原生依赖的 lifecycle scripts。** 否决：自包含 Runtime 明确禁止任意安装脚本，重新开启会扩大构建期执行范围，并且仍让产物依赖编译器和工具链。

**打包 Windows 版 `fs_ext.node`。** 否决：Windows 根本不会调用 `flock`；携带未使用的原生模块会增加兼容性和发布维护成本。

**彻底移除 `fs-ext`。** 否决：POSIX 部署仍需要内核 `flock(2)` 来保证跨进程 JSONL 写入互斥。

## Consequences

Windows 启动不再依赖缺失的 POSIX 原生产物，同时 POSIX 继续使用相同的延迟 `flock` 行为。包仍可从现有的无脚本部署布局运行，并由测试固定平台边界，防止未来的导入重构再次引入启动故障。
