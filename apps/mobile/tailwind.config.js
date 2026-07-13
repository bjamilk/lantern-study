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
          background: 'var(--color-lantern-background)',
          'background-secondary': 'var(--color-lantern-background-secondary)',
          surface: 'var(--color-lantern-surface)',
          'surface-secondary': 'var(--color-lantern-surface-secondary)',
          text: 'var(--color-lantern-text)',
          'text-secondary': 'var(--color-lantern-text-secondary)',
          'text-tertiary': 'var(--color-lantern-text-tertiary)',
          primary: 'var(--color-lantern-primary)',
          'primary-light': 'var(--color-lantern-primary-light)',
          'primary-dark': 'var(--color-lantern-primary-dark)',
          'primary-background': 'var(--color-lantern-primary-background)',
          accent: 'var(--color-lantern-accent)',
          'accent-background': 'var(--color-lantern-accent-background)',
          success: 'var(--color-lantern-success)',
          warning: 'var(--color-lantern-warning)',
          error: 'var(--color-lantern-error)',
          border: 'var(--color-lantern-border)',
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
