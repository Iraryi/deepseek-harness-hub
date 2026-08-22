# HUB 源码布局

[English](source-layout.md) | 中文

仓库根目录就是 DeepSeek Harness HUB 完整且可构建的源码上下文。HUB 的开发、审核和定制不依赖 Desktop 仓库或未发布的包。

## 主要定制点

| 区域 | 路径 |
| --- | --- |
| HUB 目录、主页、筛选、详情、安装界面和主题 | `packages/client/ui-setup-hub/` |
| Setup 清单和证据模型 | `packages/setup/protocol/` |
| 维护与缓存的 Setup Registry | `packages/setup/registry/` |
| 原生 WebView2 宿主、托盘、进程生命周期、GitHub 账户、下载和安装桥 | `windows/launcher/src/MainApp.cs` |
| Desktop／HUB 配置模型 | `windows/launcher/src/Config.cs` |
| 原生 CONFIG 界面 | `windows/launcher/src/ConfigApp.cs` |
| 内置 DSHMK 与精选回退目录 | `windows/launcher/assets/` |
| 自包含 Node.js 与 pnpm Runtime 组装 | `windows/runtime/` |
| Windows 安装器和发布组装 | `windows/setup/` 与 `windows/release/` |

## 共享 DSH 构建上下文

HUB 运行在 DeepSeek Harness 之上，因此本仓库保留生成可复现 Runtime 所需的包、应用、Vendored Cordis 源码、Workspace 清单、测试和构建脚本。这些是 HUB 项目的一等文件，并不因此让 Desktop 应用成为 HUB Release 的一部分。

HUB 专属发布必须打包 `dsh-hub.exe`、HUB 配置、Runtime、WebView2 依赖、目录、声明和 Setup 元数据。不得把 `dsh.exe` 或 Desktop 快捷方式作为 HUB 资产发布。

## 开发命令

```powershell
npm run build:hub
pnpm install --frozen-lockfile
pnpm --filter @deepseek-ai/dsh-client-ui-setup-hub test
```

仓库级构建命令是 Windows 产物的受支持入口。包级命令用于聚焦开发和测试。
