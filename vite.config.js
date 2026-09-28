import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = process.env.LUMEN_BUILD_ID?.trim() || `local-${Date.now().toString(36)}`;

// Lazy screens keep startup small, but they are application code, not content:
// every primary route must open offline after one online visit. The service
// worker precaches these chunks, their static imports, and their CSS at install
// from the list below. Lecture bodies, the search corpus, Mermaid, the WebLLM
// runtime, and fonts stay on-demand because they are dynamic imports or assets.
// The review center (with its card editor) and the readiness check left the
// startup bundle for its budget; both are still app code every screen needs
// offline.
const OFFLINE_ROUTE_MODULES = [
  "src/components/Reader.jsx",
  "src/components/Whiteboard.jsx",
  "src/components/AiLearningStudio.jsx",
  "src/components/AiTutor.jsx",
  "src/components/PhoneLocalAiTutor.jsx",
  "src/components/ReviewCenter.jsx",
  "src/components/AssessmentDialog.jsx",
  "src/components/StorageHealth.jsx",
  "src/components/DeviceEvidence.jsx",
];

// Warm tools are app code a learner reaches only through an action: the TeX
// renderers with KaTeX (edited copies, uploads and tutor answers), HTML and
// EPUB upload, backup, encrypted export and vault sync, the link check, and
// library retrieval for the tutors. They are in neither the startup bundle
// nor the install tier. After the first idle of every launch, main.jsx asks
// the active worker to fetch whichever of them its cache lacks, so each works
// offline after one online visit without making installation larger.
const WARM_MODULES = [
  "src/lib/markdownMath.js",
  "src/lib/tutorMath.js",
  "src/lib/importConverters.js",
  "src/lib/backupTools.js",
  "src/lib/linkAudit.js",
  "src/lib/libraryRetrieval.js",
];

const offlineRouteManifest = () => ({
  name: "lumen-offline-route-manifest",
  apply: "build",
  // After Vite's CSS plugin has dropped the placeholder JS of CSS-only chunks
  // (KaTeX's stylesheet, shared by the tutors and a warm tool, is one) and
  // handed their CSS to the importing chunks.
  generateBundle: { order: "post", handler(_options, bundle) {
    const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
    const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const entry = chunks.find((chunk) => chunk.isEntry);
    if (!entry) this.error("The offline route list needs the application entry chunk.");
    // A chunk with its static imports and their CSS.
    const closure = (roots) => {
      const files = new Set();
      const visit = (chunk) => {
        if (!chunk || files.has(chunk.fileName)) return;
        files.add(chunk.fileName);
        chunk.viteMetadata?.importedCss?.forEach((css) => files.add(css));
        chunk.imports.forEach((name) => visit(byFile.get(name)));
      };
      roots.forEach(visit);
      return files;
    };
    const lazyChunk = (module, tier) => {
      const chunk = chunks.find((item) => item.isDynamicEntry && item.facadeModuleId?.replaceAll("\\", "/").endsWith(`/${module}`));
      // A renamed or inlined screen or tool must fail the build, not silently
      // drop out of the offline shell.
      if (!chunk) this.error(`${tier} ${module} did not produce its own lazy chunk.`);
      return chunk;
    };
    const files = closure(OFFLINE_ROUTE_MODULES.map((module) => lazyChunk(module, "Offline route")));
    // The HTML already loads the entry and its static imports, and install
    // caches every route file, so the warm list names only what neither has.
    const shell = closure([entry]);
    const warm = [...closure(WARM_MODULES.map((module) => lazyChunk(module, "Warm tool")))]
      .filter((file) => !files.has(file) && !shell.has(file));
    this.emitFile({
      type: "asset",
      fileName: "offline-routes.json",
      source: `${JSON.stringify({ version: 2, build: buildId, entry: entry.fileName, files: [...files].sort(), warm: warm.sort() }, null, 2)}\n`,
    });
  } },
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
