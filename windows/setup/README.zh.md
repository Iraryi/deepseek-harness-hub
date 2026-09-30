# Setup 数据保留

[English](README.md) | 中文

## Summary

本文说明 Windows Setup 辅助脚本，不代表已完成官方 Electron Desktop 的迁移验收。已有用户数据不是安装载荷。

Full 和 Lite 共用明确的启动器文件清单，包含 Desktop/HUB/CONFIG、目录数据、增强脚本及手机中继/配对资源。Full 还内置包含配套客户端构建包的 Runtime；Overlay 是单独的附加发行形式，不是使用这些功能的前提。`tests/verify-launcher-payload.ps1 -LauncherDirectory <clean-launcher-output>` 检查每个启动器文件的安装位置及构建前置要求，不执行 Setup。新增启动器资源必须同时更新共用 Inno 清单和构建要求。

## 存储与替换

配置初始化优先使用 `DEEPSEEK_HARNESS_DATA_DIR`，其次使用选定的便携或标准数据根。已有 JSON 对象按字节原样保留，包括未知的嵌套设置、语言和首次运行状态。无效配置会阻止初始化，不以默认值覆盖。首次配置通过同目录重命名落盘，拒绝覆盖已存在文件。

Setup 拒绝会隐藏保留数据的标准/便携模式切换，不合并数据根。已有 `DSH_HOME` 保持优先；新默认主目录由选定的应用数据目录派生。

Runtime 替换先校验暂存载荷，再把旧 Runtime 重命名为同级的 `.runtime-backup-<operation>`。成功后仍保留备份，包括本地修改。这些文件是恢复材料，不等于插件自动激活；在明确审查并清理之前，它们会持续占用空间。外部 Profile、HUB 收据、会话及工作区文件不属于替换内容。

替换拒绝位于 Runtime 内的配置数据/home 路径及含链接的目标祖先目录。目录导入拒绝链接；临时清理会保留含链接的目录而非跟随链接。同卷目录重命名避免占用文件导致 Runtime 被部分搬走。普通切换失败时，若目标不存在，则恢复旧目录。

## 中断的更新

目录切换对 Windows 拒绝访问、共享冲突和锁冲突最多重试十秒，恢复旧 Runtime 时也适用。不会回退到递归复制、删除目标、修改 ACL 或提权。持续失败会报告两个目录及 Windows 错误码；成功的任务输出记录重试次数。

`.runtime-transaction.json` 在切换前记录旧 Runtime 备份、暂存载荷及目标位置。未解决的事务记录会阻止再次替换。恢复前应保留所有记录的目录并检查其清单，不要仅为绕过检查而删除事务记录。安装日志包含恢复路径。仅恢复 Runtime 不能逆转会话格式迁移。

## 隔离验证

在 Windows 的仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/setup/tests/verify-upgrade-retention.ps1
```

测试使用 D: 下的新目录及进程级环境变量覆盖，不修改宿主 Shell Folders、注册表，也不执行真实安装器/卸载器。它使用仅报告版本的可执行夹具调用生产配置和 Runtime 脚本，不启动 DSH。目录与压缩包替换会对比 SHA-256 文件清单、保留的 Runtime 内容、标准/便携/自定义数据、外部 home、插件文件、模拟会话字节及附件。失败用例包含错误清单、哈希不匹配、文件占用、未完成事务、无效配置及目录联接。Inno 接线断言是静态检查，不是安装器界面测试。

## 发布验收

官方 Desktop 集成需要另行使用上一发行版的数据副本测试：真实会话加载、插件激活、文件访问、保留数据卸载重装、中断恢复及格式变化后的还原。字节保留不能证明这些行为。历史上会修改宿主环境的 `smoke.ps1` 不能在用户电脑上充当安全的替代验证。
