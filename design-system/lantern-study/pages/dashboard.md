# Dashboard Page Overrides

> **PROJECT:** Lantern Study
> **Generated:** 2026-07-10 03:36:00
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px centered content within scroll area
- **Sections:** 1. Hero (greeting + streak/XP), 2. Quick links bento, 3. Stat grid, 4. Today's summary chips, 5. Collapsible analytics
- **Density:** Medium-high — prioritize at-a-glance stats over prose

### Spacing Overrides

- Stat grid gap: `12px` mobile, `16px` desktop
- Section margin-bottom: `24px`

### Typography Overrides

- Hero title: `font-display`, 2xl–3xl
- Stat values: bold 2xl; labels caption xs secondary

### Color Overrides

- **Accent:** `featureAccents.dashboard` (#4f46e5) for hero border, XP bar, primary CTAs
- Summary chips: success (due cards), warning (pending sync), info (notifications)

### Component Overrides

- Use `DashboardHero`, `DashboardQuickLinks`, `StatChip`, `DashboardProgress` collapsible
- Avoid raw slate/indigo; use `lantern-*` tokens throughout

---

## Page-Specific Components

- `DashboardSummaryRow` — 3-up today summary (due, sync, notifications)
- `DashboardStatGrid` — 4-up bento stat cards with icon tiles

---

## Recommendations

- Effects: XP bar fill animation (700ms), subtle card hover lift on quick links
- Collapse analytics by default on mobile to reduce scroll fatigue
- Heatmap legend uses tertiary text, activity colors from shared heat utils
