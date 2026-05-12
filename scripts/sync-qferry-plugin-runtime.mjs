import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(repoRoot, "plugins/qferry/src/mcp.ts");
const target = resolve(repoRoot, "plugins/qferry/dist/mcp.js");

await mkdir(dirname(target), { recursive: true });
await build({
  entryPoints: [source],
  outfile: target,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  minify: true,
  logLevel: "silent",
});

const targetText = await readFile(target, "utf8");
for (const forbidden of ["tsx", "apps/chatgpt-app/src", "../../.."]) {
  if (targetText.includes(forbidden)) {
    throw new Error(`QFerry plugin runtime bundle contains forbidden reference: ${forbidden}`);
  }
}

process.stdout.write("QFerry plugin runtime bundled\n");
