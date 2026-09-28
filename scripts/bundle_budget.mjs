import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// The two budgets `npm run check` enforces in audit_app.mjs. This module only
// measures; the assertions stay in the audit.
export const ENTRY_BUDGET_BYTES = 750_000;
export const INSTALL_BUDGET_BYTES = 900_000;

const htmlAssetsOf = (index) => [...index.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map((match) => match[1]);

/**
 * Bytes per tier of a production build, counted the way audit_app.mjs counts
 * them: the startup entry script; the install tier (route files the service
 * worker precaches, minus what the HTML already loads); and the warm tier
 * (tools the worker fetches after the first idle, never at install).
 */
export const measureBuild = (dist) => {
  const path = (file) => resolve(dist, file);
  const size = (file) => (existsSync(path(file)) ? statSync(path(file)).size : 0);
  const index = readFileSync(path("index.html"), "utf8");
  const htmlFiles = new Set(htmlAssetsOf(index));
  const entryFile = [...index.matchAll(/src="\.\/([^"#]+\.js)"/g)].map((match) => match[1])[0] || "";
  const list = existsSync(path("offline-routes.json")) ? JSON.parse(readFileSync(path("offline-routes.json"), "utf8")) : {};
  const routeFiles = Array.isArray(list.files) ? list.files : [];
  const warmFiles = Array.isArray(list.warm) ? list.warm : [];
  const installFiles = routeFiles.filter((file) => !htmlFiles.has(file) && existsSync(path(file)));
  const total = (files) => files.reduce((sum, file) => sum + size(file), 0);
  const tiers = [
    ...[...htmlFiles].filter((file) => /^assets\//.test(file)).map((file) => ({ file, tier: "startup" })),
    ...installFiles.map((file) => ({ file, tier: "install" })),
    ...warmFiles.map((file) => ({ file, tier: "warm" })),
  ];
  const entryBytes = size(entryFile);
  const installBytes = total(installFiles);
  return {
    version: list.version,
    entry: { file: entryFile, bytes: entryBytes, limit: ENTRY_BUDGET_BYTES, headroom: ENTRY_BUDGET_BYTES - entryBytes },
    install: { files: installFiles, bytes: installBytes, limit: INSTALL_BUDGET_BYTES, headroom: INSTALL_BUDGET_BYTES - installBytes },
    warm: { files: warmFiles, bytes: total(warmFiles) },
    largest: tiers.map((item) => ({ ...item, bytes: size(item.file) })).sort((left, right) => right.bytes - left.bytes).slice(0, 10),
  };
};

const bytes = (value) => `${value.toLocaleString("en-US")} B`;

/** The headroom lines both `npm run size` and the app audit print. */
export const headroomLines = (measure) => [
  `Startup entry: ${bytes(measure.entry.bytes)} of ${bytes(measure.entry.limit)}; headroom ${bytes(measure.entry.headroom)} (${measure.entry.file})`,
  `Install route screens: ${bytes(measure.install.bytes)} of ${bytes(measure.install.limit)} in ${measure.install.files.length} files; headroom ${bytes(measure.install.headroom)}`,
  `Warm tools: ${bytes(measure.warm.bytes)} in ${measure.warm.files.length} files (fetched after the first idle; no budget)`,
];
