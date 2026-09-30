# DSH trusted-LAN mobile relay (beta)

English | [中文](README.zh.md)

This optional relay serves the existing DSH Web UI, RPCs, uploads, streamed HTTP and WebSockets on a selected private IPv4 interface. It does not implement another session API or start DSH. Production runtime uses Node built-ins only; no npm install, download, firewall change, registry change or user-home discovery is performed. The native owner supplies an installed Node executable and explicit relay script path.

## Trust limits

**HTTP is unencrypted. Use only a trusted private LAN. A network observer can steal pairing/device secrets and obtain full DSH operator access, including agent tools and accessible files. Never expose this listener through internet forwarding, a public hotspot or an untrusted network.** Both desktop Start and phone pairing require affirmative consent. Pair only devices you control. Revoke and Stop prevent subsequent access and close active relay transports; they do not undo accepted DSH requests or cancel running agent jobs.

The relay is not a read-only or filesystem sandbox. An authenticated device can operate DSH's existing services and permissions. No unauthenticated backend, filesystem, settings or credentials endpoint is forwarded. The only anonymous responses are the self-contained pairing HTML/JavaScript and the pairing exchange, which requires a valid one-use secret. There is no public control/status/revoke API. A browser's credential-free PWA manifest request remains denied; PWA installation and secure-context-only browser features are outside this HTTP beta. TLS termination is a future adapter, not an implemented security claim.

## Parent integration

The exact native and newline-JSON interfaces are in [CONTRACT.md](CONTRACT.md). Include the new `windows/launcher/src/MobileConnection.cs` in the native build, and copy this directory's `relay.mjs`, `pair.html` and `pair.mjs` together to the explicitly selected installed script location. Call blocking native methods using the parent-owned background operation; do not block the UI thread. Construction and `Status()` do not spawn Node or bind a port. `Start()` owns one child; `Stop()` and `Dispose()` await its exit. Child stdin EOF, signals and loss of its parent shut the relay down. A crashed child is reported stopped rather than silently restarted.

Select the **DSH** endpoint, never HUB's endpoint or credentials. Parent discovery must validate the running DSH process and actual bound port. Pass its sanitized loopback HTTP origin as `upstreamUrl`, and its current `/?token=...` launch URL separately as `upstreamAuthUrl`. Alternatively, provide an existing DSH browser cookie using `upstreamCookie`. The relay performs the launch-token exchange locally, keeps the returned authority-bound cookie in memory, and requires authenticated `/` to return HTTP 200 before listening. No URL redirects are followed during preflight. An unreachable or unauthorized DSH fails Start with an actionable error. Node accepts `127.0.0.1`, `[::1]` and `localhost` (normalized to `127.0.0.1`); it rejects remote upstreams, credentials in URL authority, non-root paths, queries and fragments in `upstreamUrl`.

Select one RFC1918 IPv4 address assigned to the computer; wildcard, public, hostname and production loopback listeners are rejected. `port:0` requests an ephemeral port. Parent may enumerate interface choices and report unavailable dependencies without launching anything. The parent owns DSH discovery, bridge authorization, operation progress, executable/script availability and packaging. It must keep discovered credentials and pairing URLs out of diagnostics and generic UI snapshots. Restart/re-authenticate the relay after a DSH restart if its cookie ceases to authenticate.

## Pairing and lifecycle

After explicit Start, use `Pair()` to obtain `{url, expiresAt}`. A cryptographically random 256-bit secret lives in the URL fragment, not the query. The phone removes the fragment from browser history before submitting it. Opening a link alone does not grant access: the phone must check the warning and submit. A new grant replaces the previous grant; it expires after two minutes or one successful use. No QR/image service or remote asset is contacted.

Successful pairing creates an independent random device secret in an HttpOnly, SameSite=Strict cookie. Device names are bounded display labels, not verified identities. Up to 16 devices can remain paired for eight hours; all sessions and secrets are memory-only. Desktop status lists opaque IDs, names and timestamps but no secrets. `Revoke(id)` closes that device's HTTP and WebSocket connections. Stop erases grants/cookies/devices and closes the listener plus all upstream connections. Closing a phone tab alone does not revoke it.

Host must equal the relay's literal address/port. Foreign/null Origin and cross-site metadata are rejected before upstream access; writes and WebSocket upgrades require the exact relay Origin. The relay then rewrites Host/Origin and injects only its private DSH cookie. Phone Authorization, Cookie and forwarding headers do not reach DSH. Upstream cookies are stripped from responses; same-upstream redirects become relative, while external/token-bearing redirects are blocked. Pair attempts are limited to 30 per minute, JSON bodies to 4 KiB, headers to 16 KiB, connections to 128 and control input to 64 KiB/64 queued commands. DSH preflight has a four-second deadline per request, WebSocket handshake five seconds, request-body receipt thirty seconds and HTTP upstream inactivity sixty seconds. Native commands time out after fifteen seconds and terminate their owned child.

## Validation

From the repository root, with the repository's already installed test `ws` dependency:

```powershell
node --test --test-timeout=15000 windows/mobile/tests/relay.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File windows/mobile/tests/verify-native.ps1
node windows/mobile/tests/real-dsh-smoke.mjs <copied-runtime-on-D:> <explicit-private-IP> <installed-msedge.exe>
```

The first suite uses real loopback HTTP/WS sockets with a fake DSH requiring both its own cookie and rewritten Host/Origin. It covers GET/POST, binary/text WS, streamed HTTP, public-endpoint denial, expiry, invalid/replaced grants, revoke, stop/restart, stdin EOF, bounded attempts, redirects and keep-alive cleanup. Only an explicitly imported test fixture can allow a loopback relay bind; no CLI/start-command flag enables that exception. Production `relay.mjs` stays dependency-free. The native harness compiles only itself plus `MobileConnection.cs` into `tests/.output` on D:, then exercises the actual Node child protocol and process exit; it does not build Setup or modify an installed launcher.

The real-browser smoke consumes an existing copied Runtime on D:, starts its actual DSH server with a fresh isolated DSH home, and uses an installed headless browser with a new private profile. It requires an explicitly selected local private interface; it never opens a firewall. It verifies that the origin is genuinely insecure (`isSecureContext=false`, `crypto.randomUUID` absent), pairs through the page, loads actual DSH assets, receives actual WebSocket events, creates an isolated workspace and session through owning APIs, selects New session in the UI, verifies a mounted composer and checks post-revoke denial. It makes no LLM/provider call. Its logs redact launch tokens, and artifacts stay in ignored `tests/.output` directories.

Validated on Windows with Node 24.18.0: 12 relay tests, 32 native assertions and a 390×844 private-IP Edge run with an actual copied DSH Runtime, workspace/session creation, composer visible, 14 received WebSocket frames, no browser exceptions and no horizontal overflow. The final browser evidence at implementation time is `tests/.output/real-ebafdb49-d2dd-4668-b576-6fbe1ee49ce5/result.json`, with pairing and composer PNGs beside it. This is not physical-phone/Wi-Fi, iOS/Safari, TLS, arbitrary third-party plugin, paid-model or complete release qualification. Native shell-only features do not become phone features merely because the Web UI is relayed. Existing core DSH UUID helpers support insecure origins; no crypto polyfill or HTML rewriting is added.
