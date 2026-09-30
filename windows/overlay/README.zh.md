# DSH Overlay

[English](README.md) | 中文

面向已有 DSH 安装的独立按用户安装增强组件。它既不是 Full，也不是 Lite：载荷包含已编译的增强 Desktop/HUB/CONFIG 应用副本、完整启动器资源和更新后的 UI 包，但不包含 Node、基础 Runtime、下载器、基础 Profile 初始化程序、PATH 注册逻辑或基础程序卸载器。Microsoft Edge WebView2 Runtime 和 Windows PowerShell 5.1 必须已可用。安装器不会安装这些依赖，也不会在完成后启动应用。

## 构建与检查

在仓库根目录使用 Windows PowerShell 执行。所有生成的输出都保存在 `windows/overlay/artifacts` 下的新目录中，不删除已有构建。构建会在 `.tools/inno`、PATH 或标准 Inno Setup 6 位置查找 Inno，也可传入 `-IsccPath`。显式指定的启动器目录必须包含所需 EXE、DLL、目录数据及原生 Overlay 绑定支持；构建不会重新编译或修改该目录。所有文件都会递归复制，包括 `enhancements.js`、`mobile/relay.mjs` 和未来新增资源；请使用不含调试 fixture（测试前置数据）或私有数据的干净发行目录。遍历前会拒绝带链接的文件或目录。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/build.ps1 -LauncherDirectory 'D:\Builds\final-launcher' -OverlayPackagesDirectory 'D:\Builds\overlay-packages'
```

两个输入路径都必须是绝对路径。`overlay-packages/node_modules/@deepseek-ai/` 必须包含 `dsh-client-ui-setup-hub`、`dsh-client-ui-settings-general`、`dsh-client-ui-sidebar` 和 `dsh-client-ui-workspace` 的完整 `package.json`、已构建的 `lib`/资源以及任何新增依赖。也可将 `overlay-packages` 放入启动器输出，此时省略独立目录参数。构建会生成 `DSH-Overlay-Setup-0.1.0.exe`、编译日志、暂存文件哈希和 `build-result.json`。这是未签名的本地工程包，不是已通过发行验收的版本，也不是官方 Desktop 发行版。构建不会执行 Setup。

Setup 使用的同一只读计划可以独立运行。它输出 JSON，输入无效时以非零退出码失败；不会创建目录、执行 Node/CLI（命令行界面）、读取凭据或更改配置、注册表、环境。路径可包含空格、Unicode 和 `=`。必须使用显式本机绝对路径；UNC/设备路径、盘符根目录和含链接祖先的路径均会被拒绝。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/plan.ps1 -HostRoot 'D:\DSH' -RuntimeRoot 'D:\DSH\runtime' -NodePath 'D:\DSH\runtime\tools\node\node.exe' -DshHome 'D:\UserData\dsh' -StateRoot 'D:\UserData\overlay' -InstallRoot 'D:\Apps\DSH-Overlay'
```

Setup 会要求填写这些路径。无人值守使用时，传入 `/HOST=`、`/RUNTIME=`、`/NODE=`、`/DSHHOME=`、`/STATE=` 和 Inno 的 `/DIR=`，包含空格的完整参数需加引号。缺少值会使预检失败，而不是从环境中选择 Profile。准备安装页面会显示写入和保留范围，安装前还会再次验证。安装器仅创建常规 Inno 按用户注册项，以及专用开始菜单快捷方式 `DSH enhanced Desktop (Overlay)`、`HUB (Overlay)` 和 `CONFIG (Overlay)`，不会替换原始桌面或基础程序快捷方式。

## Runtime 与宿主支持

适配器遵循 legacy 启动器已有的编译后 CLI 优先级：先检查 `node_modules/@deepseek-ai/dsh/lib/bin.js`，再检查 `lib/bin.js`，最后检查 `apps/cli/lib/bin.js`。相邻包必须声明名称为 `@deepseek-ai/dsh`、版本为 `0.1.3-alpha.2`，且 `bin.dsh = lib/bin.js`。带打包 Runtime 标记的目录必须具备对应 JSON 和 `runtime-resolver.mjs`。Node 的 Windows 产品元数据必须报告 22.19+（22.x）或 24+。计划记录 CLI、包、Node 和 resolver 的哈希、观察到的宿主包/EXE 元数据以及显式 home，不会通过执行未知代码来探测兼容性。

已编译的 legacy 仓库 Runtime 无需复制依赖即可使用。仅有 TS/tsx 源码的仓库、缺失依赖的环境、普通 Desktop EXE、任意 CLI 版本和不可检查的 Electron/ASAR 内部文件都不视为受支持的 Runtime。可显式选择一个可检查的新版宿主，并配合另一个受支持的 legacy CLI Runtime。宿主元数据仅证明所选对象，不代表 HUB 理解该宿主的托管 Profile 或会话格式。必须显式指定已有 home，但不会解析或迁移其内容。**在对应适配器通过验收前，不要对新版宿主的托管 home 执行组件操作。** 实际依赖可用性、Web UI 就绪、插件激活和历史会话兼容性仍需分别进行 Runtime 验收。

若要支持其他 CLI 版本，应添加明确规定版本/Profile 要求并包含可执行 fixture 的适配器，而不是放宽版本检查或猜测参数。若要支持其他宿主的托管 Profile，应先实现所属宿主的 API 和数据保留测试。此处没有自定义 shell 命令适配器。

## 不写入基础程序的前端激活

`resolver.mjs` 仅将清单中的包映射到私有 `payload/overlay-packages/node_modules` 目录。它重定向所选包的裸导入/子路径、已解析的基础包文件 URL 和声明的仓库路径，并从基础 Runtime 解析未更改的依赖。alpha.2 适配器还包装 Node 的 CommonJS `_resolveFilename`，用于 `require.resolve` 包元数据查找；在已测试的 Node 版本上，仅同步 ESM hook 不会重定向该查找。这是明确的适配器级 Node 内部接口依赖，不是通用版本兼容声明。所选包文件缺失时会失败，而不是静默提供旧前端。

更新后的原生启动器在基础 Runtime resolver 之后显式导入此 resolver。包装器清空子进程的 `NODE_OPTIONS`，避免环境注入或重复的提前预加载；它从不修改用户环境。原生启动器重新应用导入参数，覆盖 CONFIG 的 Explorer 交接和配套进程启动。基础 `node_modules`、resolver、CLI、包元数据或 Profile 均不会被修改。父任务负责的启动器要求见 `INTEGRATION.md`；在复制的 Runtime 和隔离 home 上执行实际 HTTP bundle 字节验证的方法见 `tests/verify-activation.mjs`。

## 所有权与生命周期

安装目录、Overlay 状态目录以及基础程序/home/Runtime 路径不得重叠。非空安装目录需要本 Overlay 的绑定，非空状态目录需要对应的状态标记。Setup 仅通过常规 Inno 文件条目在自己的目录内写入 `overlay-binding.json`，从不写入状态目录、基础配置、首次配置标记、语言、Profile 或会话。卸载器只使用 Inno 跟踪的文件和快捷方式；没有自定义卸载代码、递归删除、杀进程、Runtime 移除、Profile 清理或用户数据复选框。未知文件不会被清扫，外部 Overlay 状态始终保留。

更新和修复复用稳定的 Overlay AppId 和目录。必须重新输入同一组六个显式路径，可在 `overlay-binding.json` 中查阅；更改绑定会被拒绝。同版本表示修复，高版本表示更新，低版本会被拒绝。载荷替换和卸载由常规 Inno 机制处理，请先关闭 Overlay 进程。基础 DSH 可保持安装或运行状态，但不要并发执行 Profile 操作。Runtime 的变更只有在修复/更新期间重新检查后才会被接受。已有状态和配置字节会保留；这并不回滚已迁移的数据。非空目录缺少绑定时会拒绝继续，应从备份恢复绑定，而不是接管任意文件。

快捷方式包装器在启动前验证 Runtime 证据和载荷哈希。第一次显式启动时，它仅以 create-new 写入方式创建独立的 Overlay 状态标记和最小 `config.json`，其中包含所选 RepoPath/NodePath 及未完成的首次配置状态。HUB/CONFIG 快捷方式以 HUB 模式打开 CONFIG；增强 Desktop 快捷方式使用 Desktop 首次配置流程。已有状态不会重新初始化。若保留的 CONFIG 路径不一致，启动会被拒绝并显示恢复提示，而不是覆盖偏好或允许启动器回退。Runtime/home/data/scope 均显式传递；环境覆盖仅作用于当前进程。HUB 默认使用隔离 Web Profile，保留现有启动器行为。后续用户在 Desktop/HUB/CONFIG 内显式执行的操作可能修改其配置指向的数据/home；安装安全约束不是这些应用的沙箱。

卸载后按相同路径重装会复用保留的 Overlay 设置，包括首次配置选择，不会重置基础程序的首次配置状态。使用另一个空状态路径会得到全新的 CONFIG。修复和卸载都不会删除状态。若要主动重新绑定，应卸载 Overlay、保留旧状态，再以新状态路径安装；不要通过编辑标记绕过验证。

## 对负责启动器的贡献者的集成要求

此处不更改 `MainApp`、`Config` 或共享构建/Setup 文件。父任务负责 `OverlayBinding.cs`、绑定的 Runtime/Node 选择、home/data 默认值、在 Runtime 之后导入 resolver，以及进程 AppUserModelID。构建会拒绝缺少标记字面量的旧启动器；这项静态检查不能替代原生交接测试。配套 Desktop 操作面向自有的增强副本，而不是原始宿主 EXE。`INTEGRATION.md` 记录实际标记和所需交接。新版官方 Desktop 在没有经过测试的专用 Profile 适配器时仍不受支持。

## 隔离验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/tests/verify.ps1
node windows/overlay/tests/verify-resolver.mjs
node windows/overlay/tests/verify-activation.mjs --runtime 'D:\Builds\baseline-runtime' --stage 'D:\Builds\overlay-stage'
```

计划测试使用本目录下唯一且保留的 D: fixture、**从不执行**的已编译 Node 元数据桩、最小合成 CLI 布局及哈希清单。它们调用实际使用的计划器、状态初始化程序和 prepare 入口，而不是安装器。resolver 测试以两种导入顺序执行合成模块。激活测试复制显式提供的打包 Runtime 和 Overlay 暂存目录，仅以经过清理的环境和隔离 home 启动复制品，获取实际提供的客户端 bundle 并比较完整字节，随后只停止并等待自己启动的 Node 进程。它们不触碰宿主安装、Shell Folders、注册表、真实 Profile 或旧 Setup smoke。静态 Inno 所有权检查不等同于实际安装器/卸载器或 UI 验收。准确结果和剩余验收项目见 `TESTING.md`。
