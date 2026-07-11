/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './index.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lantern: {
          background: '#f4f6fb',
          'background-secondary': '#e8ecf6',
          surface: '#ffffff',
          'surface-secondary': '#f8fafc',
          text: '#0f172a',
          'text-secondary': '#475569',
          'text-tertiary': '#94a3b8',
          primary: '#4f46e5',
          'primary-light': '#6366f1',
          'primary-dark': '#3730a3',
          'primary-background': '#eef2ff',
          accent: '#d97706',
          'accent-background': '#fff7ed',
          success: '#059669',
          warning: '#d97706',
          error: '#dc2626',
          border: '#d8dee9',
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
