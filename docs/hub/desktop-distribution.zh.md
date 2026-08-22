# 项目边界

[English](desktop-distribution.md) | 中文

HUB 和 Desktop 是两个正式项目。HUB 负责自己的源码、Setup 构建系统、正式 Setup 资产、目录和发布渠道。Desktop 不是 HUB 发布中的隐藏依赖。

## `deepseek-harness-hub`

- 完整的 HUB 源码树，包括原生 HUB 宿主、Web UI、Runtime、Setup 构建器、Setup Registry、Schema、测试和目录适配器。
- 面向用户的项目主页和下载渠道。
- Setup Registry、Schema、提交流程和精选包政策。
- Release 说明、校验和以及仅属于 HUB 的 Windows Setup 资产。

## `deepseek-harness-desktop`

- 独立的 Desktop 产品源码和仅属于 Desktop 的 Windows 发行版。
- Desktop WebView2 宿主、任务栏身份、托盘行为、进程所有权和首次启动路由。
- Desktop Runtime 与 Desktop Setup 资产，具体取决于 Desktop 项目是否发布。

Desktop 仓库名为保持连续性而不变。它的分类是 **Desktop 产品**，不是 HUB 实现或 HUB 发布渠道。

## 发布交接

HUB CI 或维护者构建会在本仓库生成 HUB Setup、HUB Runtime、便携包、发布清单、校验和及更新日志。Desktop 资产不会仅因为两者都使用 DSH 就被复制到 HUB Release 中。
