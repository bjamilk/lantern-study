/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './index.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lantern: {
          background: '#f8fafc',
          'background-secondary': '#f1f5f9',
          surface: '#ffffff',
          'surface-secondary': '#f8fafc',
          text: '#0f172a',
          'text-secondary': '#475569',
          'text-tertiary': '#94a3b8',
          primary: '#6366f1',
          'primary-light': '#818cf8',
          'primary-dark': '#4f46e5',
          'primary-background': '#eef2ff',
          accent: '#f59e0b',
          'accent-background': '#fef3c7',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          border: '#e2e8f0',
        },
      },
      borderRadius: {
        lantern: '16px',
        'lantern-xl': '20px',
      },
    },
  },
  plugins: [],
};
