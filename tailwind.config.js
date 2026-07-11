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
          background: 'var(--color-background)',
          'background-secondary': 'var(--color-background-secondary)',
          surface: 'var(--color-surface)',
          'surface-secondary': 'var(--color-surface-secondary)',
          text: 'var(--color-text)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-tertiary': 'var(--color-text-tertiary)',
          'text-muted': 'var(--color-text-secondary)',
          primary: 'var(--color-primary)',
          'primary-light': 'var(--color-primary-light)',
          'primary-dark': 'var(--color-primary-dark)',
          'primary-background': 'var(--color-primary-background)',
          accent: 'var(--color-accent)',
          'accent-background': 'var(--color-accent-background)',
          success: 'var(--color-success)',
          warning: 'var(--color-warning)',
          error: 'var(--color-error)',
          border: 'var(--color-border)',
          feature: {
            dashboard: 'var(--color-feature-dashboard)',
            library: 'var(--color-feature-library)',
            admin: 'var(--color-feature-admin)',
            flashcards: 'var(--color-feature-flashcards)',
            groups: 'var(--color-feature-groups)',
            marketplace: 'var(--color-feature-marketplace)',
            offline: 'var(--color-feature-offline)',
            tests: 'var(--color-feature-tests)',
            budget: 'var(--color-feature-budget)',
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
