# dsh-setup-registry

[English](README.md) | 中文

`@deepseek-ai/dsh-setup-registry` 负责解析受维护 Setup 目录，并为 HUB 提供带条件请求的 HTTP 获取能力。

目录把热度指标放在 Setup 清单之外。HUB 可以按认证状态、Star、安装量或更新时间排序，但任何指标都不能授予认证资格。缓存目录在收到 `304 Not Modified` 或暂时网络失败后仍可继续使用；真正执行安装前，安装层仍必须验证文件哈希与数字签名。Desktop 构建会把经过校验的目录放进受签名保护的 Web 资产；GitHub 自动发现只会产生固定 Commit、带哈希的草案和隔离记录，必须经过发布审核才能提升等级。

## 模型体验

无，因为目录解析与排序发生在模型请求组装之外，不注册任何模型可见行为。

#### KV Cache 影响

无。

## 已知限制与后续工作

- 目录客户端不负责持久化缓存文件或下载资产；桌面 HUB 负责这些策略。
- 独立的 [Setup 库](https://github.com/Iraryi/deepseek-harness-setups)负责 GitHub 发现、独立 EXE 构建、隔离、审核、SBOM 与签名记录。在目录本身具备可信分发前，不启用在线认证等级刷新。
