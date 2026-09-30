# Overlay verification checkpoint — 2026-09-30

This task changes only new `windows/overlay/**` source/docs. Shared native launcher integration and final launcher/package staging belong to the parent task. No installer/uninstaller was executed; no host installation, registry, Shell Folders or real profile was edited. No old Setup smoke, commit or publication was performed.

## Passed checks

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/overlay/tests/verify.ps1`: **46 assertions passed** on Windows PowerShell 5.1. Evidence: `tests/fixtures/752f980a0141492c9b89b1eee0348bef/result.json`. Covers compiled legacy/package/runtime layouts, explicit newer host metadata inspection, read-only planning, path overlap/alias/UNC/device/junction rejection, foreign directory rejection, same-version repair, update, downgrade/rebind refusal, retained/invalid/unknown config handling, independent Desktop/HUB/CONFIG plans, runtime hash drift, real prepare/plan entry points, UTF-16 request handling with Unicode and `=`, duplicate request rejection, recursive payload integrity and static Inno ownership rules. Node metadata fixture is compiled but never executed.
- `node windows/overlay/tests/verify-resolver.mjs`: **9 resolver scenario checks passed**, Node `v24.18.0`. Evidence: `tests/fixtures/resolver-ZEw7xJ/result.json`. Exercises bare imports, subpaths, `require.resolve` metadata, absolute base package URLs, unchanged dependency resolution, actual new client bytes, preserved base bytes, missing selected package fail-closed behavior, and both Overlay-first/Runtime-last and Runtime-first/Overlay-last orders. Unicode/space paths are included. This is a synthetic resolver test, not the HTTP proof below.
- `node windows/overlay/tests/verify-activation.mjs --runtime windows/launcher/dist-preload-verified2-20260930/warm-fixture-1cae0c88aa4b4244b636f1a9ae0d7fe7/runtime --stage windows/overlay/artifacts/71a5b4dc/stage`: **passed:true; exactly four served-package proofs; 12 actual resolution paths**. Evidence: `tests/fixtures/activation-fMd2Lg/result.json`, `boot-graph.json`, `index.html`, redacted `service.log`. The runner copies the source Runtime and stage into a fresh D: fixture, resolves each package's host/client/metadata inside Overlay, boots the copied real CLI using an isolated HUB-style home, follows the advertised revisioned boot-graph URLs and verifies all executable bundle bytes. Only the server's documented sourceURL/sourceMappingURL trailer rewriting is accounted for. HTTP success or `serviceStarted:true` alone cannot pass.
- Actual service Node: `v24.18.0`; Runtime CLI baseline: `0.1.3-alpha.2`. All four client executable bodies match the staged Overlay bundles. HUB additionally contains `Management overview` and differs from the old runtime. The sidebar bundle happens to be identical to this baseline, but its real resolution paths are private Overlay paths. Source Runtime and copied base Runtime complete file inventories remain unchanged after the owned service exits.
- Inno Setup **6.7.3** found at repository `.tools/inno/ISCC.exe`; engineering compilation succeeded using parent `dist-manager-integrated-20260930` plus four-package input `artifacts/manager-packages-20260930`. Recursive payload includes all three EXEs, enhancements JS, mobile relay/page assets and UI packages. Setup was not run. Initial long staging paths exceeded compiler file-access limits; build now uses short unique run names and checks source path length before compilation instead of dropping files.

## Actual package hashes

| Package suffix | Overlay `lib/client.js` SHA-256 | Different from base |
| --- | --- | --- |
| ui-setup-hub | `3bd966ac91c59995337cdc7057e8c6de28dc73e68cd491887fa0eafd05a74177` | Yes |
| ui-settings-general | `1126f62a5439fd3c998d7cf34b6e8a7eb08c9e7bf247de64fde8ea5d90825f66` | Yes |
| ui-sidebar | `5da7d2c617806d93dd2766471d98b00d03a9b3a297b755daa718d476fa5a549e` | No |
| ui-workspace | `776b5e4d6a2cc9b60a57652ccddd994ada64e173a2e9b6d99b93b63282689c6c` | Yes |

Raw HTTP response hashes vary with generated source-map revision URLs; result JSON also records stable executable hashes and exact source/served comparisons. Earlier retained `activation-xHlY0n` and `activation-MtG0Sz` fixtures are failed test iterations (unversioned route, then source-map trailer mismatch), not successful activation evidence. `activation-wb3e9a` passed four executable proofs before the explicit `passed` field and strict four-package count were added; use `activation-fMd2Lg` as the acceptance evidence.

## Engineering package, not final release

### Final-input build handoff

The parent has now supplied clean `windows/launcher/dist-enhancements-final-20260930` and `windows/overlay/artifacts/final-packages-20260930` and explicitly requested this task to compile engineering version `0.1.0` in a fresh output directory. Both bilingual READMEs, integration instructions and this testing checkpoint exist before staging. The resulting build's adjacent `build-result.json` is authoritative for its EXE path, size and SHA-256; `final-validation.json` records final staged payload/hash checks and actual activation evidence after compilation. The parent should not duplicate this build. The older package below remains only historical compilation evidence. All no-install/no-publication restrictions remain in force.

The parent reports final mobile validation of 12 relay tests, 32 native checks and 14 private-IP DSH session/composer WebSocket checks. Those are parent-reported results, not tests executed by this Overlay packaging task; unchanged relay/page bytes are included recursively in the final payload.

`artifacts/71a5b4dc/output/DSH-Overlay-Setup-0.1.0.exe`: **3,572,966 bytes**, SHA-256 `3e3e2c0de0a4e26bae4f40ecde7ba6f110b7f77737cd8516ff941132d2c1f077`. The adjacent `build-result.json`, `compile.log` and stage preserve exact compile inputs. This initial compile checkpoint predates final PowerShell payload-validation fixes and bilingual documentation; retain it as build evidence, not a handoff installer. Parent will clean-build final launchers, restage current four UI packages and compile a new Setup from the finalized source. Rerun activation on that final stage if any UI package/resolver changes; this checkpoint does not qualify later bytes.

## Not qualified

- Real Setup wizard layout, elevation/uninstall registration behavior, actual install/update/repair/uninstall and retained-data reinstall in a clean Windows VM. Static Inno checks do not substitute for executing those lifecycle paths in an authorized disposable VM.
- Native Desktop/HUB/CONFIG rendering, first-run/Explorer handoffs, taskbar grouping, process cleanup, high-DPI/1024x768 modes, mobile LAN pairing or enhancement UI behavior. Parent owns native validation; serving JS is not browser-side interaction proof.
- Historical user sessions, external profile activation/mutation, migration or rollback. Base/home content is never migrated by Setup. An explicit home selection is not profile compatibility certification.
- Arbitrary newer CLI/Electron/ASAR hosts, source-only TS runtimes, other Node versions/platforms or missing runtime dependencies. The named alpha.2 adapter and Node-internal CommonJS resolver wrapper require separate qualification before widening support.
- Cryptographic publisher trust/signing, hostile concurrent filesystem mutation, abrupt power loss and locked-file restart behavior. File hashes detect change, not publisher authenticity. Normal Inno update/uninstall ownership applies; removed old payload files may remain tracked until uninstall, while unknown/user files are not swept away.

## 中文摘要

已通过 **46 项计划/保留/校验断言、9 项 resolver 场景检查、四包实际 HTTP 可执行字节证明和 12 个实际解析路径检查**。HUB 包含 `Management overview`，不是旧 Runtime 前端；源 Runtime 与隔离复制品的基础文件哈希均保持不变。工程版 Inno Setup 编译成功，但没有执行安装。旧失败夹具不是通过证据，严格验收以 `activation-fMd2Lg/result.json` 的 `passed:true` 为准。父任务将使用最终原生启动器及最新四包重新构建；真实安装卸载、原生 UI/Explorer 交接、历史数据/插件兼容、其他 Node/CLI 版本及发行签名仍未验收。
