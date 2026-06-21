import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(repoRoot, "plugins/qferry/src/mcp.ts");
const target = resolve(repoRoot, "plugins/qferry/dist/mcp.cjs");

await mkdir(dirname(target), { recursive: true });
await build({
  entryPoints: [source],
  outfile: target,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  logLevel: "silent",
});

const generatedText = await readFile(target, "utf8");
const targetText = generatedText.replace(/[ \t\r]+$/gm, "");
if (targetText !== generatedText) {
  await writeFile(target, targetText, "utf8");
}

for (const forbidden of ["tsx", "apps/chatgpt-app/src", "../../.."]) {
  if (targetText.includes(forbidden)) {
    throw new Error(`QFerry plugin runtime bundle contains forbidden reference: ${forbidden}`);
  }
}

process.stdout.write("QFerry plugin runtime bundled\n");
