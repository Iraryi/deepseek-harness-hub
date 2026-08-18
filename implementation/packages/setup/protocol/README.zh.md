# dsh-setup-protocol

[English](README.md) | 中文

`@deepseek-ai/dsh-setup-protocol` 定义 DSH HUB 与受维护 Setup 库共用的清单格式。

清单明确分离：

- `kind`：HUB 虚拟 Setup 或真实可执行 Setup；
- `source`：仓库、引用和可选的不可变 Commit 来源；
- `license`：再分发与署名信息；
- `signature`：数字签名证据；
- `audit`：DSH Setup 库审核证据；
- `artifacts`：HTTPS 地址与 SHA-256 摘要；
- `install`：通过已哈希资产 ID 安装 profile、启用内置组合包，或执行可执行文件安装。

HUB 根据证据推导展示的信任等级。清单不能只在自己的 JSON 中写一个认证徽章，就声称自己是 `certified`。

profile 软件包安装不会把可变的软件包名或 Git 规格直接转交给包管理器。清单必须引用一个 `package` 或 `archive` 资产；安装层先下载并验证 SHA-256，只有校验后的本地文件才会交给 Desktop Runtime 自带的私有 npm。除非清单声明 `install-scripts` 权限，否则 npm 生命周期脚本保持禁用。

## 模型体验

无，因为清单验证发生在模型请求组装之外，不注册任何模型可见行为。

#### KV Cache 影响

无。

## 已知限制与后续工作

- 签名链验证由平台相关安装层执行；本包只验证声明字段。因此远程目录必须具有自己的可信分发机制，目录中的认证声明才能被信任。
- 本包不执行安装器、不解析 GitHub Release，也不授予权限。
- Star、安装量等目录指标与清单分离，绝不会被当作认证证据。
