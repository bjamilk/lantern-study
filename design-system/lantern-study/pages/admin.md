# Admin Page Overrides

> **PROJECT:** Lantern Study
> **Generated:** 2026-07-10 03:36:00
> **Page Type:** Dashboard / Ops Console

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** Full-width ops console
- **Sections:** 1. FeatureHero (console title + actions), 2. Horizontal pill tabs, 3. Tab panel (tables/cards)
- High information density; tables scroll within panel

### Spacing Overrides

- Tab bar: horizontal scroll, `8px` gap between pills
- Panel padding: `16px` mobile, `24px` desktop

### Typography Overrides

- Console title: xl–2xl semibold
- Table headers: xs uppercase muted
- KPI values: 2xl bold

### Color Overrides

- **Accent:** `featureAccents.admin` (#64748b) for hero top border and active tab
- Warnings: open reports/disputes use `StatChip` warning / `lantern-warning`
- Danger actions: `lantern-error` for ban/remove/refund

### Component Overrides

- `FeatureHero` replaces plain ScreenHeader
- Pill tabs (not ghost button row) with admin accent active state
- `Card variant="elevated"` for analytics legend blocks

---

## Page-Specific Components

- Admin hero with Refresh + Back to Dashboard in actions slot
- KPI grid on Overview with highlighted moderation queue counts
- **Features** tab (`AdminProductFeatures`): searchable registry of shipped product capabilities with expand-for-details cards (behavior, verification, admin notes). Source data in `components/admin/productFeatures.ts`.

---

## Recommendations

- Effects: Row hover on activity/audit lists; loading text uses muted tertiary
- Success feedback: `text-lantern-success` inline banner (auto-dismiss 3s)
- Filters/inputs: `border-lantern-border`, `focus:ring-lantern-primary`
