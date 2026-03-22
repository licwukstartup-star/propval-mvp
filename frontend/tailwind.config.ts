import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'cyber-cyan': '#00F0FF',
        'cyber-pink': '#FF2D78',
        'cyber-purple': '#7B2FBE',
        'dark-base': '#0A0E1A',
        'dark-panel': '#111827',
        'dark-surface': '#1E293B',
        'dark-border': '#334155',
        'ghost': '#E2E8F0',
        'ghost-dim': '#94A3B8',
        'status-success': '#39FF14',
        'status-warning': '#FFB800',
        'status-danger': '#FF3131',
        'status-info': '#67E8F9',
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
        orbitron: ["var(--font-orbitron)", "sans-serif"],
        mono: ["var(--font-mono)", "'Courier New'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
