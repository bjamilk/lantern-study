# Admin Page Overrides

> **PROJECT:** Lantern Study
> **Generated:** 2026-07-10 03:36:00
> **Updated:** 2026-09-17
> **Page Type:** Dashboard / Ops Console

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** Full-width ops console
- **Chrome:** Compact header (title + signed-in operator + Refresh / Back) — not `FeatureHero`
- **Nav:** Grouped left rail on `md+` (Operations / Insight / Product). Labeled horizontal strip below `md`, with group separators
- **Overview sections:** 1. Attention pulse (reports, disputes, AI cost), 2. Platform KPI grid, 3. AI & moderation grid, 4. Two-column activity + audit, 5. Recently shipped
- High information density; tables scroll within the main panel

### Spacing Overrides

- Rail: `12px` horizontal padding, `20px` between groups
- Section gap on Overview: `24px`
- Panel padding: `16px` mobile, `24px` desktop

### Typography Overrides

- Console title: `text-title`
- Section eyebrows: `text-label` uppercase muted
- Pulse values: `text-display` tabular
- Secondary KPIs: `text-heading` tabular
- Table headers / timestamps: `text-caption`

### Color Overrides

- **Accent / identity:** campus family (`featureAccents.admin`, rail icon tint)
- Selected rail item: ink pill (`bg-lantern-ink text-lantern-surface`) — not indigo pills
- Queue cards with work: `lantern-accent` tint
- Clear queues: muted secondary
- AI pulse: `feature-ai` tint
- Danger actions: `lantern-error` for ban/remove/refund

### Component Overrides

- `AdminNav` replaces pill `Tabs` for section switching
- `AdminPageHeader`, `AdminSegmented`, `AdminStatusBadge`, `AdminTable`, `AdminKpi` (compact in dense grids), `AdminToolbar`, `AdminRowActions`, `AdminSectionTitle`, `AdminMetricRow` are the inner-tab chrome
- Clickable pulse / KPI tiles jump to the matching section
- `Card` for activity, audit, queues, and shipped features
- Sub-views (marketplace, content, feature areas) use ink segmented controls, not indigo pills
- Analytics, user drawer, and confirm dialogs use the same KPI / badge / type-scale chrome — no `StatPill` or indigo pills

---

## Page-Specific Components

- Compact admin header with operator email and Refresh + Back
- Overview command center with queue counts on Reports / Marketplace rail badges
- **Features** tab (`AdminProductFeatures`): searchable registry of shipped product capabilities with expand-for-details cards (behavior, verification, admin notes). Source data in `components/admin/productFeatures.ts`.

---

## Recommendations

- Effects: Row hover on activity/audit lists; loading uses `Skeleton` on Overview/Users and a campus progress line in the header, not raw "Loading…"
- Success / error: bordered banners (`lantern-success` / `lantern-error`), success auto-dismiss 3s
- Filters/inputs: `border-lantern-border`, `focus:ring-lantern-primary`
