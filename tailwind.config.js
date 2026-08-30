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
      boxShadow: {
        lantern: 'var(--shadow-sm)',
        'lantern-md': 'var(--shadow-md)',
        'lantern-lg': 'var(--shadow-lg)',
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
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          'accent-background': 'var(--color-accent-background)',
          success: 'rgb(var(--color-success) / <alpha-value>)',
          warning: 'rgb(var(--color-warning) / <alpha-value>)',
          error: 'rgb(var(--color-error) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          feature: {
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
