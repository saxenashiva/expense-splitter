/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        panel: '0 18px 60px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
};
