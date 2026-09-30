# Mobile relay integration / 手机中继集成

For parent and Kuhn (`01a0ee43-fea6-72d1-9682-b4d8d7e11d86`). This task has no agent-message tool; this file is the shared handoff. No existing/shared files are changed by the relay owner.

## Native controller

`MobileConnection : IDisposable` (no namespace, .NET Framework-compatible). Invoke blocking operations on a worker, never the UI thread. Methods return `Dictionary<string, object>` JSON-ready results and throw actionable exceptions on failure:

- `Status()` works before Start and after Stop, without spawning Node.
- `Start(string nodeExecutable, string scriptPath, string upstreamUrl, string bindAddress, int port, bool trustedLanConsent, string upstreamAuthUrl = null, string upstreamCookie = null)` explicitly spawns installed Node with the provided `.mjs` path; no discovery/download/autostart. `port = 0` selects an ephemeral port. Pass an RFC1918 IPv4 belonging to a local interface, never wildcard/public/loopback in production.
- `Pair()` creates/replaces a single-use 256-bit pairing grant, valid 120 seconds. Returns `{url, expiresAt}`; show/copy this URL only on explicit user request, never log it. Fragment carries secret; opening alone does not pair. Phone must consent and submit.
- `Revoke(string deviceId)` invalidates that device immediately and closes its active HTTP/WS connections.
- `Stop()` closes the listener, all streams/devices/grants and child process; repeat-safe. `Dispose()` permanently closes this controller.

Status: `{running, bindAddress, port, url, upstreamUrl, transport:"http-trusted-lan", devices:[{id,name,pairedAt,lastSeen,expiresAt}], pairingExpiresAt}`. Inactive fields are null/empty; `running:false`, devices empty. No credentials or pairing secrets in status. `url` is the public pairing landing page without a secret, not an authenticated application URL. Timestamps are ISO UTC strings. `Pair()` result is distinct from status. Revoke/Stop/Start return status.

**DSH is not HUB.** Parent must derive the explicit DSH endpoint from `AppConfig.Load().Url/Port`, never HUB `_activeUrl`, `_activePort`, or `_authenticatedUrl`. Current DSH requires a launch-token exchange (`/?token=...`) to mint an authority-bound browser cookie; HTTP API and `/api/remote.mux` both enforce Host/Origin plus this cookie. Provide a DSH-only authenticated launch URL via `upstreamAuthUrl` or an existing DSH-only browser cookie via `upstreamCookie`, through stdin only. They must belong to the same configured loopback origin. Relay retains the cookie in memory, never exposes it to phones. If the supplied DSH endpoint returns 401 without usable credentials, Start fails `upstream_auth_required`; do not quietly relay HUB or bypass authentication. Parent can prompt for the DSH launch URL when sibling-process credential handoff is unavailable. No reading real user home or credentials files.

## Child protocol

`node <absolute windows/mobile/relay.mjs>` waits on stdin with no listener. Newline-delimited JSON, UTF-8, one response per command: `{id,command,...}` -> `{id,ok:true,result}` or `{id,ok:false,error:{code,message}}`. Commands: `status`, `start` (fields named as native Start except executable/script), `pair`, `revoke` (`deviceId`), `stop`. Async events: `{event:"status",status}` and initial `{event:"ready",protocol:1}`. Stop stops serving; stdin EOF or parent death exits child after cleanup. Parent owns process termination and awaits exit. Never forward the entire protocol to public HTTP.

## Security and UI wording

Explicit checkbox before Start: **HTTP is unencrypted. Anyone observing this trusted LAN can steal the pairing/device secret and control DSH, including agent tools and accessible files. Use only a private trusted LAN. Do not use public Wi-Fi, port forwarding, or internet exposure.** Paired devices are full DSH operators, not read-only guests. Revoke/Stop do not cancel already accepted DSH jobs. No firewall or registry edits. TLS via an external adapter is a future extension, not supported/claimed secure here.

启动前必须明确勾选：**HTTP 不加密，同一局域网的监听者可能窃取配对信息并控制 DSH（包括工具及可访问文件）。仅限受信任的私人局域网，禁止公共 Wi-Fi、端口转发和互联网暴露。** 已配对设备具有完整 DSH 操作权限，不是只读访客；撤销或停止不会取消 DSH 已接收的任务。不要把 HUB 地址或令牌当成 DSH 地址或令牌。

Frontend agent owns the HUB management page; relay owner owns the small phone consent/pair landing page served at `/__mobile/pair`. Authenticated requests relay the existing DSH app without implementing a second session API. Public endpoints are limited to the static pair page and the one-time pair submission; every other HTTP/WS request authenticates before contacting upstream.
