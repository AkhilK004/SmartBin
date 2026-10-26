const v = (name) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: v("ground"),
        surface: v("surface"),
        raised: v("raised"),
        line: v("border"),
        rule: v("rule"),
        control: v("control"),
        ink: v("text"),
        muted: v("muted"),
        accent: v("accent"),
        positive: v("positive"),
        negative: v("negative"),
        warning: v("warning"),
        bin: {
          green: v("bin-green"),
          amber: v("bin-amber"),
          red: v("bin-red"),
          purple: v("bin-purple"),
          grey: v("bin-grey"),
        },
      },
      fontFamily: { sans: ['"Public Sans"', "Inter", "system-ui", "sans-serif"] },
      fontSize: {
        small: ["12px", "16px"],
        body: ["13px", "20px"],
        kpi: ["20px", "24px"],
        title: ["26px", "32px"],
      },
      borderRadius: { card: "6px" },
    },
  },
  plugins: [],
};
