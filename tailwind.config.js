/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/components/**/*.{js,vue,ts}",
    "./app/layouts/**/*.vue",
    "./app/pages/**/*.vue",
    "./app/plugins/**/*.{js,ts}",
    "./app/app.vue",
    "./nuxt.config.{js,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Fira Sans"', '"Segoe UI"', "sans-serif"],
        mono: ['"Fira Code"', '"Courier New"', "monospace"],
      },
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          dark: "var(--bg-dark)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          hover: "var(--surface-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          light: "var(--border-light)",
          strong: "var(--border-strong)",
          focus: "var(--border-focus)",
        },
        text: {
          DEFAULT: "var(--text)",
          muted: "var(--text-muted)",
          soft: "var(--text-soft)",
          light: "var(--text-light)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          light: "var(--accent-light)",
          strong: "var(--accent-strong)",
          dark: "var(--accent-dark)",
        },
        "accent-2": {
          DEFAULT: "var(--accent-2, #f97316)",
          light: "var(--accent-2-light, #fb923c)",
          strong: "var(--accent-2-strong, #ea580c)",
        },
        success: {
          DEFAULT: "var(--success)",
          light: "var(--success-light)",
          strong: "var(--success-strong)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          light: "var(--danger-light)",
          strong: "var(--danger-strong)",
        },
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "18px",
        xl: "24px",
      },
      boxShadow: {
        xs: "0 2px 8px -4px rgba(15, 23, 42, 0.1)",
        sm: "0 4px 12px -4px rgba(15, 23, 42, 0.12), 0 2px 6px -2px rgba(15, 23, 42, 0.08)",
        card: "0 20px 40px -24px rgba(15, 23, 42, 0.24), 0 8px 16px -8px rgba(15, 23, 42, 0.14)",
        "card-hover":
          "0 24px 48px -28px rgba(15, 23, 42, 0.3), 0 12px 20px -10px rgba(15, 23, 42, 0.18)",
        btn: "0 8px 20px -12px rgba(15, 23, 42, 0.2), 0 4px 8px -4px rgba(15, 23, 42, 0.1)",
        "btn-hover":
          "0 12px 28px -14px rgba(15, 23, 42, 0.28), 0 6px 12px -6px rgba(15, 23, 42, 0.15)",
        "btn-active": "0 4px 12px -8px rgba(15, 23, 42, 0.22)",
        glow: "0 0 20px rgba(37, 99, 235, 0.15)",
        "glow-accent": "0 0 24px rgba(37, 99, 235, 0.25)",
      },
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem",
      },
      transitionDuration: {
        DEFAULT: "200ms",
        250: "250ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.4, 0, 0.2, 1)",
        smooth: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        bounce: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      },
      keyframes: {
        fadeUp: {
          "0%": {
            opacity: "0",
            transform: "translateY(16px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        fadeIn: {
          "0%": {
            opacity: "0",
          },
          "100%": {
            opacity: "1",
          },
        },
        slideDown: {
          "0%": {
            opacity: "0",
            transform: "translateY(-8px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        scaleIn: {
          "0%": {
            opacity: "0",
            transform: "scale(0.95)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1)",
          },
        },
        spin: {
          to: {
            transform: "rotate(360deg)",
          },
        },
        pulse: {
          "0%, 100%": {
            opacity: "1",
          },
          "50%": {
            opacity: "0.6",
          },
        },
      },
      animation: {
        fadeUp: "fadeUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        fadeIn: "fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        slideDown: "slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        scaleIn: "scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        spin: "spin 0.7s linear infinite",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
