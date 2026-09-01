import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = process.env.LUMEN_BUILD_ID?.trim() || `local-${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __LUMEN_BUILD_ID__: JSON.stringify(buildId),
  },
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: process.env.AI_DEV_SERVER_URL || "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // Keep KaTeX and other fonts as same-origin files. Inlining a small font as
    // data: would violate the intentionally strict `font-src 'self'` policy
    // and can leave large equations with missing delimiter glyphs.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1800,
  },
});
