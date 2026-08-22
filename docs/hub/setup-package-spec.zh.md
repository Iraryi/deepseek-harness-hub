# Setup 包规范 v1

[English](setup-package-spec.md) | 中文

## 目的

Registry v1 是 HUB UI、CLI 安装器、独立 Setup 证据、离线导入和未来自动化共用的机器可读契约。它描述可安装的 Setup；DSHMK 或 GitHub 的仅发现记录，在拥有具体且可验证的安装方案前不属于这个 Registry。

## 包类型

### 虚拟 Setup

虚拟 Setup 是由清单驱动、由 HUB 渲染并安装到 DSH 配置范围的配方。它的 `install.mode` 是 `profile`，来源可以是内置 Bundle 或经过验证的 `package`／`archive` 工件。它不是把任意 GitHub 仓库转换为 EXE 的服务。

### 可执行 Setup

可执行 Setup 指向可分发的安装器工件。它的 `kind` 是 `executable`，`install.mode` 是 `executable`，工件必须带 HTTPS URL、SHA-256 摘要和可选的 Windows 平台元数据。Windows 执行还会在启动安装器前检查实际 Authenticode 证据。

## Registry 条目

Registry 是包含 `schemaVersion`、`generatedAt`、`source` 和 `entries` 的对象。每条记录都有一个 `manifest` 和 Registry 所有的 `metrics`；排序数据不放进维护者编写的清单。

## 清单字段

- `schemaVersion`、`id`、`name`、`description` 和 `version` 标识不可变的 Setup 记录。`name` 和 `description` 可以是普通字符串，也可以是带必需 `default` 及可选 `zh`、`en` 的对象。
- `kind`、`categories` 和 `tags` 描述安装面与发现词汇。分类和标签不授予信任。
- `source` 包含 HTTPS 仓库、引用以及可选的 Commit 和 Release 标识。存在时 Commit 必须是 40 位十六进制哈希。
- `compatibility` 声明 DSH 范围、支持的界面（`cli`、`web` 或 `desktop`）、可选 Node 范围和可选 Windows 平台集合。
- `license` 包含标识符、显示名称、可选的 HTTPS 说明 URL、可选说明文本以及明确的 `redistributable` 决定。
- `signature` 记录证书或包签名证据。`audit` 记录审核状态和实际运行的检查；两者都不是自认证的安全保证。
- `artifacts` 非空。`in-box` 工件命名 DSH 已携带的组件；远程 `package`、`archive` 或 `installer` 工件必须包含 HTTPS URL 和 SHA-256 摘要。
- `install` 选择内置 Bundle、经过验证的 profile 包／归档或可执行工件。工件 ID 必须在同一清单内解析。
- `permissions` 和 `network` 声明安装前展示的文件、配置范围、权限和网络影响。

## 安装规则

CLI 会在任何下载或启动进程前解析清单。远程工件存储在内容寻址缓存中，只有 SHA-256 摘要匹配后才接受。Profile 安装只把已经验证的本地包／归档交给 Desktop Runtime 的私有包管理器；可执行安装仅支持 Windows，并在不经过 Shell 的情况下启动已验证安装器。

虚拟和可执行条目使用同一证据面板，但信任和执行语义不同。GitHub 来源分类要求用户明确确认，未验证的非 GitHub 来源需要更强确认。审核状态为 rejected 的条目禁止安装。

如果 DSHMK 的一键 GitHub 安装命令不是 `github:<owner>/<repository>#<40 位 Commit>`，HUB 会把它显示为未锁定候选。安装前必须在 HUB 内确认；随后原生启动器会尽可能解析默认分支 HEAD，通过 DSH Web Profile 引擎安装得到的归档，并记录分支、实际 Commit、资产 URL、字节数和 SHA-256。如果 GitHub 元数据无法解析，则使用声明的默认分支归档，并记录该来源已由用户确认但未锁定。

## Schema 与示例

规范清单 Schema 是 [`registry/schema/setup-package.schema.json`](../../registry/schema/setup-package.schema.json)。Registry 外壳 Schema 是 [`registry/schema/setup-registry.schema.json`](../../registry/schema/setup-registry.schema.json)。维护中的目录是 [`registry/catalog.json`](../../registry/catalog.json)，并逐字节镜像到 [`apps/web/public/setup/registry.json`](../../apps/web/public/setup/registry.json)。最小创作示例是 [`examples/setup-package/manifest.json`](../../examples/setup-package/manifest.json)。

提交目录变更前运行 `pnpm run validate:hub-catalog`。验证器会检查两个目录镜像、拒绝旧清单字段、核对工件引用并验证 setup-workspace 示例。
