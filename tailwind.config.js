/** @type {import('tailwindcss').Config} */
module.exports = {
  content: {
    relative: true,
    files: [
      "./index.html",
      "./index.tsx",
      "./App.tsx",
      "./components/**/*.{js,ts,jsx,tsx}",
      "./hooks/**/*.{js,ts,jsx,tsx}",
      "./services/**/*.{js,ts,jsx,tsx}",
      "./stores/**/*.{js,ts,jsx,tsx}",
      "./utils/**/*.{js,ts,jsx,tsx}",
      // Heatmap / shared utility class maps (dynamic Tailwind strings)
      "./packages/shared/src/utils/activity.ts",
    ],
  },
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      // ===== Type scale: six steps, one role each =====
      // Pixel values are identical to apps/mobile/tailwind.config.js, so
      // `text-title` is the same 22 px on web and on the phone. They are
      // expressed through --type-*-size / --type-*-lh (design/type.css) rather
      // than as literal px because the app's text-size setting
      // (.font-size-small / .font-size-large on <html>) used to work only by
      // moving the root font-size, which a literal px step would ignore. Those
      // classes now move --type-scale instead, so every step scales with the
      // setting and the two platforms stay in step at scale 1.
      //
      // Weight, line-height and tracking travel with the step. Tailwind emits
      // fontWeight (119), lineHeight (123) and letterSpacing (124) after
      // fontSize (118), so `font-bold`, `leading-*` and `tracking-*` at a call
      // site still win — the step only supplies the default.
      fontSize: {
        display: ['var(--type-display-size)', { lineHeight: 'var(--type-display-lh)', letterSpacing: '-0.02em', fontWeight: '700' }],
        title: ['var(--type-title-size)', { lineHeight: 'var(--type-title-lh)', letterSpacing: '-0.02em', fontWeight: '700' }],
        heading: ['var(--type-heading-size)', { lineHeight: 'var(--type-heading-lh)', letterSpacing: '-0.011em', fontWeight: '600' }],
        body: ['var(--type-body-size)', { lineHeight: 'var(--type-body-lh)', letterSpacing: '-0.011em', fontWeight: '400' }],
        caption: ['var(--type-caption-size)', { lineHeight: 'var(--type-caption-lh)', letterSpacing: '0em', fontWeight: '400' }],
        label: ['var(--type-label-size)', { lineHeight: 'var(--type-label-lh)', letterSpacing: '0.04em', fontWeight: '600' }],
      },
      boxShadow: {
        lantern: 'var(--shadow-sm)',
        'lantern-md': 'var(--shadow-md)',
        'lantern-lg': 'var(--shadow-lg)',
        // Hard offset, no blur, drawn in the theme's ink — the hub-tile edge.
        'lantern-hard': 'var(--shadow-hard)',
      },
      colors: {
        lantern: {
          // The vars in index.css hold RGB CHANNELS ("79 70 229"), never whole
          // colours, so `<alpha-value>` works and e.g. `bg-lantern-primary/10`
          // actually compiles. A whole colour here makes the utility compute to
          // transparent — and Tailwind drops /opacity utilities on an
          // unparseable colour without any warning, which is what left 418 of
          // them rendering nothing. index.css must change in lockstep.
          // primary-background / accent-background are deliberate exceptions:
          // their dark values carry their own alpha.
          background: 'rgb(var(--color-background) / <alpha-value>)',
          'background-secondary': 'rgb(var(--color-background-secondary) / <alpha-value>)',
          'nav-column': 'rgb(var(--color-nav-column) / <alpha-value>)',
          'nav-column-text': 'rgb(var(--color-nav-column-text) / <alpha-value>)',
          'nav-column-text-secondary': 'rgb(var(--color-nav-column-text-secondary) / <alpha-value>)',
          // The grey pill behind the lit rail item, and the theme's strong ink
          // (solid button pill, panel line glyph, hard offset shadow).
          'nav-column-active': 'rgb(var(--color-nav-column-active) / <alpha-value>)',
          ink: 'rgb(var(--color-ink) / <alpha-value>)',
          surface: 'rgb(var(--color-surface) / <alpha-value>)',
          'surface-secondary': 'rgb(var(--color-surface-secondary) / <alpha-value>)',
          text: 'rgb(var(--color-text) / <alpha-value>)',
          'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
          'text-tertiary': 'rgb(var(--color-text-tertiary) / <alpha-value>)',
          'text-muted': 'rgb(var(--color-text-secondary) / <alpha-value>)',
          primary: 'rgb(var(--color-primary) / <alpha-value>)',
          'primary-light': 'rgb(var(--color-primary-light) / <alpha-value>)',
          'primary-dark': 'rgb(var(--color-primary-dark) / <alpha-value>)',
          'primary-background': 'var(--color-primary-background)',
          // The build-153 split: `bg-lantern-primary-fill` for a filled
          // control with a white label, `text-lantern-primary-text` for
          // primary-coloured text or a glyph. Bare `primary` is deprecated.
          'primary-fill': 'rgb(var(--color-primary-fill) / <alpha-value>)',
          'primary-text': 'rgb(var(--color-primary-text) / <alpha-value>)',
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          'accent-background': 'var(--color-accent-background)',
          success: 'rgb(var(--color-success) / <alpha-value>)',
          warning: 'rgb(var(--color-warning) / <alpha-value>)',
          error: 'rgb(var(--color-error) / <alpha-value>)',
          // FILL role, the error twin of `primary-fill`: the red a white
          // numeral or label sits ON. `error` itself is tuned as TEXT on the
          // page ground and is too light under white in dark mode (3.76:1).
          'error-strong': 'rgb(var(--color-error-strong) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          feature: {
            // Wave V1: the eight `{ink, tint}` pairs Wave 0 put in index.css as
            // RGB channels. `ink` is the stroke/label colour, `tint` the wash a
            // disc or a hero band sits in. Flat `<key>-ink` keys rather than a
            // nested object so the deprecated single-colour names below can
            // keep their own spelling (`text-lantern-feature-tests`) while
            // `text-lantern-feature-tests-ink` resolves to the pair.
            'notes-ink': 'rgb(var(--color-feature-notes-ink) / <alpha-value>)',
            'notes-tint': 'rgb(var(--color-feature-notes-tint) / <alpha-value>)',
            'flashcards-ink': 'rgb(var(--color-feature-flashcards-ink) / <alpha-value>)',
            'flashcards-tint': 'rgb(var(--color-feature-flashcards-tint) / <alpha-value>)',
            'tests-ink': 'rgb(var(--color-feature-tests-ink) / <alpha-value>)',
            'tests-tint': 'rgb(var(--color-feature-tests-tint) / <alpha-value>)',
            'recording-ink': 'rgb(var(--color-feature-recording-ink) / <alpha-value>)',
            'recording-tint': 'rgb(var(--color-feature-recording-tint) / <alpha-value>)',
            'ai-ink': 'rgb(var(--color-feature-ai-ink) / <alpha-value>)',
            'ai-tint': 'rgb(var(--color-feature-ai-tint) / <alpha-value>)',
            'groups-ink': 'rgb(var(--color-feature-groups-ink) / <alpha-value>)',
            'groups-tint': 'rgb(var(--color-feature-groups-tint) / <alpha-value>)',
            'campus-ink': 'rgb(var(--color-feature-campus-ink) / <alpha-value>)',
            'campus-tint': 'rgb(var(--color-feature-campus-tint) / <alpha-value>)',
            'budget-ink': 'rgb(var(--color-feature-budget-ink) / <alpha-value>)',
            'budget-tint': 'rgb(var(--color-feature-budget-tint) / <alpha-value>)',
            'sets-ink': 'rgb(var(--color-feature-sets-ink) / <alpha-value>)',
            'sets-tint': 'rgb(var(--color-feature-sets-tint) / <alpha-value>)',
            dashboard: 'rgb(var(--color-feature-dashboard) / <alpha-value>)',
            library: 'rgb(var(--color-feature-library) / <alpha-value>)',
            admin: 'rgb(var(--color-feature-admin) / <alpha-value>)',
            flashcards: 'rgb(var(--color-feature-flashcards) / <alpha-value>)',
            groups: 'rgb(var(--color-feature-groups) / <alpha-value>)',
            marketplace: 'rgb(var(--color-feature-marketplace) / <alpha-value>)',
            offline: 'rgb(var(--color-feature-offline) / <alpha-value>)',
            tests: 'rgb(var(--color-feature-tests) / <alpha-value>)',
            budget: 'rgb(var(--color-feature-budget) / <alpha-value>)',
          },
        },
      },
      borderRadius: {
        lantern: 'var(--radius-lg)',
        'lantern-xl': 'var(--radius-xl)',
      },
    },
  },
  plugins: [],
}
