/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './index.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lantern: {
          // Runtime values come from ThemeProvider via nativewind `vars()` —
          // light/dark palettes swap when the root View style updates.
          //
          // The vars hold RGB CHANNELS ("79 70 229"), never whole colours, so
          // that `<alpha-value>` works and `bg-lantern-primary/15` actually
          // compiles. A whole colour here silently kills the utility (and,
          // inside rgb(), kills the plain classes too) — see
          // theme/lanternCssVars.ts, which must change in lockstep.
          // primary-background / accent-background are the deliberate
          // exceptions: their dark values carry their own alpha.
          background: 'rgb(var(--color-lantern-background) / <alpha-value>)',
          'background-secondary': 'rgb(var(--color-lantern-background-secondary) / <alpha-value>)',
          'nav-column': 'rgb(var(--color-lantern-nav-column) / <alpha-value>)',
          'nav-column-text': 'rgb(var(--color-lantern-nav-column-text) / <alpha-value>)',
          'nav-column-text-secondary': 'rgb(var(--color-lantern-nav-column-text-secondary) / <alpha-value>)',
          // The theme's STRONG ink: the solid pill, the filled control, the
          // lit tab. Near-black in light, near-white in dark, so a pill is
          // never ink-on-ink. The var was already published by
          // theme/lanternCssVars.ts but had no Tailwind colour, so
          // `bg-lantern-ink` silently compiled to nothing.
          ink: 'rgb(var(--color-lantern-ink) / <alpha-value>)',
          surface: 'rgb(var(--color-lantern-surface) / <alpha-value>)',
          'surface-secondary': 'rgb(var(--color-lantern-surface-secondary) / <alpha-value>)',
          text: 'rgb(var(--color-lantern-text) / <alpha-value>)',
          'text-secondary': 'rgb(var(--color-lantern-text-secondary) / <alpha-value>)',
          'text-tertiary': 'rgb(var(--color-lantern-text-tertiary) / <alpha-value>)',
          primary: 'rgb(var(--color-lantern-primary) / <alpha-value>)',
          'primary-light': 'rgb(var(--color-lantern-primary-light) / <alpha-value>)',
          'primary-dark': 'rgb(var(--color-lantern-primary-dark) / <alpha-value>)',
          'primary-background': 'var(--color-lantern-primary-background)',
          // The build-153 split: `bg-lantern-primary-fill` for a filled
          // control with a white label, `text-lantern-primary-text` for
          // primary-coloured text or a glyph. Bare `primary` is deprecated.
          'primary-fill': 'rgb(var(--color-lantern-primary-fill) / <alpha-value>)',
          'primary-text': 'rgb(var(--color-lantern-primary-text) / <alpha-value>)',
          accent: 'rgb(var(--color-lantern-accent) / <alpha-value>)',
          'accent-background': 'var(--color-lantern-accent-background)',
          success: 'rgb(var(--color-lantern-success) / <alpha-value>)',
          warning: 'rgb(var(--color-lantern-warning) / <alpha-value>)',
          error: 'rgb(var(--color-lantern-error) / <alpha-value>)',
          info: 'rgb(var(--color-lantern-info) / <alpha-value>)',
          border: 'rgb(var(--color-lantern-border) / <alpha-value>)',
          feature: {
            // Spec v3 5.6: eight {ink, tint} pairs, per theme, from
            // theme/lanternCssVars.ts (source: tokens.ts featureAccentsLight/Dark).
            // `ink` is the only value allowed to carry text or a glyph; `tint`
            // is a ground. Was nine hardcoded hexes that ignored dark mode and,
            // after this wave, no longer matched `featureAccents` in JS.
            notes: {
              ink: 'rgb(var(--color-lantern-feature-notes-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-notes-tint) / <alpha-value>)',
            },
            flashcards: {
              // DEFAULT keeps the bare legacy class (`text-lantern-feature-flashcards`)
              // alive for one release; a second bare `flashcards:` key lower down used
              // to SHADOW this object, so `-ink` / `-tint` never existed for it.
              DEFAULT: 'rgb(var(--color-lantern-feature-flashcards) / <alpha-value>)',
              ink: 'rgb(var(--color-lantern-feature-flashcards-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-flashcards-tint) / <alpha-value>)',
            },
            tests: {
              // DEFAULT keeps the bare legacy class (`text-lantern-feature-tests`)
              // alive for one release; a second bare `tests:` key lower down used
              // to SHADOW this object, so `-ink` / `-tint` never existed for it.
              DEFAULT: 'rgb(var(--color-lantern-feature-tests) / <alpha-value>)',
              ink: 'rgb(var(--color-lantern-feature-tests-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-tests-tint) / <alpha-value>)',
            },
            recording: {
              ink: 'rgb(var(--color-lantern-feature-recording-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-recording-tint) / <alpha-value>)',
            },
            ai: {
              ink: 'rgb(var(--color-lantern-feature-ai-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-ai-tint) / <alpha-value>)',
            },
            groups: {
              // DEFAULT keeps the bare legacy class (`text-lantern-feature-groups`)
              // alive for one release; a second bare `groups:` key lower down used
              // to SHADOW this object, so `-ink` / `-tint` never existed for it.
              DEFAULT: 'rgb(var(--color-lantern-feature-groups) / <alpha-value>)',
              ink: 'rgb(var(--color-lantern-feature-groups-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-groups-tint) / <alpha-value>)',
            },
            campus: {
              ink: 'rgb(var(--color-lantern-feature-campus-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-campus-tint) / <alpha-value>)',
            },
            budget: {
              // DEFAULT keeps the bare legacy class (`text-lantern-feature-budget`)
              // alive for one release; a second bare `budget:` key lower down used
              // to SHADOW this object, so `-ink` / `-tint` never existed for it.
              DEFAULT: 'rgb(var(--color-lantern-feature-budget) / <alpha-value>)',
              ink: 'rgb(var(--color-lantern-feature-budget-ink) / <alpha-value>)',
              tint: 'rgb(var(--color-lantern-feature-budget-tint) / <alpha-value>)',
            },
            // @deprecated one release: the pre-wave keys, aliased to the ink that
            // now carries their meaning (same mapping as tokens.ts / index.css).
            dashboard: 'rgb(var(--color-lantern-feature-dashboard) / <alpha-value>)',
            library: 'rgb(var(--color-lantern-feature-library) / <alpha-value>)',
            admin: 'rgb(var(--color-lantern-feature-admin) / <alpha-value>)',
            marketplace: 'rgb(var(--color-lantern-feature-marketplace) / <alpha-value>)',
            offline: 'rgb(var(--color-lantern-feature-offline) / <alpha-value>)',
          },
        },
      },
      // The six-step type scale (Wave T). PIXELS, not rem: NativeWind inlines
      // rem at 14 in this project, so `text-sm` rendered at 12.25 sp and the
      // whole default ladder ran a step small. Stating the scale in px makes
      // `text-body` the same number here and on web.
      //
      // Mirrors src/design/typeScale.ts (the StyleSheet side) — change both.
      // The default text-xs…text-3xl classes are deliberately still here this
      // wave so the ~700 unmigrated call sites keep rendering; the lint in
      // src/design/typeScaleLint.test.ts stops new ones being added.
      // Tracking is stated in PX, not em: React Native's letterSpacing is
      // points, and em would have to survive a NativeWind conversion to get
      // there. Each value is the spec's em figure times its own step —
      // -0.02em on display/title, -0.011em on heading/body, 0 on caption,
      // +0.04em on label — so `text-title` and `typeScale.title` are the same
      // three numbers.
      fontSize: {
        display: ['28px', { lineHeight: '34px', letterSpacing: '-0.56px', fontWeight: '700' }],
        title: ['22px', { lineHeight: '28px', letterSpacing: '-0.44px', fontWeight: '700' }],
        heading: ['17px', { lineHeight: '24px', letterSpacing: '-0.187px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '22px', letterSpacing: '-0.165px', fontWeight: '400' }],
        caption: ['13px', { lineHeight: '18px', letterSpacing: '0px', fontWeight: '400' }],
        label: ['11px', { lineHeight: '16px', letterSpacing: '0.44px', fontWeight: '600' }],
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        lantern: '16px',
        'lantern-xl': '20px',
        't-lantern': '16px',
      },
    },
  },
  plugins: [],
};
