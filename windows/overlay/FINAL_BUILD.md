# Final-input engineering build — 2026-09-30

Completed the parent's requested build; **do not duplicate it**. Version remains `0.1.0`, unsigned engineering package. No installer/uninstaller execution, host installation change, registry/profile edit, commit or publication occurred.

- EXE: `artifacts/7707a788/output/DSH-Overlay-Setup-0.1.0.exe`
- Size: **3,580,303 bytes**
- SHA-256: `c121b8b1ff3d1a38c970251e4c9d9a7f6e917fe157ab88d71a052d0ab95af726`
- Native input: `windows/launcher/dist-enhancements-final-20260930`, all **13 files** recursively copied and hash-matched, including three EXEs, enhancements and mobile assets.
- UI input: `windows/overlay/artifacts/final-packages-20260930`, all **181 files** copied and hash-matched. Total payload: **194 files**.
- Both READMEs, `INTEGRATION.md` and `TESTING.md` existed before build, were copied into staging and matched source hashes. Their bundled testing text is the pre-build checkpoint; this post-build note and the result JSON files record final acceptance without modifying the compiled EXE.
- Inno Setup 6.7.3 compilation passed. Exact build/stage/final evidence: `artifacts/7707a788/{build-result,stage-validation,final-validation}.json` and `compile.log`.

Final stage was rerun through `tests/verify-activation.mjs` using a fresh copy of the parent's qualified Runtime. `tests/fixtures/activation-gqeXX3/result.json` reports **passed:true**, four actual served-package executable-byte proofs, 12 private Overlay resolution paths and unchanged source/copied Runtime inventories. Node: `v24.18.0`. HUB includes `Management overview`; its final bundle SHA-256 is `b5a8a318638efd2c6d8f2630ee32a3127765fa223c9968e05376071d1089093b`. Comparison accounts only for the server's specified sourceURL/sourceMappingURL trailer replacement. The owned service was stopped and awaited; no host installation was executed.

Earlier source validation remains 46 plan/lifecycle assertions and nine resolver scenario checks, as recorded in `TESTING.md`. Parent-reported mobile/native checks are separate evidence, not rerun by this packaging task. Actual installer/uninstaller lifecycle, native UI/Explorer handoff, historical-data migration and arbitrary newer-host compatibility remain unqualified.

## 中文交接

最终输入的工程版 Setup 已完成，父任务无需重复构建。EXE 共 3,580,303 字节，哈希见上文。194 个载荷文件与最终输入逐一一致，双语文档在构建前已存在并打包。最终载荷再次通过四包真实 HTTP 字节验证和 12 个解析路径检查，基础及源 Runtime 均未改变。未运行安装器、未修改宿主注册表/Profile、未提交或发布；真实安装卸载及原生交接仍需独立验收。
