# Library Page Overrides

> **PROJECT:** Lantern Study
> **Generated:** 2026-07-10 03:36:00
> **Page Type:** General / Dual-tab shell

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** Full-width shell with tabbed content
- **Sections:** 1. FeatureHero (counts), 2. Tab bar (Notes | Flashcards), 3. Tab panel content
- Active tab: top accent bar in `featureAccents.library`

### Spacing Overrides

- Tab bar padding: `16px` horizontal
- Content cards: `16px` gap in lists

### Typography Overrides

- Tab labels: sm font-medium
- Card titles: base semibold; meta caption xs tertiary

### Color Overrides

- **Accent:** `featureAccents.library` (#f43f5e) for hero, active tab, deck headers
- Due badges: `lantern-error` (not raw red-500)
- Folder chips: primary background when selected

### Component Overrides

- `FeatureHero` with note/deck/due stat chips
- Deck cards: lantern surface + library-tinted gradient header
- Notes sync state: primary background border (not indigo)

---

## Page-Specific Components

- Library shell tabs with count badges on Flashcards tab when due > 0

---

## Recommendations

- Effects: Tab underline slide, card press opacity on mobile
- Empty states: icon + short CTA to create note/deck
- Search/folder row: single lantern-bordered input bar
