# 界面快照

[English](README.md) | 中文

这些图片是 DeepSeek Harness Setup、HUB 和 CONFIG 界面的开发快照，仅用于视觉审核和历史对比。

- 截取日期：**2026-08-17**
- 主显示器：**2560 × 1600**
- 语言：**简体中文（`zh-CN`）**和**English（`en-US`）**
- 界面：**Setup**、**HUB** 和 **CONFIG**
- 截取模式：每次截图前，将临时应用窗口扩展到主显示器完整范围，并放置在任务栏上方。

这些快照不是稳定的 UI 或 API 承诺，也不能证明图中展示的每个操作都已经实现；在 Release Candidate 阶段，它们可以在不保证兼容性的情况下变化。

## 布局

```text
snapshots/
├─ zh-CN/
│  ├─ setup/
│  ├─ hub/
│  └─ config/
└─ en-US/
   ├─ setup/
   ├─ hub/
   └─ config/
```

在 Windows 开发检出中使用以下命令重新生成图库：

```powershell
.\scripts\capture-interface-gallery.ps1
```

脚本使用临时便携数据目录，必须保持用户已安装的 Desktop、HUB、CONFIG、配置文件和托盘进程不受影响。
