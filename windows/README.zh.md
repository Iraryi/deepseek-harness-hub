# DeepSeek Harness Windows 桌面版

[English](README.md) | 中文

这个项目只负责 Windows **Desktop 本体**。它拥有普通主程序窗口、Desktop CONFIG、Desktop Runtime 和 Desktop Setup 发布流程。DSH HUB 是独立的正式项目，位于 [`Iraryi/deepseek-harness-hub`](https://github.com/Iraryi/deepseek-harness-hub)；Desktop 不包含也不依赖 HUB 程序。

## 发行边界

- Desktop 发行包只包含 `dsh.exe` 和 `dsh-config.exe`。
- Desktop 发行包不包含 `dsh-hub.exe`、HUB 目录、HUB 快捷方式或 HUB 专属 Setup 页面。
- Desktop 的用户数据、Runtime、扩展、缓存和日志都放在 EXE 外部。
- HUB 的安装、目录发现、Setup 库管理和 HUB Setup 发布全部属于 HUB 仓库。

## 安装

Desktop 成品请从 Desktop 仓库的 Releases 页面获取。推荐的 Full Setup 内置私有 Node.js Runtime 和 WebView2 离线安装器；Lite Setup 可以下载或导入经过校验的 Runtime ZIP；Portable 版本要求电脑已经安装 WebView2。

正常安装不需要系统 Node.js、npm、pnpm、Git 或开发环境。首次启动会先进入 `dsh-config.exe`，由 CONFIG 负责 Desktop 的语言、分辨率、全屏方式、加载画面、托盘、扩展和 Web UI 设置。

## 构建

在 Windows x64 源码目录准备 Node.js 24、pnpm、.NET Framework 编译器和 Inno Setup 6，然后运行：

```powershell
pnpm install --frozen-lockfile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/release/build.ps1
```

默认启动器构建会刻意省略 HUB。`windows/launcher/build.ps1 -IncludeHub` 只保留给过渡期本地诊断使用，Desktop 发布流程不会调用它。

## 数据与卸载

标准数据位于 `%LOCALAPPDATA%\DeepSeekHarness`，便携数据位于 Desktop 可执行文件旁。升级和卸载会保留用户创建的数据，同时移除 Desktop 自己的 Runtime 和启动器文件。Desktop 卸载程序不会管理 HUB 数据。
