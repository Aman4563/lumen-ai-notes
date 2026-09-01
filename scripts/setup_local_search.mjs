import { randomBytes } from "node:crypto";
import { access, chmod, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const target = resolve("infra/searxng/.env");
const rotate = process.argv.slice(2).includes("--rotate");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--rotate");

if (unknownArguments.length > 0) {
  console.error("Usage: node scripts/setup_local_search.mjs [--rotate]");
  process.exitCode = 2;
} else {
  let exists = true;
  try { await access(target, constants.F_OK); } catch { exists = false; }

  if (exists && !rotate) {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${target} must be a regular, non-symlink file. Use --rotate after resolving it safely.`);
    }
    const existing = await readFile(target, "utf8");
    const assignments = existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (assignments.length !== 1 || !/^SEARXNG_SECRET=[a-f0-9]{64}$/u.test(assignments[0])) {
      throw new Error(`${target} is malformed or contains a weak secret. Run again with --rotate.`);
    }
    await chmod(target, 0o600);
    console.log(`Kept the existing private SearXNG environment at ${target}.`);
  } else {
    const secret = randomBytes(32).toString("hex");
    const content = [
      "# Generated locally. Never commit or share this file.",
      `SEARXNG_SECRET=${secret}`,
      "",
    ].join("\n");
    const temporary = resolve("infra/searxng", `.env.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    console.log(`${exists ? "Rotated" : "Created"} the private SearXNG environment at ${target}; the secret was not printed.`);
  }
}
