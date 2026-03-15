/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
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
      },
      backgroundImage: {
        'grid-pattern': "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23132035' fill-opacity='0.6'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
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
  plugins: [],
}
