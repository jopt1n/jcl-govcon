import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        "surface-alt": "var(--surface-alt)",
        "surface-raised": "var(--surface-raised)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        border: "var(--border)",
        "border-subtle": "var(--border-subtle)",
        good: "var(--good)",
        maybe: "var(--maybe)",
        discard: "var(--discard)",
        pending: "var(--pending)",
        urgent: "var(--urgent)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
      },
    },
  },
  plugins: [],
};
export default config;
