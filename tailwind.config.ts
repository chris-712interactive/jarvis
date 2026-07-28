import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d12",
        panel: "#12151c",
        edge: "#1e232d",
        muted: "#8b93a5",
      },
    },
  },
  plugins: [],
};

export default config;
