import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "none",
            color: "var(--foreground)",
            a: { color: "rgb(59 130 246)", textDecoration: "underline", "&:hover": { color: "rgb(96 165 250)" } },
            strong: { color: "inherit", fontWeight: "600" },
            code: { color: "rgb(239 68 68)", fontWeight: "500", "&::before": { content: "none" }, "&::after": { content: "none" } },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
            blockquote: { borderLeftColor: "rgb(228 228 231)", fontStyle: "normal" },
            h1: { color: "inherit" }, h2: { color: "inherit" }, h3: { color: "inherit" }, h4: { color: "inherit" },
            th: { color: "inherit" },
          },
        },
        invert: {
          css: {
            blockquote: { borderLeftColor: "rgb(63 63 70)" },
            code: { color: "rgb(248 113 113)" },
          },
        },
      },
    },
  },
  plugins: [typography],
};
export default config;
