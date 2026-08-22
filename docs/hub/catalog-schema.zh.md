# 目录契约

[English](catalog-schema.md) | 中文

`registry/catalog.json` 是第一方 Setup Registry 的规范来源。`apps/web/public/setup/registry.json` 是逐字节一致的 Web UI 镜像；目录校验器会拒绝两者漂移。

## Registry 外壳

外壳包含四个字段：

- `schemaVersion` 是整数 `1`。
- `generatedAt` 是目录快照的 ISO 时间戳。
- `source` 是标识维护目录来源的 HTTPS 地址。
- `entries` 包含 `{ "manifest": ..., "metrics": ... }` 形式的条目。

外壳由 [`registry/schema/setup-registry.schema.json`](../../registry/schema/setup-registry.schema.json) 定义。清单由 [`registry/schema/setup-package.schema.json`](../../registry/schema/setup-package.schema.json) 定义。

## 条目所有权

`manifest` 是维护者为一个可安装 Setup 编写的证据。`metrics` 是 Registry 所有的排序数据，可以包含 `stars`、`installs` 和 `updatedAt`。只有完成验证的 Setup 清单才进入这里；仅用于发现的结果、动态 DSHMK 元数据、GitHub 搜索结果和本地构建草稿仍由各自的来源适配器负责。

## 稳定性规则

- 只有发生破坏性协议变化时才修改 `schemaVersion`。
- 条目 ID 使用小写，并在发布后保持稳定。
- 来源引用和工件摘要标识安装实际使用的精确内容。
- 工件 URL 和来源 URL 使用 HTTPS。
- 修正要同时更新规范来源和镜像，不再创建第二套旧字段词汇。
- Release 资产单独发布；除非对应 Setup 清单最新、已验证哈希且归本 HUB 项目所有，否则不复制进目录。

## 信任与排序

`signature` 记录签名证据，`audit` 记录实际执行过的检查。目录本身不会替任何字段做自认证承诺。`metrics` 可以影响排序，但流行度不会提升 Setup 协议推导出的信任级别。
