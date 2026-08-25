/** @type {import('tailwindcss').Config} */
// Solaris v3 — tema pontuado pelos design tokens de src/styles/tokens.css.
// As cores antigas (solar-dark-*/solar-light-*) continuam existindo como aliases:
// componentes do MVP migram de graça; novos componentes usam bg-surface,
// text-ink, border-hairline etc. Anatomia/nomes de classe não mudam.
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  // Componentes v3 usados via CSS puro (sem menção literal em .tsx ainda):
  // sem safelist, o PurgeCSS do Tailwind remove as regras do bundle.
  safelist: [
    'badge-pill', 'badge-ok', 'badge-warn', 'badge-fail', 'badge-info',
    'badge-sparkline', 'skeleton-line', 'skeleton-title', 'skeleton-block',
    'tooltip-rich', 'checkbox-custom', 'btn-primary', 'btn-ghost',
  ],
  theme: {
    extend: {
      colors: {
        // --- superfícies/texto v3 (canônicas) ---
        bg: 'var(--color-bg)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
        },
        ink: {
          DEFAULT: 'var(--color-text)',
          secondary: 'var(--color-text-secondary)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          from: 'var(--color-accent-from)',
          to: 'var(--color-accent-to)',
        },
        ok: 'var(--color-ok)',
        warn: 'var(--color-warn)',
        fail: 'var(--color-fail)',
        info: 'var(--color-info)',
        hairline: 'var(--color-border)',

        // --- aliases do MVP → paleta v3 (mesma classe, cara nova) ---
        'solar-dark-bg': 'var(--color-bg)',
        'solar-dark-content': 'var(--color-surface)',
        'solar-dark-border': 'rgba(255,255,255,0.12)',
        'solar-light-bg': '#f6f7fb',
        'solar-light-content': '#ffffff',
        'solar-light-border': 'rgba(16,20,30,0.16)',
        'solar-accent': 'var(--color-accent)',
        'solar-accent-hover': 'var(--color-accent-from)',
      },
      fontFamily: {
        sans: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
      // Escala da spec: 12/13/15/18/24/32 (line-height generoso)
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.375rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
        '2xl': ['2rem', { lineHeight: '2.5rem' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        glow: 'var(--shadow-glow-hover)',
      },
      maxWidth: {
        prose: '72ch',
      },
    },
  },
  plugins: [],
}
