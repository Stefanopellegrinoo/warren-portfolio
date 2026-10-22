/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        // Design tokens (see globals.css). Old palette below stays until every page is redesigned.
        canvas: 'var(--bg)',
        sidebar: 'var(--sidebar)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        hover: 'var(--hover)',
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)', soft: 'var(--accent-soft)', on: 'var(--on-accent)' },
        primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)', on: 'var(--on-primary)' },
        ring: 'var(--ring)',
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', dot: 'var(--danger-dot)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)', dot: 'var(--warn-dot)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)', dot: 'var(--info-dot)' },
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)', dot: 'var(--ok-dot)' },
        neutral: { DEFAULT: 'var(--neutral)', soft: 'var(--neutral-soft)', dot: 'var(--neutral-dot)' },
        bg: {
          900: '#040810',
          800: '#080f1c',
          700: '#0d1829',
          600: '#132035',
          500: '#1a2a44',
        },
        amber: { DEFAULT: '#f59e0b', dim: '#92600a' },
        emerald: { DEFAULT: '#10b981', dim: '#065f46' },
        rose: { DEFAULT: '#f43f5e', dim: '#9f1239' },
        sky: { DEFAULT: '#38bdf8', dim: '#0c4a6e' },
        slate: { 400: '#94a3b8', 500: '#64748b', 600: '#475569' },
        tv: {
          bg: '#131722',
          panel: '#1e222d',
          'panel-hover': '#2a2e39',
          border: '#2a2e39',
          text: '#d1d4dc',
          'text-muted': '#787b86',
          'text-dim': '#50535e',
          green: '#26a69a',
          red: '#ef5350',
          blue: '#2962ff',
          yellow: '#ffb74d',
          purple: '#ab47bc',
        },
      },
      backgroundImage: {
        'grid-pattern': "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23132035' fill-opacity='0.6'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      },
      boxShadow: {
        pop: 'var(--shadow-pop)',
        toast: 'var(--shadow-toast)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease forwards',
        'slide-up': 'slideUp 0.5s ease forwards',
        'ticker': 'ticker 20s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        ticker: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
    },
  },
  plugins: [
    // Switches on the width of the nearest `[container-type:inline-size]` ancestor, not the viewport:
    // the holdings list is wide or narrow depending on the column it sits in.
    ({ addVariant }) => addVariant('cq-wide', '@container (min-width: 640px)'),
  ],
}
