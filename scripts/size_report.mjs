import { resolve } from "node:path";
import { headroomLines, measureBuild } from "./bundle_budget.mjs";

// `npm run size`: builds, then prints each budget's bytes, limit and headroom,
// the warm total, and the ten largest startup, install and warm files. It
// asserts nothing; `npm run check` enforces the budgets. LUMEN_DIST measures
// another build directory.
const dist = resolve(process.env.LUMEN_DIST || resolve(import.meta.dirname, "..", "dist"));
const measure = measureBuild(dist);

console.log(`Bundle budget report for ${dist}`);
for (const line of headroomLines(measure)) console.log(`  ${line}`);
console.log("Largest files:");
for (const { file, tier, bytes } of measure.largest) console.log(`  ${String(bytes.toLocaleString("en-US")).padStart(9)} B  ${tier.padEnd(7)}  ${file}`);
