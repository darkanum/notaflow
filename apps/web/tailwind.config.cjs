/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('./src/malphas/preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
