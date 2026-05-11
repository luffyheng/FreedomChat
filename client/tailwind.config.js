/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Single accent — desaturated emerald (nods to WhatsApp without being loud)
        brand: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        // Surface neutrals — white → cool grays
        paper: {
          50:  '#ffffff',
          100: '#fafafa',
          200: '#f4f4f5',
          300: '#e4e4e7',
        },
        // Ink hierarchy — true neutral grays
        ink: {
          DEFAULT: '#09090b',
          soft:    '#27272a',
          mute:    '#71717a',
          faint:   '#a1a1aa',
          line:    '#e4e4e7',
        },
        // Semantic accents (kept as `stamp.*` so legacy classes still work)
        stamp: {
          ochre:      '#d97706',
          ochreInk:   '#92400e',
          vermillion: '#dc2626',
          violet:     '#7c3aed',
          azure:      '#2563eb',
        },
      },
      fontFamily: {
        display: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans:    ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.02em',
        tight2:   '-0.01em',
        eyebrow:  '0.08em',
        wide2:    '0.04em',
      },
      boxShadow: {
        stamp: '0 1px 2px 0 rgba(9,9,11,0.04)',
        deep:  '0 12px 32px -12px rgba(9,9,11,0.12)',
        ink:   '0 1px 2px 0 rgba(9,9,11,0.06), 0 1px 3px 0 rgba(9,9,11,0.08)',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'tick':       'tick 0.6s ease-out',
        'in':         'in 0.3s ease-out both',
      },
      keyframes: {
        'pulse-soft': {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.55' },
        },
        tick: {
          '0%':   { transform: 'translateY(2px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        in: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
