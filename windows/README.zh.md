# DeepSeek Harness Windows 桌面版

[English](README.md) | 中文

本目录负责非官方 Windows 桌面外壳及其发布流程。桌面窗口通过 Microsoft Edge WebView2 嵌入上游 Web UI，打包后的 DeepSeek Harness 服务在本机运行。

## 安装

请从 [DeepSeek Harness HUB Releases 页面](https://github.com/Iraryi/deepseek-harness-hub/releases)下载合适的资产。本仓库继续作为这些发行包背后的 Windows 实现与运行时层。

- `Full Setup` 是推荐的离线可用安装包，内置应用 Runtime、私有 Node.js Runtime 和微软 WebView2 离线安装器。
- `Lite Setup` 是小型安装包，会在线下载并校验应用 Runtime，也能导入从其他电脑下载的 Runtime ZIP。
- `Portable ZIP` 不注册安装信息，设置与用户数据保存在程序旁边；电脑必须已经具备 WebView2。
- `Runtime ZIP` 是可独立校验的服务载荷，供安装程序导入和修复模式使用。

正常使用 Full、Lite 或便携版不需要安装系统级 Node.js。打包 Runtime 包含 `tools\node\node.exe`、`npm.cmd` 和完整 npm CLI 目录；启动器与 HUB Setup 后端会使用这些私有文件，而不是任何系统 Node.js、npm 或 pnpm。

每种发行形式都包含普通 Desktop 入口 `dsh.exe`、全窗口 Setup 目录入口 `dsh-hub.exe` 和配置入口 `dsh-config.exe`。DSH HUB 始终运行在 WebView2 内，不会打开浏览器；它通过原生桌面桥打开 CONFIG，并以独立的同级进程启动普通 Desktop。本体与 HUB 使用彼此独立的单实例身份、本地服务端口、不同的 EXE 与托盘图标，以及分别保存于 `config.json` 和 `hub-config.json` 的设置，因此任意一方运行时都能打开并配置另一方。CONFIG 通过侧栏内的圆角双行产品卡片切换两个产品，本体与 HUB 选项会在卡片下方平滑展开；切换时会在暂停原生重绘期间完整构建下一套界面，再用单帧替换旧界面，因此普通窗口与最大化窗口的尺寸都保持不变，也不会暴露尚未完成布局的控件。替代界面会在显示前根据 `GetDpiForWindow` 缩放边距、表格绝对尺寸和固定控件尺寸，因此反复切换也不会退回 96 DPI 的布局大小。HUB 独立管理跟随系统／浅色／深色主题、启动功能区、默认发现来源、加载画面、关闭行为和专用托盘按钮。两者的 WebView 与托盘右键菜单都提供对应入口。本体保留 CONFIG 中的固定端口，HUB 每次启动服务前都会申请动态回环端口。跨进程文件锁只串行化会修改状态的 Node/profile 初始化阶段，并在 `dsh web` 报告就绪后释放，从而避免同时启动时争抢固定端口或并发修复 profile，同时不会耦合已经运行的两个服务。再次启动已有入口时，新启动器会通知运行中的进程恢复并前置现有窗口，不会让第二个进程静默藏在另一个无边框窗口后面。应用内部切换使用静默激活信号，用户直接重复启动 EXE 才使用带提醒的信号，因此右键切换和 HUB 的“返回主程序”不会再显示多余的模态提示。高 DPI 布局会保持搜索、排序、信任与分类控件以及 Setup 卡片可见，并在受限窗口中把紧凑筛选条切换成原生下拉框。

HUB 默认使用独立的 `hub\runtime-home` Web Profile，因此本体侧栏与 Web UI 插件不会改变 HUB 界面；CONFIG 可以显式开启 profile 共享。本体设置中的 DSH HUB 标签只作为组件管理器，展示已安装记录、预备 Setup 工作区、离线包、卸载操作和可交给 AI 编辑的路径；发现功能仍在独立 HUB 进程中。

## 安装程序参考

Full 安装包是面向普通用户的默认选择。正常流程依次为语言、欢迎、推荐安装、电脑检查、确认、五个可见准备阶段和完成。推荐安装会隐藏程序路径、数据位置和 Runtime 来源页面，自动使用当前用户程序目录、标准用户数据目录、内置应用 Runtime、缺失时自动安装 WebView2、开始菜单快捷方式和桌面快捷方式。应用首次启动时会先打开 CONFIG，再进入主窗口，用户可设置语言、分辨率、启动形式、加载画面、托盘行为和可选的浏览器扩展目录。

正常安装不需要 Node.js、`pnpm`、Git、环境变量、压缩包或任何开发工具，因为 Full 安装包已经携带私有 Node.js Runtime 和完整应用本体。高级选项才会显示便携数据与其他 Runtime 来源，包括经过校验的 GitHub 下载、本地 Runtime ZIP、已有 Runtime 文件夹或 GitHub 源码 ZIP。只有源码 ZIP 模式要求 Node.js 22.19 或更高版本与 `pnpm`；电脑检查会在工具缺失时阻止该模式继续，并允许恢复推荐安装。

电脑检查会以六行紧凑结果展示系统、程序位置、用户数据、磁盘空间、WebView2 和应用本体；绝对路径与诊断默认收在“技术细节”中。检查会使用构建时记录的压缩体积和安装体积计算临时目录与目标磁盘同时占用的空间，验证位置是否可写，区分全新安装与升级，并能通过恢复推荐设置自动修复高级选择。安装程序会检测 WebView2，并在缺失时安装。Runtime 与依赖准备会经过五个持续响应的进度阶段，不再阻塞向导；失败时会返回确认页供用户重试，并在 `%LOCALAPPDATA%\DeepSeekHarness\InstallerLogs` 保留可读技术日志。已经压缩的 Runtime 与 WebView 载荷不会再被 Inno 重复压缩。Runtime 压缩包使用 .NET 加密 API 计算哈希，不依赖 PowerShell 模块命令。Runtime 替换使用 staging 和 backup 目录，因此校验或复制失败时会保留原 Runtime。卸载时会通过 Windows 扩展长度路径删除打包 Runtime，并继续保留用户创建的数据。

打包 Runtime 包含一个 ESM 解析钩子，会从自身的 `node_modules` 重试无法解析的裸插件导入。用户 profile 与设置仍保存在 `$DSH_HOME`，但其中引用的内置插件会从已安装 Runtime 解析，无需在 profile 旁复制软件包或创建链接。Runtime 构建使用注入工作区软件包的现代 pnpm deploy，并把 hoisted 输出隔离在 Runtime 目录；构建过程会验证部署没有改写源码工作区的开发依赖。HUB 软件包 Setup 会先下载清单声明的资产并验证 SHA-256，再使用私有 npm 安装已校验的本地包；除非展示出的清单声明 `install-scripts`，否则生命周期脚本保持禁用。DSHMK 候选也使用同一条路径：npm 名称和标签先解析为精确版本压缩包，GitHub 候选继续固定到已验证 Commit，HUB 按 SHA-256 缓存资产后调用打包 Setup CLI，而不再经过 `dsh plugin`、`pnpm` 或 `cmd.exe`。普通 profile 安装写入用户自己的 `$DSH_HOME`，因此不会索要 UAC；真正的路径或 ACL 权限错误会被明确报告，而不会伪装成缺少包管理器。Setup 进度界面会分别限制预检、下载、解压、依赖安装、profile 修改、Bundle 激活与安装后验证阶段，并统一负责取消、重试、日志和最终按钮复位。成功激活后可以向正在运行的 Desktop 发送 `--reload-silent`，在不替换原生宿主、也不显示重复实例提醒的情况下重启其 Node 服务。

安装结束后，HUB 会持续显示醒目的重启入口，直到本体重载成功；该操作只重启本体并保持 HUB 运行。静态的下载、已安装、成功与禁用图标不会旋转，只有确实存在待处理请求的操作使用忙碌动画。

DSH HUB 使用 Setup 清单，不会把任意 GitHub 源码伪装成 EXE。它的功能工作台包含 DSHMK 发现、社区精选市场、GitHub 全域匿名发现、使用 DPAPI 保护令牌的账户与 Star 登录、可编辑 Setup 库、默认不执行文件的离线收件箱、持久安装记录、profile 软件包移除与 Setup 构建器。DSHMK 是默认来源，会同步在线标签、目录页、验证元数据、安装参考、相关项目与详情内容，同时保留本机缓存和随程序携带的 2,888 项最近可用快照。12、24、48、96 与 200 条分页会跨启动保存。卡片默认在一键 Setup 旁提供独立的“项目详情”按钮；CONFIG 可以单独恢复整卡点击，并选择重构后的侧边详情、主题模态层、全画面详情或应用内原网站内容。关闭详情后会恢复原页码与滚动位置。社区精选市场作为经过筛选的通用安装来源排在其后，GitHub 全域则只承担候选发现，可以创建构建草稿但不能绕过审核。存在项目图形时必须使用真实图形，不能以文字首字母代替。独立维护的 [Setup 库](https://github.com/Iraryi/deepseek-harness-setups)会生成固定 Commit 的 GitHub 来源 Setup 界面、隔离证据不完整的候选，并且只从经过审核的清单构建独立 Inno Setup EXE。所有交互路径都会展示来源、许可证、签名、审核、权限、网络和资产证据。

DSHMK 把排序保留在搜索旁边，并把搜索范围、同步 TAG／分类、项目类型、验证与一键安装能力、仅本地构建状态和每页数量收进一个圆角分层筛选器。目录选择会同时比较生成时间、仓库数量和可安装覆盖率，因此降级刷新不会把健康市场整体变成“需要本地构建”。

本地 TCP 端口打开后，启动器仍会保持加载画面，直到 `dsh web` 报告完整宿主 Loader 插件图已经稳定，才允许 WebView2 导航。每次导航都会使用新的 `desktopBoot` 标记；浏览器会明确报告插件 `loading`、`ready` 或 `failed` 状态，启动器只接受来自同源页面且匹配当前标记的消息，不再读取页面渲染文字。只有所有失败 entry 仍在等待服务时才会重试一次，导入或激活失败则立即停止，并把 entry 与缺失服务详情写入启动器日志。如果恢复导航在 20 秒后仍没有最终结果，启动器会重启一次自己拥有的 Node 服务并重建导航标记；第二次仍失败就进入最终错误，不会循环。WebView2 smoke 会证明仅有端口可连接时不会提前导航、旧状态无法完成新页面、快速重试路径只执行一次恢复导航，并且遗留插件卡住时只重启一次服务就进入 ready。

标准数据位于 `%LOCALAPPDATA%\DeepSeekHarness`。便携数据位于 `dsh.exe` 旁边的 `data`。升级和卸载都会保留用户创建的数据；卸载会移除打包 Runtime 和启动器文件。

## 构建参考

在 Windows x64 源码目录中准备 Node.js 24、`pnpm`、.NET Framework 编译器和 Inno Setup 6，然后运行：

```powershell
pnpm install --frozen-lockfile
powershell -NoProfile -ExecutionPolicy Bypass -File windows/release/build.ps1
```

该脚本会构建三个 WebView2 启动入口、构建闭合的工作区 Runtime、按需下载并校验微软签名的 WebView2 安装器、编译 Full 与 Lite Setup、运行安装 smoke 测试、创建便携 ZIP 和带版本号的 Runtime ZIP，并在 `windows/release/dist` 写入 `release-manifest.json` 与 `SHA256SUMS.txt`。

使用 `windows/release/download.ps1` 可以下载并校验已发布的 Full、Lite、便携或 Runtime 资产。`windows/setup/install-runtime.ps1` 负责本地压缩包、文件夹和源码安装，并以原子方式替换 Runtime。

## 源码布局

- `launcher` 包含 WinForms/WebView2 Desktop、独立 HUB 与 CONFIG 程序。
- `runtime` 定义并构建传递闭合的服务载荷及其私有 Node.js Runtime。
- `setup` 包含 Inno Setup 工程、Runtime 安装脚本、首次运行配置写入、静默安装 smoke 测试和本地交互响应探针。
- `release` 负责组合最终资产、校验和、Release 说明和带校验的下载器。
