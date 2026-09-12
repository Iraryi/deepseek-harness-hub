# Agent Note: 跨 CLI 与浏览器认证的桌面安装包启动

Status: implemented

[English](2026-09-12-packaged-desktop-startup.md) | 中文

## Problem

全新安装 HUB alpha.2 hub.3 后，本地服务以 `unknown option '--patch'` 退出：原生命令把 Web 应用参数 `--no-open` 放在启动器参数 `--patch` 前，而 CLI 会把第一个未知选项之后的所有参数转交应用。修正顺序后又暴露两处集成遗漏：认证丢弃原生路由查询参数，上游 Web 内核重构漏掉桌面端所需的结构化启动报告。模拟服务测试接受错误命令，也无法检测这两个浏览器问题。

## Decision

原生命令先传启动器补丁参数，再传 Web 应用参数。BrowserAuth 在新令牌和旧令牌跳转中移除认证令牌，同时保留根路径的其他查询参数。AppWebEntry 通过 WebView2 报告属于当前导航的进度和终态，在插件激活、应用挂载后才报告就绪。仅含等待中条目的失败保留原有单次重试策略。这恢复了[桌面分发记录](../feature/2026-08-14-windows-desktop-distribution.zh.md)的机制，并保留[HUB EXE 路由决策](2026-08-22-hub-executable-surface-activation.zh.md)。

即使关闭加载动画，启动错误仍显示原生面板，提供可滚动诊断、重试、CONFIG、日志和复制操作。原生日志隐去 URL 认证令牌。重试重置加载状态，并只重启自己拥有的服务。迟到的浏览器初始化事件不能把终态错误替换为加载进度。

## Alternatives considered

**修改 CLI，让参数顺序任意。** 不采用，因为主动转发语义属于上游设计，桌面启动命令应遵守该语义。

**把 HTTP 页面加载完成视为就绪。** 不采用，因为 HTTP 成功不能证明插件激活、原生桥接正常，或 HUB 显示的是自己的界面。

**移除认证或清除已有配置。** 不采用，因为两者都不能修复参数顺序或生命周期报告缺失，删除配置还会损坏无关用户数据。

## Consequences

安装包 smoke 使用真实 EXE 和解压的 Runtime、全新的明确数据路径、隔离实例标识，以及只有系统目录的 PATH；要求结构化网页就绪后保持健康 15 秒，保留诊断证据，不修改 Windows Shell Folders。定向测试覆盖查询参数保留、令牌移除、成功挂载、等待条目和导入失败。这是本地安装包 Runtime 的验证证据，不代表测试过用户的远程电脑。
