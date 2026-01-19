/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'solar-dark-bg': '#1a1a1a',
        'solar-dark-content': '#2a2a2e',
        'solar-dark-border': '#404040',
        'solar-light-bg': '#f0f0f0',
        'solar-light-content': '#ffffff',
        'solar-light-border': '#d1d1d1',
        'solar-accent': '#0a84ff',
        'solar-accent-hover': '#359aff',
      },
    },
  },
  plugins: [],
}