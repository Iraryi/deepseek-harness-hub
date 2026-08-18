# Agent Note: Windows 桌面发行版

Status: implemented

[English](2026-08-14-windows-desktop-distribution.md) | 中文

## 问题

由浏览器承载的 Web UI 并不是完整的 Windows 应用体验。面向用户的桌面发行版需要原生窗口、配置程序、可预测的本地服务启动、支持离线的安装、便携使用方式，以及无需用户自行组装 Node.js 工作区的发布格式。

服务与 UI 仍然是插件化的源码包，而不是单体可执行文件。如果没有明确的 Runtime 边界，打包过程只能把可变的源码目录复制进程序目录，或依赖系统全局安装的 Node.js 和包管理器状态。

## 决策

Windows 产品分为小型原生启动层和带版本的应用 Runtime。`windows/launcher` 将 `dsh.exe` 与 `dsh-config.exe` 构建为 WinForms 应用；主程序使用打包 Runtime 启动本地服务，并在 WebView2 内呈现其 Web UI。CONFIG 程序负责桌面显示设置和首次运行配置，同时不改变上游 Web UI 的插件模型。“保存并启动”会先写入两个配置文件、结束 CONFIG 的消息循环，再交给 Windows Shell 启动同级应用，因此首次运行严格复用“保存后再打开”的时序，并且不会继承 CONFIG 所在的进程 Job。

启动器把 CLI 输出的 `dsh web:` 行作为宿主就绪信号，因为该行只会在宿主 Loader 树稳定后输出。TCP 端口开始监听只是中间启动阶段：只有就绪行匹配当前回环端口时，WebView2 才会导航；同时 WebServer 的 index 路由还会等待 Loader 稳定后才注入客户端启动清单，避免端口已可连接但 profile 仍在整理时首次 `index.html` 得到空或不完整的客户端图。每次导航还会生成新的 `desktopBoot` 查询标记，避免持久 WebView2 状态复用上一次失败页面或迟到消息。随后浏览器内核通过 WebView2 明确报告 `loading`、`ready` 或 `failed` 状态；启动器只接受来自同源页面且携带当前标记的消息，记录 entry 状态与缺失服务，并且只在所有失败仍为 PENDING 时重试一次。如果恢复导航在 20 秒后仍没有最终结果，启动器会在保留恢复次数的情况下重启一次自己拥有的 Node 服务；重建后的服务会获得新的导航标记，之后再次失败就进入最终错误，不会循环。首次导航完全没有明确结果时仍采用 45 秒限制，并使用同一条单次服务恢复路径。启动器不会再从页面渲染文字推断就绪。启动器 smoke 会先打开端口再发布宿主就绪、拒绝提前导航，验证旧标记与单次恢复导航路径，再模拟一个始终 PENDING 的遗留客户端插件，并确认只重启一次 Node 服务就进入 ready。原生窗口会在创建 WebView2 前确定最终客户区、窗口模式和窗口样式，在两轮绘制完成前保持透明，并记录明确的首帧揭示事件后才启动服务，从而避免窗口调整或首轮重绘期间露出旧桌面画面。

`windows/runtime` 定义专用工作区部署根，校验其传递闭合的工作区依赖，实体化链接，内置私有 Windows Node.js 可执行文件及其 npm CLI，并生成清单与 Runtime ZIP。Runtime 还携带 ESM 解析钩子：当外部 `$DSH_HOME` profile 中的导入无法解析时，会从打包的 `node_modules` 重试，因此用户 profile 可以持久保存在可替换 Runtime 之外，而不必复制或链接整棵软件包目录。启动器会优先选择该私有 Node.js、npm 与解析钩子，而不是任何系统安装。在桌面约定不变时，插件变化继续通过打包后的 harness CLI 与 Runtime 内容交付，不要求重新编译原生启动器。DSHMK 安装会把 npm 标签解析为精确压缩包，或者继续使用已经验证的 GitHub Commit，下载并计算资产哈希后，再调用打包 Setup CLI 与私有 npm，不经过 shell 或系统 `pnpm`。用户 `$DSH_HOME` 下的 profile 目标保持非提权安装；权限失败会指出路径或 ACL 问题，不会因为缺少工具而触发 UAC。专用 DSHMK smoke 会安装并重新安装 `DSH-better-sidebar`，确认只有一条持久安装记录且 Bundle 已激活，并拒绝旧 `pnpm` 输出或无效 UTF-8 诊断。

`windows/setup` 提供 Full 与 Lite 两种 Inno Setup 安装包。Full 内置 Runtime ZIP 和带微软签名的 WebView2 离线安装器；Lite 下载带版本的 Runtime，并使用 WebView2 引导安装器。Full 默认使用不要求系统 Node.js、包管理器、Git、压缩包、环境变量或开发工具的小白流程：推荐安装会隐藏路径、数据位置和 Runtime 来源页面，并在确认前检查系统、位置可写性、临时目录与目标磁盘的合计可用空间、WebView2 状态、载荷来源和升级状态。六行检查结果默认不显示绝对路径，只有打开“技术细节”才会出现；按 DPI 缩放的操作按钮不会再裁切文字。高级选项仍保留便携数据、本地 Runtime ZIP 或文件夹导入、校验下载和源码 ZIP 构建；只有源码构建要求 Node.js 22.19 或更高版本与 `pnpm`，工具缺失时电脑检查会阻止继续。Runtime 准备会作为五个受监控的后台阶段运行，并由持续刷新的进度页承载；失败时会返回确认页供重试并持久化技术日志。已经压缩的载荷不会再被 Inno 重复压缩，压缩包哈希通过 .NET 加密 API 计算而不依赖 PowerShell 模块命令。Setup 会校验 Runtime 清单、内置 Node.js 与 Runtime 解析钩子、拒绝链接、通过 staging 与 backup 目录替换 Runtime、保留用户数据、在卸载时通过扩展长度路径删除打包 Runtime，并在依赖准备失败时于应用文件安装前停止。

标准数据位于 `%LOCALAPPDATA%\DeepSeekHarness`；便携数据位于可执行文件旁边的 `data`。首次使用会先打开 CONFIG，沿用 Setup 选择的语言，但保持首次配置未完成。Setup 每次安装都会只重置首次配置完成标记，因此即使卸载后保留了用户数据，重新安装仍会先进入 CONFIG。升级和卸载都会保留标准与便携模式中的用户创建数据，并在卸载时移除安装器自己注册的命令路径和 `DSH_HOME`。

`windows/release` 组合 Full Setup、Lite Setup、便携 ZIP、带版本的 Runtime ZIP、校验和、发布清单、Release 说明和带校验的下载器。GitHub Actions 在原生 Windows 上运行同一发布脚本并完成 smoke 测试，然后为匹配版本的标签发布这些文件。生成的二进制、下载的供应商缓存、解压后的 Runtime 目录和 smoke 测试目录都不会进入 Git 历史。

## 考虑过的替代方案

**在用户浏览器中打开本地 URL。** 这种方式能保持启动器小巧，但会继续暴露浏览器边框和浏览器进程行为，也无法提供独立的桌面显示与托盘约定。

**把整个服务塞进原生可执行文件。** 单文件会掩盖插件与工作区部署模型，使 Node 原生依赖更难处理，并导致普通服务或 Web UI 变化也必须重建启动器。

**要求全局安装 Node.js 与 pnpm。** 这能减小发布体积，但会让普通用户负责兼容的工具版本和可变的全局状态。只有源码 ZIP 构建这一明确的高级模式继续要求全局工具。

**只发布一个在线安装包。** 小型在线包适合可靠网络，但无法覆盖离线安装和手工转移。Full、Lite、本地 Runtime 导入和便携资产分别覆盖这些交付条件。

**把所有用户数据放进安装目录。** 这能简化路径查找，但会让标准升级和卸载变得不安全，也不符合 Windows 的每用户数据约定。便携模式通过明确选择使用相邻数据目录。

## 后果

Windows 用户获得原生应用入口、首次配置流程、离线与在线安装选择，以及不依赖系统 Node.js 的 Runtime。发行版体积更大，因为 Full Setup 与便携资产包含服务闭包和私有 Node.js，Full Setup 还包含 WebView2 离线安装器。

发布正确性依赖 Runtime 清单、工作区闭包校验、私有 npm 执行 smoke 覆盖、下载 WebView2 安装器的微软签名校验、静默安装与交互响应 smoke 覆盖、卸载残留断言和公开的 SHA-256 文件。Runtime 打包使用注入工作区软件包的现代 pnpm deploy 与隔离的 hoisted node_modules 树；开发依赖哨兵会拒绝任何改写源码工作区的部署路径。源码 ZIP 模式仍然较慢并依赖已有构建工具，而正常安装保持自包含。
