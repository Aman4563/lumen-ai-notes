import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { headroomLines, measureBuild } from "./bundle_budget.mjs";

const root = resolve(import.meta.dirname, "..");
// LUMEN_DIST audits another build directory (for example an older release).
const dist = resolve(process.env.LUMEN_DIST || resolve(root, "dist"));
const failures = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const read = (path) => readFileSync(resolve(dist, path), "utf8");
const exists = (path) => existsSync(resolve(dist, path));

assert(exists("index.html"), "dist/index.html is missing");
assert(exists("manifest.webmanifest"), "PWA manifest is missing");
assert(exists("service-worker.js"), "service worker is missing");

const manifest = JSON.parse(read("manifest.webmanifest"));
assert(manifest.display === "standalone", "manifest must use standalone display mode");
assert(manifest.start_url === "./", "manifest start_url must remain host-path portable");
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "manifest needs SVG and PNG icons");
for (const icon of manifest.icons || []) {
  assert(exists(icon.src.replace(/^\.\//, "")), `manifest icon is missing: ${icon.src}`);
}

const expectedPngs = new Map([
  ["icon-192.png", [192, 192]],
  ["icon-512.png", [512, 512]],
  ["apple-touch-icon.png", [180, 180]],
]);
for (const [path, [width, height]] of expectedPngs) {
  if (!exists(path)) continue;
  const bytes = readFileSync(resolve(dist, path));
  assert(bytes.subarray(1, 4).toString() === "PNG", `${path} is not a PNG`);
  assert(bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height, `${path} has the wrong dimensions`);
}

const index = read("index.html");
assert(index.includes("script-src 'self'"), "production CSP must retain a same-origin script boundary");
assert(!index.includes("'unsafe-eval'"), "production CSP must not enable general script unsafe-eval");
for (const match of index.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) {
  assert(exists(match[1]), `index references a missing file: ${match[1]}`);
}

const worker = read("service-worker.js");
assert(!worker.includes('fetch("./precache-manifest.json")'), "service worker must not download every emitted chunk during installation");
assert(worker.includes('event.request.mode === "navigate"'), "service worker needs an offline navigation strategy");
assert(worker.includes("key.startsWith(APP_CACHE_PREFIX)"), "service-worker upgrades must delete only old Lumen shell caches and preserve optional runtime caches");
assert(worker.includes('searchParams.get("build")'), "service-worker shell caches must have a build-specific identity");
assert(worker.includes("await cache.addAll([...new Set(htmlAssets)])"), "service-worker installation must fail rather than promote a shell with missing entry assets");

const assets = readdirSync(resolve(dist, "assets")).map((name) => `assets/${name}`);
const scripts = assets.filter((path) => path.endsWith(".js"));
const styles = assets.filter((path) => path.endsWith(".css"));
assert(scripts.length > 0, "production JavaScript bundle is missing");
assert(styles.length > 0, "production stylesheet is missing");
const entryScript = [...index.matchAll(/src="\.\/([^"#]+\.js)"/g)].map((match) => match[1])[0];
assert(entryScript && exists(entryScript), "the production entry script was not detected");
if (entryScript) {
  assert(statSync(resolve(dist, entryScript)).size < 750_000, "the startup JavaScript exceeds the 750 KB uncompressed budget");
  const entrySource = read(entryScript);
  assert(entrySource.includes("service-worker.js?build="), "production registration must select the service worker for this exact build");
  assert(entrySource.includes("vite:preloadError"), "production startup must listen for missing lazy JS/CSS files");
}
// Route screens are shell code: the worker precaches them from the build's
// route list so every screen opens offline after one online visit, while
// content (lectures, search, diagrams, the WebLLM runtime, fonts) stays lazy.
assert(exists("offline-routes.json"), "the build did not emit the offline route list");
const routeList = exists("offline-routes.json") ? JSON.parse(read("offline-routes.json")) : { files: [] };
const routeFiles = Array.isArray(routeList.files) ? routeList.files : [];
assert(typeof routeList.build === "string" && routeList.build.length > 0, "the offline route list must name its build so the worker can reject a mismatched release");
assert(routeList.entry === entryScript, `the offline route list entry (${routeList.entry}) must match the HTML entry (${entryScript})`);
for (const file of routeFiles) assert(exists(file), `the offline route list references a missing file: ${file}`);
// The reader's TeX renderer (markdownMath) moved to the warm tier with KaTeX
// (issue #95).
for (const screen of ["Reader", "Whiteboard", "AiLearningStudio", "AiTutor", "PhoneLocalAiTutor", "ReviewCenter", "AssessmentDialog", "StorageHealth", "DeviceEvidence"]) {
  assert(routeFiles.some((file) => file.startsWith(`assets/${screen}-`) && file.endsWith(".js")), `the offline route list omits the ${screen} screen`);
}
for (const screen of ["AiLearningStudio", "AiTutor", "PhoneLocalAiTutor"]) {
  assert(routeFiles.some((file) => file.startsWith(`assets/${screen}-`) && file.endsWith(".css")), `the offline route list omits the ${screen} stylesheet`);
}
assert(routeFiles.every((file) => /^assets\/[^/]+\.(?:js|css)$/.test(file)), "the offline route list may only name fingerprinted JS/CSS (fonts and images stay on demand)");
// Lecture bodies, the search corpus, diagrams and optimizer data stay on demand.
const EAGER_CONTENT = /\/(?:README|\d{2}-)|content-search|mermaid\.core|cytoscape|Diagram-|-definition-|interviewTracks|labs\.v1|fsrsOptimizer/;
const eagerContent = routeFiles.filter((file) => EAGER_CONTENT.test(file));
assert(eagerContent.length === 0, `the offline route list eagerly caches content: ${eagerContent.join(", ")}`);
const htmlFiles = new Set([...index.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map((match) => match[1]));
const installOnlyFiles = routeFiles.filter((file) => !htmlFiles.has(file) && exists(file));
const routeBytes = installOnlyFiles.reduce((total, file) => total + statSync(resolve(dist, file)).size, 0);
assert(routeBytes < 900_000, `route screens add ${routeBytes} bytes to service-worker installation; keep them under 900 KB`);
assert(worker.includes("offline-routes.json"), "the service worker must precache the route screens at install");
assert(worker.includes("list?.build !== BUILD_ID"), "the service worker must reject a route list from a different build");
assert(worker.includes("VERSIONED ? await readRouteList()"), "a build-specific service worker must require its route list; only an unversioned one may install entry-only");
assert(worker.includes("htmlAssets.includes(routes.entry)"), "the service worker must reject a route list whose entry differs from the HTML");

// Warm tools (issue #95): app code only an action needs (KaTeX and the TeX
// renderers, uploads, backup and sync, the link check, library retrieval).
// The worker fetches them after the first idle, never at install, so they
// count toward neither budget and must not overlap the other tiers.
const warmFiles = Array.isArray(routeList.warm) ? routeList.warm : [];
assert(routeList.version === 2, `the offline route list must be version 2 with a warm list (found version ${routeList.version})`);
assert(Array.isArray(routeList.warm) && warmFiles.length > 0, "the offline route list has no warm tool list");
for (const file of warmFiles) assert(exists(file), `the warm tool list references a missing file: ${file}`);
assert(warmFiles.every((file) => /^assets\/[^/]+\.(?:js|css)$/.test(file)), "the warm tool list may only name fingerprinted JS/CSS");
const warmOverlap = warmFiles.filter((file) => routeFiles.includes(file) || htmlFiles.has(file));
assert(warmOverlap.length === 0, `warm tools must not repeat install or startup files: ${warmOverlap.join(", ")}`);
const eagerWarm = warmFiles.filter((file) => EAGER_CONTENT.test(file));
assert(eagerWarm.length === 0, `the warm tool list eagerly caches content: ${eagerWarm.join(", ")}`);
for (const tool of ["katex", "markdownMath", "tutorMath", "importConverters", "backupTools", "linkAudit", "libraryRetrieval"]) {
  assert(warmFiles.some((file) => file.startsWith(`assets/${tool}-`) && file.endsWith(".js")), `the warm tool list omits ${tool}`);
  assert(!routeFiles.some((file) => file.startsWith(`assets/${tool}-`) && file.endsWith(".js")), `${tool} is installed with the route screens instead of warmed`);
}
assert(!warmFiles.some((file) => installOnlyFiles.includes(file)), "install bytes must exclude warm tools");
assert(worker.includes('event.data?.type === "WARM"'), "the service worker has no WARM handler for the warm tools");
assert(worker.includes("cache.match(ROUTE_LIST_URL)") && worker.includes("list.warm"), "the WARM handler must read the route list its install stored");

const searchChunk = scripts.find((path) => path.includes("content-search"));
assert(searchChunk && statSync(resolve(dist, searchChunk)).size > 500_000, "the lazy full-text search corpus was not emitted separately");
assert(!index.includes("content-search"), "the full-text search corpus must not load on the home screen");
assert(scripts.filter((path) => /\/(?:README|\d{2}-)/.test(path)).length > 100, "lecture bodies were not emitted as on-demand chunks");

if (failures.length) {
  console.error("App audit failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("App audit passed.");
console.log(`Startup entry: ${entryScript} (${entryScript ? statSync(resolve(dist, entryScript)).size : 0} bytes)`);
console.log(`On-demand JavaScript chunks: ${scripts.length - 1}`);
console.log(`Manifest icons: ${manifest.icons.length}`);
console.log(`Offline route screens: ${routeFiles.length} files listed, ${installOnlyFiles.length} (${routeBytes} bytes) beyond the HTML entry`);
for (const line of headroomLines(measureBuild(dist))) console.log(line);
