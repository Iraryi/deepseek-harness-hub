# 贡献

[English](CONTRIBUTING.md) | 中文

DeepSeek Harness HUB 接受目录修正、Setup 清单、文档、校验工具以及桌面生态提案。

## 提交 Pull Request 前

1. 明确保留第三方所有权与许可信息。
2. 不要提交凭据、个人路径、生成的用户数据或私有 API 响应。
3. 运行 `npm run validate`。
4. 保持 Setup 配方可复现：尽可能固定版本、Release、Commit 或已验证摘要。
5. 说明管理员权限、网络访问、外部 Runtime、预期文件变化、重启要求和回滚行为。

## 目录变更

每条记录都需要稳定 ID、规范来源、许可状态、兼容范围、安装模式和信任声明。虚拟 Setup 可以引用上游仓库或包管理器；独立 Setup 必须引用 Release 资产并包含 SHA-256。

收录不代表背书。Registry 记录证据与行为，让 HUB 能够诚实地呈现 Setup 体验。

## 审核级别

- **Schema 审核**：清单结构有效。
- **来源审核**：仓库、许可证、发布者和安装说明可识别。
- **安装审核**：在干净配置中能够安装并启动。
- **生命周期审核**：更新、修复、重启和卸载行为有文档且可复现。

独立 EXE 需要通过全部四级审核。虚拟条目可以以较低审核级别合并，但界面必须清楚显示限制。

## Commit 风格

使用简短的祈使句主题，例如 `docs: clarify offline import` 或 `catalog: add example setup`。

## 行为准则

参与行为受 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 约束。安全敏感问题请遵循 [SECURITY.md](SECURITY.md)。
