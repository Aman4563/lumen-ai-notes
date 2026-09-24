import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = process.env.LUMEN_BUILD_ID?.trim() || `local-${Date.now().toString(36)}`;

// Lazy screens keep startup small, but they are application code, not content:
// every primary route must open offline after one online visit. The service
// worker precaches these chunks, their static imports, and their CSS at install
// from the list below. Lecture bodies, the search corpus, Mermaid, the WebLLM
// runtime, and fonts stay on-demand because they are dynamic imports or assets.
const OFFLINE_ROUTE_MODULES = [
  "src/components/Reader.jsx",
  "src/components/Whiteboard.jsx",
  "src/components/AiLearningStudio.jsx",
  "src/components/AiTutor.jsx",
  "src/components/PhoneLocalAiTutor.jsx",
  "src/components/StorageHealth.jsx",
  "src/components/DeviceEvidence.jsx",
];

const offlineRouteManifest = () => ({
  name: "lumen-offline-route-manifest",
  apply: "build",
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
    const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const entry = chunks.find((chunk) => chunk.isEntry);
    if (!entry) this.error("The offline route list needs the application entry chunk.");
    const files = new Set();
    const visit = (chunk) => {
      if (!chunk || files.has(chunk.fileName)) return;
      files.add(chunk.fileName);
      chunk.viteMetadata?.importedCss?.forEach((css) => files.add(css));
      chunk.imports.forEach((name) => visit(byFile.get(name)));
    };
    for (const module of OFFLINE_ROUTE_MODULES) {
      const chunk = chunks.find((item) => item.isDynamicEntry && item.facadeModuleId?.replaceAll("\\", "/").endsWith(`/${module}`));
      // A renamed or inlined screen must fail the build, not silently drop
      // out of the offline shell.
      if (!chunk) this.error(`Offline route ${module} did not produce its own lazy chunk.`);
      visit(chunk);
    }
    this.emitFile({
      type: "asset",
      fileName: "offline-routes.json",
      source: `${JSON.stringify({ version: 1, build: buildId, entry: entry.fileName, files: [...files].sort() }, null, 2)}\n`,
    });
  },
});

export default defineConfig({
  plugins: [react(), offlineRouteManifest()],
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
