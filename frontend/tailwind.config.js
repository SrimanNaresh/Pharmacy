/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Primary brand — professional medical teal/indigo blend
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bcd2ff',
          300: '#8fb4ff',
          400: '#5b8cff',
          500: '#3563eb',
          600: '#264bd6',
          700: '#1f3bb0',
          800: '#1e348a',
          900: '#1d306e',
        },
        // Secondary accent — teal for a clinical feel
        teal: {
          50: '#effcf9',
          100: '#c9f7ee',
          200: '#96ecdd',
          300: '#5cdac7',
          400: '#2fbfad',
          500: '#17a394',
          600: '#0d8378',
          700: '#0f6961',
          800: '#11544f',
          900: '#124642',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d9e1',
          300: '#aeb6c4',
          400: '#828da1',
          500: '#636f86',
          600: '#4e586d',
          700: '#404859',
          800: '#373d4c',
          900: '#1c2029',
        },
      },
      boxShadow: {
        soft: '0 4px 16px rgba(15, 23, 42, 0.06)',
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        elevated: '0 8px 24px -6px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)',
        glow: '0 8px 24px -6px rgba(53, 99, 235, 0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'ui-serif', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #3563eb 0%, #17a394 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #1d306e 0%, #11544f 100%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
