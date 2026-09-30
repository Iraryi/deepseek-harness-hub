# Relay implementation handoff / 中继实现交接

Scope is new `windows/mobile/**` and new `windows/launcher/src/MobileConnection.cs` only. Parent owns MainManager/bridge/UI, packaging, `HUB_EXECUTION_STATE.md` and repository-wide Agent Note integration. No shared file changes, commits, uploads, Setup builds, installed-app changes or real user-home access were performed by this task.

Observed source requirements: Connection's `BrowserAuth.authorizeIndex()` exchanges a root launch token with HTTP 303 and an authority-bound `dsh-auth-*` cookie; `requestRejection()` checks Host/Origin then cookie for HTTP and `/api/remote.mux`. Relay establishes upstream auth before binding and keeps it server-side. Existing `dsh-util-crypto` and Connection UUID helpers use `getRandomValues` on insecure origins. No session-protocol fork, blanket public assets exception or cryptography shim is necessary.

Validation uses actual sockets plus native child lifecycle and actual packaged DSH/browser integration. The native regression found and fixed the .NET stdin UTF-8 BOM interoperability case. Repeated HTTP connections found and fixed redundant socket listener registration. Status has no side effects. JSON arrays deserialize as `IList`/`ArrayList` in native responses; serialize them normally to the bridge rather than casting to `object[]`.

Security/product limits: HTTP bearer credentials are sniffable; paired devices are full operators. PWA's credential-free manifest request is intentionally 401 and PWA install is not qualified. No TLS, internet exposure, physical phone, paid inference or arbitrary plugin certification. Parent's DSH endpoint discovery must validate process identity and distinguish Desktop from HUB; this relay never discovers credentials from disk. Parent should marshal all blocking controller calls off the UI thread and dispose it with the owning manager.

范围仅为新增的手机中继目录和原生控制器。父级负责 MainManager、桥接、管理 UI、打包和共享执行记录；本任务未修改共享文件、提交、上传、构建 Setup、修改真实安装或访问真实用户主目录。验证涵盖实际 HTTP/WS、原生子进程生命周期及真实复制 DSH 的私人 IP 浏览器运行；不代表实体手机或完整发布验收。原生 JSON 数组应按 `IList` 读取并正常序列化，不要强制转成 `object[]`。HTTP 凭据可被监听，已配对设备拥有完整操作权限，TLS 和 PWA 安装不在当前实现范围。
