# 发布模型

[English](release-model.md) | 中文

预览阶段中，HUB 和 Desktop 资产使用同一个语义版本标签。

## 渠道

- `stable` — 面向大多数用户推荐，并处理迁移。
- `preview` — 面向积极测试的候选版本。
- `nightly` — 不保证兼容性的自动化构建产物。

## 必需发布资产

- Full Setup EXE
- Lite Setup EXE
- Runtime ZIP
- Portable ZIP
- PowerShell 下载助手
- Release 说明
- `release-manifest.json`
- `SHA256SUMS.txt`

## 晋级门禁

1. 客户端和 Launcher 类型检查。
2. Desktop 与 HUB 原生启动冒烟测试。
3. Runtime 就绪门禁和服务恢复冒烟测试。
4. Setup 结构、界面及安装／卸载冒烟测试。
5. Release 清单和校验和验证。
6. 已发布资产下载验证。

预览版本可以记录失败但不阻塞的上游测试；安装器和 Runtime 失败则阻止发布。
