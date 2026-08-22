# 自定义 Setup Workspace

[English](custom-workspaces.md) | 中文

Setup Workspace 是虚拟 Setup 背后的可编辑创作层。它为维护者、本地用户和 AI 辅助编辑器提供稳定目录，可以修改内容而不改变 HUB 可执行文件，也不把任意源代码假装成已经审核的安装器。

## 设计目标

- 将每个远程来源固定到不可变 Commit、Tag、URL 哈希或本地路径。
- 默认隔离 Desktop 和 HUB 目标。
- 在执行前声明依赖、环境值、构建步骤、补丁、覆盖层和输出。
- 把组件与选项选择渲染为正常的 Setup 控件。
- 在收据中记录每个已安装文件和目录，以支持验证、移除和回滚。
- 在线依赖无法可靠获取时，保留手动下载／导入路径。

## Workspace 布局

```text
my-setup-workspace/
├─ manifest.json
├─ patches/
├─ overlays/
├─ scripts/
└─ assets/
```

规范清单 Schema 是 [`registry/schema/setup-workspace.schema.json`](../../registry/schema/setup-workspace.schema.json)。完整起始示例位于 [`examples/setup-workspace/manifest.json`](../../examples/setup-workspace/manifest.json)。

## 来源类型

| 类型 | 用途 | 必需身份 |
| --- | --- | --- |
| `git` | 仓库检出 | HTTPS 仓库及不可变 `ref` |
| `zip` | Release／源码归档 | HTTPS URL 及小写 SHA-256 |
| `local` | 用户提供的目录或归档 | 在 Setup 中明确选择的本地路径 |
| `generated` | 完全由 Workspace 脚本／模板生成的文件 | Workspace 版本与收据 |

## 执行模型

1. **预检**解析选项，检查路径、权限、依赖和网络可用性。
2. **获取**下载或导入来源，并验证声明的身份。
3. **构建**在暂存目录内应用环境值、补丁、覆盖层和命令。
4. **安装**只把选中的组件复制到声明的 Desktop 或 HUB 配置范围。
5. **验证**检查输出并记录收据，然后报告成功。
6. **移除或回滚**使用收据，而不是猜测哪些文件属于该 Setup。

HUB 应向用户展示 Workspace 目录。这个路径可以交给 AI 编辑器，但生成的改动必须保留为可审查文件，并在安装前通过同一套 Schema 和预检检查。

## 配置范围隔离

`desktop` 是社区 UI 组件的默认范围。组件只有同时满足以下两个条件才会影响 HUB：

1. Workspace 在 `targets` 中声明 `hub`，或在组件范围中声明 `both`。
2. 用户在 Setup 界面中明确选择 HUB 范围。

这样可以防止 Desktop 侧边栏、主题或注入脚本无声地修改 HUB 本身。

## 发布路径

- 正常发布源仓库或 Release 资产。
- 在旁边或独立 Setup 仓库中发布 Setup Workspace。
- 添加固定来源／引用并链接 Workspace 的 Registry 条目。
- 申请精选状态时附上干净配置安装、启动、更新、移除和残留证据。

独立 Setup EXE 仍是更严格的单独发布类别。Workspace 可以用于构建它，但生成的二进制文件完成生命周期测试前不会进入精选库。
