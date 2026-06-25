import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'DM Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Near-monochrome system. One accent (blue) carries identity + info.
        canvas: '#f5f5f4',
        surface: '#ffffff',
        'surface-2': '#fafafa',
        ink: {
          DEFAULT: '#1c1c1f',
          2: '#55555d',
          3: '#9a9aa3',
        },
        line: 'rgba(20,20,30,0.08)',
        'line-strong': 'rgba(20,20,30,0.14)',
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          soft: '#eaf1fe',
          line: 'rgba(37,99,235,0.22)',
        },
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
        sm: '10px',
      },
      boxShadow: {
        // Soft, diffuse, tinted toward the canvas. No hard slabs.
        soft: '0 1px 2px rgba(20,20,30,0.04), 0 16px 36px -24px rgba(20,20,30,0.22)',
        // Raised: lit top edge + soft drop. The Apple-style "raise".
        raise:
          'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 1px rgba(20,20,30,0.05), 0 10px 24px -18px rgba(20,20,30,0.30)',
        // Deeper, for things floating above a card (menus, popovers).
        pop: '0 20px 44px -18px rgba(20,20,30,0.40)',
      },
    },
  },
  plugins: [],
};

export default config;
