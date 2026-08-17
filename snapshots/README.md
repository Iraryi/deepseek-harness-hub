# Interface Snapshots

These images are development snapshots of the DeepSeek Harness Setup, HUB, and CONFIG surfaces. They are published for visual review and historical comparison only.

- Captured on: **2026-08-17**
- Primary display: **2560 × 1600**
- Languages: **Simplified Chinese (`zh-CN`)** and **English (`en-US`)**
- Surfaces: **Setup**, **HUB**, and **CONFIG**
- Capture mode: the temporary application window is expanded to the complete primary-display bounds and placed above the taskbar before each screenshot.

The snapshots are not a stable UI or API commitment, do not prove that every shown action is implemented, and may change without compatibility guarantees during the release-candidate period.

## Layout

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

Regenerate the gallery from a Windows development checkout with:

```powershell
.\scripts\capture-interface-gallery.ps1
```

The script uses temporary portable data directories and must leave the user's installed Desktop, HUB, CONFIG, profiles, and tray processes untouched.
