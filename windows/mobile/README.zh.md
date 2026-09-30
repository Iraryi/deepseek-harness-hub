# DSH 受信任局域网手机中继（Beta）

[English](README.md) | 中文

此可选中继在指定的私人 IPv4 网卡地址上提供现有 DSH Web UI、RPC、上传、HTTP 流和 WebSocket。它不另建会话 API，也不启动 DSH。生产运行时仅使用 Node 内置模块，不执行 npm 安装、下载、防火墙或注册表修改，也不查找真实用户主目录。原生管理端必须明确提供已安装 Node 可执行文件和中继脚本路径。

## 信任限制

**HTTP 不加密。仅限受信任的私人局域网。网络监听者可能窃取配对或设备密钥，获得完整 DSH 操作权限，包括智能体工具及可访问文件。禁止互联网端口转发、公共热点或不可信网络。** 电脑端启动和手机端配对都必须明确同意风险，仅配对自己控制的设备。撤销或停止会阻止后续访问并关闭中继连接，但不会撤回 DSH 已接收的请求，也不会取消正在执行的智能体任务。

中继不是只读模式或文件系统沙箱。已认证设备可操作 DSH 原有服务，其权限仍由 DSH 管理。任何未认证的后端、文件系统、设置或凭据接口都不会转发。匿名响应仅包括独立配对 HTML/JavaScript 和要求有效一次性密钥的配对交换。不存在公开的管理、状态或撤销接口。浏览器不携带凭据的 PWA manifest 请求仍被拒绝；HTTP Beta 不支持 PWA 安装及要求安全上下文的浏览器功能。TLS 终止仅是未来扩展方向，不是已实现的安全保证。

## 父级集成

原生及换行 JSON 接口详见 [CONTRACT.md](CONTRACT.md)。原生构建需包含新增的 `windows/launcher/src/MobileConnection.cs`；将本目录的 `relay.mjs`、`pair.html`、`pair.mjs` 一起复制到明确选择的安装脚本位置。阻塞方法应通过父级拥有的后台操作调用，不能阻塞 UI 线程。构造对象和 `Status()` 不启动 Node、不监听端口。`Start()` 拥有一个子进程；`Stop()` 和 `Dispose()` 等待其退出。stdin 关闭、退出信号或父进程消失会关闭中继；子进程异常退出后显示已停止，不会自动重启。

必须选择 **DSH** 地址，不能使用 HUB 地址或凭据。父级发现逻辑应验证 DSH 进程仍在运行及其实际端口。将不含凭据的回环 HTTP 根 origin 传入 `upstreamUrl`，将当前 `/?token=...` 启动 URL 单独传入 `upstreamAuthUrl`；也可通过 `upstreamCookie` 提供现有 DSH 浏览器 cookie。中继在本机完成令牌交换，仅在内存保留绑定到上游地址的 cookie，并在带认证的 `/` 返回 HTTP 200 后才开始监听。预检查不会跟随重定向。DSH 不可达或未授权时，Start 返回可操作错误。Node 接受 `127.0.0.1`、`[::1]` 和 `localhost`（规范化为 `127.0.0.1`）；拒绝远端上游、URL authority 中的凭据，以及 `upstreamUrl` 中的非根路径、查询或片段。

选择属于本机网卡的一个 RFC1918 IPv4 地址；拒绝通配、公网、主机名及生产模式下的回环监听地址。`port:0` 使用系统分配的端口。父级可以列出网卡选项或报告缺失依赖，而不启动任何进程。DSH 发现、桥接授权、操作进度、可执行文件/脚本检查及打包由父级负责。发现的凭据和配对 URL 不得进入诊断或普通 UI 状态快照。DSH 重启后若 cookie 失效，应重新启动中继并重新认证。

## 配对与生命周期

明确启动后，调用 `Pair()` 获得 `{url, expiresAt}`。256 位密码学随机密钥置于 URL fragment，不放入 query。手机会在提交前从浏览历史地址中移除该片段。打开链接本身不会授权；必须勾选风险确认并提交。新配对链接会替代旧链接；两分钟后或成功使用一次后立即失效。不调用二维码服务或其他远端资源。

配对成功后，独立随机设备密钥保存在 HttpOnly、SameSite=Strict cookie 中。设备名称只是有长度限制的显示标签，不代表经过验证的身份。最多允许 16 台设备，授权八小时；所有会话和密钥仅保存在内存。电脑端状态包含不透明 ID、名称及时间戳，不包含密钥。`Revoke(id)` 关闭该设备的 HTTP 和 WebSocket 连接。Stop 清除配对链接、cookie 和设备，并关闭监听及所有上游连接。仅关闭手机标签页不会撤销设备。

Host 必须精确匹配中继 IP 和端口。外来或 null Origin、跨站元数据会在访问上游前被拒绝；写请求和 WebSocket 升级必须携带精确匹配的中继 Origin。通过后，中继才会重写 Host/Origin 并注入私有 DSH cookie。手机端 Authorization、Cookie 及转发头不会传给 DSH。响应中的上游 cookie 会被剥离；同上游重定向改为相对地址，外站或携带 token 的重定向被阻止。配对尝试每分钟最多 30 次，JSON 请求体最多 4 KiB、请求头 16 KiB、连接 128 条、控制输入 64 KiB/64 条排队命令。每次 DSH 预检查限四秒，WebSocket 握手五秒，请求体接收三十秒，上游 HTTP 无数据六十秒。原生命令十五秒超时后终止其拥有的子进程。

## 验证

在仓库根目录运行，使用仓库已安装的测试用 `ws` 依赖：

```powershell
node --test --test-timeout=15000 windows/mobile/tests/relay.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File windows/mobile/tests/verify-native.ps1
node windows/mobile/tests/real-dsh-smoke.mjs <copied-runtime-on-D:> <explicit-private-IP> <installed-msedge.exe>
```

第一组测试通过真实回环 HTTP/WS socket 连接模拟 DSH；模拟上游同时检查自己的 cookie 和重写后的 Host/Origin。覆盖 GET/POST、二进制和文本 WS、流式 HTTP、未认证接口拒绝、过期及替换配对链接、撤销、停止/重启、stdin EOF、尝试次数限制、重定向和 keep-alive 清理。只有显式导入的测试 fixture 可允许回环监听，CLI/start 命令不提供绕过参数。生产 `relay.mjs` 不依赖第三方包。原生测试仅将测试程序及 `MobileConnection.cs` 编译到 D: 的 `tests/.output`，随后验证真实 Node 子进程协议和退出；不会构建 Setup 或修改已安装启动器。

真实浏览器 smoke 使用 D: 上已复制的 Runtime，以新的隔离 DSH home 启动实际 DSH 服务，并使用已安装无头浏览器和全新独立配置目录。必须明确选择本机私人网卡，脚本不会开放防火墙。测试确认页面确实是不安全上下文（`isSecureContext=false`、不存在 `crypto.randomUUID`），通过配对页面完成连接，加载真实 DSH 资源，接收真实 WebSocket 事件，通过拥有该能力的 API 创建隔离工作区和会话，在 UI 点击“新建会话”，检查输入框已挂载，并验证撤销后的访问拒绝。不调用模型或提供商。日志会隐藏启动令牌，产物仅保存到被忽略的 `tests/.output` 目录。

已在 Windows、Node 24.18.0 下验证：12 项中继测试、32 项原生断言，以及使用真实复制 DSH Runtime 的 390×844 私人 IP Edge 浏览器运行；工作区和会话创建成功，输入框可见，收到 14 帧 WebSocket 消息，无浏览器异常和横向溢出。实现时最终浏览器证据为 `tests/.output/real-ebafdb49-d2dd-4668-b576-6fbe1ee49ce5/result.json`，同目录保存配对及输入框 PNG。此验证不等于实体手机/Wi-Fi、iOS/Safari、TLS、任意第三方插件、付费模型或完整发布验收。仅原生外壳提供的能力不会因 Web UI 中继自动成为手机功能。DSH 核心 UUID 工具已支持不安全 origin，因此未注入 crypto polyfill，也未改写 HTML。
