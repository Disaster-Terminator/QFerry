import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  ".agents/plugins/marketplace.json",
  "plugins/qferry/.codex-plugin/plugin.json",
  "plugins/qferry/.mcp.json",
  "plugins/qferry/README.md",
  "plugins/qferry/skills/qferry/SKILL.md",
  "plugins/qferry/src/mcp.ts",
  "plugins/qferry/dist/mcp.cjs",
];

for (const file of requiredFiles) {
  await access(resolve(repoRoot, file));
}

const pluginJson = JSON.parse(await readFile(resolve(repoRoot, "plugins/qferry/.codex-plugin/plugin.json"), "utf8"));
if (pluginJson.name !== "qferry") {
  throw new Error(`Unexpected plugin name: ${pluginJson.name}`);
}
if (pluginJson.skills !== "./skills/" || pluginJson.mcpServers !== "./.mcp.json") {
  throw new Error("plugin.json must reference plugin-local skills and .mcp.json");
}

const marketplaceJson = JSON.parse(await readFile(resolve(repoRoot, ".agents/plugins/marketplace.json"), "utf8"));
const marketplaceEntry = marketplaceJson.plugins?.find((plugin) => plugin.name === "qferry");
if (!marketplaceEntry) {
  throw new Error("marketplace.json must include qferry plugin entry");
}
if (marketplaceEntry.source?.source !== "local" || marketplaceEntry.source?.path !== "./plugins/qferry") {
  throw new Error("marketplace qferry entry must point to ./plugins/qferry");
}
if (!marketplaceEntry.policy?.installation || !marketplaceEntry.policy?.authentication || !marketplaceEntry.category) {
  throw new Error("marketplace qferry entry must include installation policy, authentication policy, and category");
}

const mcpJson = JSON.parse(await readFile(resolve(repoRoot, "plugins/qferry/.mcp.json"), "utf8"));
const qferryServer = mcpJson.mcpServers?.qferry;
if (qferryServer?.args?.[0] !== "./dist/mcp.cjs") {
  throw new Error(".mcp.json must launch plugin-local ./dist/mcp.cjs");
}
if (qferryServer.cwd !== ".") {
  throw new Error('.mcp.json must set cwd to "." so Codex starts from the installed plugin directory');
}

const dist = await readFile(resolve(repoRoot, "plugins/qferry/dist/mcp.cjs"), "utf8");
for (const forbidden of ["tsx", "apps/chatgpt-app/src", "../../.."]) {
  if (dist.includes(forbidden)) {
    throw new Error(`plugins/qferry/dist/mcp.js must be plugin-local runtime, found forbidden reference: ${forbidden}`);
  }
}

process.stdout.write("QFerry plugin verified\n");
