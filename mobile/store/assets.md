# Store assets checklist

## In repository (verified)

| Asset | Path | Notes |
| --- | --- | --- |
| App icon 1024×1024 | `mobile/assets/images/icon.png` | RGB, no alpha channel (App Store requirement) |
| Android adaptive foreground | `mobile/assets/images/android-icon-foreground.png` | Brand mark on `#F10E72` |
| Android adaptive background | `mobile/assets/images/android-icon-background.png` | |
| Android monochrome | `mobile/assets/images/android-icon-monochrome.png` | Themed icon |
| Splash | `mobile/assets/images/splash-icon.png` on `#F10E72` | `expo-splash-screen` plugin |
| Favicon (web) | `mobile/assets/images/favicon.png` | Not used for native stores |

## Product Owner must supply (not generated here)

### Google Play

- Phone screenshots (min 2, 16:9 or 9:16)
- 7-inch and 10-inch tablet screenshots if targeting tablets (app sets `supportsTablet: false` on iOS; confirm Android tablet policy)
- Hi-res icon 512×512 (can export from 1024 master)
- Feature graphic 1024×500

### Apple App Store Connect

- 6.7", 6.5", 5.5" iPhone screenshot sets (or single set if using upload defaults)
- Optional iPad if enabling tablet later
- App Preview videos (optional)

### Brand

- Store marketing screenshots showing real in-app UI (Arabic + English UI states)
- Promotional text updates per release

Do **not** invent marketing artwork in the repo; use captures from production-like builds after PO sign-off.
