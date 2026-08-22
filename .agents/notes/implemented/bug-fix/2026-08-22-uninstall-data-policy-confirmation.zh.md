# Agent Note: 卸载数据策略与确认操作分离

Status: implemented

[English](2026-08-22-uninstall-data-policy-confirmation.md) | 中文

## Problem

卸载程序原来用同一个“是/否”问题同时决定是否卸载以及是否删除用户数据。用户通常会把“否”理解为退出操作，因此数据保留选项很容易被误解。

## Decision

`windows/setup/DeepSeekHarness.iss` 现在打开独立的自定义卸载窗口。窗口先用单选项选择数据策略，默认保留用户数据；底部的“是”和“否”只负责确认或退出卸载。选择“否”会让 `InitializeUninstall` 返回取消状态，在删除程序文件或用户数据前终止卸载。选择“是”后，`CurUninstallStepChanged` 仅在选择了删除数据时删除标准数据目录和便携数据目录。

单选项文案有意保持简短，以便在 Setup 的缩放窗口中保持可读。上方说明文字明确指出数据策略与最终卸载确认是两个独立决定。

## Alternatives considered

**保留原来的“是/否”消息框并反转标签。** 放弃，因为消息框仍然把数据清理选择与卸载决定混在一起，依旧容易误操作。

**在消息框中增加第三个“保留数据”按钮。** 放弃，因为数据策略是需要先明确选中的持久选择，应当在最终确认前一直可见。

## Consequences

普通卸载会直接保留设置、会话、日志、插件数据和便携数据，不再要求用户额外猜测。只有用户主动选中删除数据，并点击“是”确认卸载时，才会执行原有的清理逻辑。自定义窗口仍需要使用 Inno Setup 编译，并在两种内置语言和当前 DPI 下完成视觉检查。

## Testing

静态检查确认脚本包含独立的数据策略控件、默认选中保留数据、“是”映射到 `mrOk`、“否”映射到 `mrCancel`，并且清理逻辑受 `DeleteUserDataRequested` 控制。Inno Setup 6.7.3 已使用更新后的脚本成功编译 Full 和 Lite 两个安装 EXE。
