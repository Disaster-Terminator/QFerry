import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");
const distPath = "plugins/qferry/dist/mcp.cjs";
const workspaceDist = resolve(repoRoot, distPath);

await execFile("node", [resolve(repoRoot, "scripts/sync-qferry-plugin-runtime.mjs")], {
  cwd: repoRoot,
});

const [{ stdout: committedText }, generatedText] = await Promise.all([
  execFile("git", ["show", `HEAD:${distPath}`], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  }),
  readFile(workspaceDist, "utf8"),
]);

const committed = normalizeGeneratedBundle(committedText);
const generated = normalizeGeneratedBundle(generatedText);

if (committed !== generated) {
  console.error("Generated QFerry plugin runtime is out of date.");
  console.error(`committed: ${sha256(committed)}`);
  console.error(`generated:  ${sha256(generated)}`);
  console.error("Run `pnpm run sync:qferry-plugin` and commit plugins/qferry/dist.");
  process.exit(1);
}

console.log("QFerry plugin runtime generated artifact is current");

function normalizeGeneratedBundle(text) {
  return text.replace(/\r\n?/g, "\n");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
