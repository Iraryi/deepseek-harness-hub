# Agent Note: Web 客户端专用包兼容激活

Status: implemented

[English](2026-08-22-web-client-compatibility-activation.md) | 中文

## Problem

部分 DSH 扩展提供了浏览器客户端 bundle，却没有声明 `dsh.bundle`，因此 profile 安装虽然成功，Web Loader 却找不到客户端入口。安装器随后会报告依赖存在，但没有激活可用的 DSH 层。

## Decision

只有同时满足以下条件时，CLI 才把依赖识别为 Web 客户端专用包：manifest 声明 `dsh.client.platform: "web"`，导出 `./client`，并且该导出解析到已安装包内部真实存在的文件。正常的 `dsh.bundle` 激活逻辑保持不变，其他没有 `dsh.bundle` 的依赖仍作为普通依赖处理。

对于符合条件的包，CLI 会在 profile 的 `cordis.patch.yml` 中维护带标记、由 HUB 所有的区域。生成条目使用由包名稳定生成的 ID，并让 Loader 指向已安装包。重新核对时只替换带标记的区域，保留用户手写的 patch 条目；卸载后会移除过期条目，重复执行保持幂等。

原生 HUB 核验器同时接受真正声明了 `dsh.bundle` 的层，以及与目标已安装依赖对应的 Web 客户端兼容条目。安装进度与成功结果统一使用“组件”称呼，避免把 Web 客户端专用包误称为组合包。

## Alternatives considered

**把所有带有 `exports["./client"]` 的依赖都当成层：** 放弃，因为仅有客户端导出不能证明它是 DSH Web 插件，会误激活无关包。

**安装时修改每个第三方包的 manifest：** 放弃，因为这会改变已安装包内容，使升级和完整性核验变得含糊。

**要求所有包都补上 `dsh.bundle`：** 放弃，因为已有的 Web 客户端专用扩展可以是有效的浏览器插件，却不一定贡献服务端 profile patch。

## Consequences

Web 客户端专用扩展可以沿用现有 Setup/Profile 路径安装并核验，不会再被误判成未激活的完整组合包。生成的 patch 区域是 HUB 管理的磁盘格式，必须保留起止标记。客户端文件缺失或解析到包外的包仍不能通过兼容激活核验，并继续作为普通依赖处理。

## Testing

CLI 构建回归测试会安装一个合成的 Web 客户端专用包，核验生成 patch 与 profile dump，重复执行核对，再卸载包并确认生成区域消失。TypeScript 编译与聚焦 built-bin 测试均已通过。
