module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "var(--interactive-accent)",
        border: "var(--background-modifier-border)",
        surface: "var(--background-primary)",
        text: "var(--text-normal)",
        faint: "var(--text-faint)"
      }
    }
  },
  corePlugins: { preflight: false } // Obsidian already resets
}







