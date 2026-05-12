import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(repoRoot, "plugins/qferry/src/mcp.js");
const target = resolve(repoRoot, "plugins/qferry/dist/mcp.js");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

const sourceText = await readFile(source, "utf8");
const targetText = await readFile(target, "utf8");
if (sourceText !== targetText) {
  throw new Error("QFerry plugin runtime sync failed: src and dist differ after copy");
}

process.stdout.write("QFerry plugin runtime synced\n");
