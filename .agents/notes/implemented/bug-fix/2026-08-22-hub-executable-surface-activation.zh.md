# Agent Note: HUB 可执行文件界面激活

Status: implemented

[English](2026-08-22-hub-executable-surface-activation.md) | 中文

## Problem

原生 `dsh-hub.exe` 能正确识别 HUB 模式并附加 `dshSurface=hub`，但正式发布的 Web Profile 没有挂载 HUB 客户端插件。因此原生窗口虽然显示 HUB 的身份，网页内容却仍然是普通 DSH 界面。

## Decision

`dsh-web-app` 将 `@deepseek-ai/dsh-client-ui-setup-hub` 声明为运行时依赖，并以 `ui-setup-hub` 的 ID 将它加入浏览器插件清单。该插件继续存在于共享 Web Profile 中，只有原生启动器提供 `dshSurface=hub` 时才激活完整 HUB 覆盖层；普通 `dsh.exe` 启动仍然显示 DSH。

## Alternatives considered

**建立独立的 HUB 服务 Profile：** 放弃，因为这会重复 Web 组合，并使原生界面和浏览器界面契约逐渐分叉。

**使用原生 WinForms 控件绘制 HUB：** 放弃，因为 HUB 本质是 Web UI 界面，需要保留现有插件、主题以及后续 Web UI 扩展路径。

## Consequences

运行时必须携带 HUB 客户端包，Web 插件清单也必须保留对应条目。只重建 Launcher 不够，前端 bundle 和打包 Runtime 必须一起重建。现在的聚焦测试同时保护依赖声明和插件清单条目。
