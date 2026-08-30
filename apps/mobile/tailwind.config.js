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
          surface: 'rgb(var(--color-lantern-surface) / <alpha-value>)',
          'surface-secondary': 'rgb(var(--color-lantern-surface-secondary) / <alpha-value>)',
          text: 'rgb(var(--color-lantern-text) / <alpha-value>)',
          'text-secondary': 'rgb(var(--color-lantern-text-secondary) / <alpha-value>)',
          'text-tertiary': 'rgb(var(--color-lantern-text-tertiary) / <alpha-value>)',
          primary: 'rgb(var(--color-lantern-primary) / <alpha-value>)',
          'primary-light': 'rgb(var(--color-lantern-primary-light) / <alpha-value>)',
          'primary-dark': 'rgb(var(--color-lantern-primary-dark) / <alpha-value>)',
          'primary-background': 'var(--color-lantern-primary-background)',
          accent: 'rgb(var(--color-lantern-accent) / <alpha-value>)',
          'accent-background': 'var(--color-lantern-accent-background)',
          success: 'rgb(var(--color-lantern-success) / <alpha-value>)',
          warning: 'rgb(var(--color-lantern-warning) / <alpha-value>)',
          error: 'rgb(var(--color-lantern-error) / <alpha-value>)',
          border: 'rgb(var(--color-lantern-border) / <alpha-value>)',
          feature: {
            dashboard: '#4f46e5',
            library: '#f43f5e',
            admin: '#64748b',
            flashcards: '#f43f5e',
            groups: '#10b981',
            marketplace: '#8b5cf6',
            offline: '#f59e0b',
            tests: '#0ea5e9',
            budget: '#14b8a6',
          },
        },
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
