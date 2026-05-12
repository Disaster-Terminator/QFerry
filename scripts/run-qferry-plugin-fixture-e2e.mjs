import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDir = resolve(repoRoot, "plugins/qferry");

function createRunId() {
  const stamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const random = Math.random().toString(16).slice(2, 10);
  return `plugin-fixture-e2e-${stamp}-${random}`;
}

async function writeJsonl(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event, Object.keys(event).sort())}\n`, { encoding: "utf8", flag: "a" });
}

async function main() {
  const runId = createRunId();
  const artifactDir = resolve(repoRoot, "artifacts/e2e", runId);
  const tracePath = resolve(repoRoot, "logs/runs", `${runId}.jsonl`);
  const summaryPath = resolve(artifactDir, "summary.md");
  const mcpConfigPath = resolve(pluginDir, ".mcp.json");
  const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf8"));
  const serverConfig = mcpConfig.mcpServers?.qferry ?? mcpConfig.qferry;
  if (!serverConfig) {
    throw new Error("plugins/qferry/.mcp.json does not define qferry server");
  }

  const baseEvent = {
    runId,
    provider: "fixture",
    surface: "codex-plugin",
    dryRun: true,
    mutationAllowed: false,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_fixture_e2e_started",
    command: serverConfig.command,
    args: serverConfig.args,
    pluginDir,
  });

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    cwd: pluginDir,
    env: { ...process.env, ...(serverConfig.env ?? {}) },
    stderr: "pipe",
  });
  const client = new Client({ name: "qferry-plugin-fixture-e2e", version: "0.0.0" });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  await client.connect(transport);
  const tools = await client.listTools();
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tools_listed",
    toolCount: tools.tools.length,
    toolNames: tools.tools.map((tool) => tool.name),
  });

  const calls = [
    ["list_mailboxes", {}],
    ["search", { folder: "INBOX", limit: 10, query: "digest" }],
    ["classify_messages", {
      folder: "INBOX",
      limit: 10,
      defaultGroupId: "review",
      rules: [{ id: "newsletter", groupId: "bulk", match: { fromIncludes: "newsletter@" } }],
    }],
    ["plan_cleanup", {
      runId,
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
      selectedGroupIds: ["archive"],
    }],
  ];

  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_called",
      toolName: name,
      structuredContentKeys: Object.keys(result.structuredContent ?? {}),
    });
  }

  await client.close();

  await writeFile(
    summaryPath,
    [
      `# QFerry Plugin Fixture E2E ${runId}`,
      "",
      "- provider: fixture",
      "- surface: codex-plugin",
      "- dryRun: true",
      "- mutationAllowed: false",
      "- mutationsAttempted: 0",
      `- toolsListed: ${tools.tools.length}`,
      `- toolsCalled: ${calls.length}`,
      `- trace: ${tracePath}`,
      `- mcpConfig: ${mcpConfigPath}`,
      `- stderrBytes: ${stderrChunks.join("").length}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_fixture_e2e_finished",
    ok: true,
    mutationsAttempted: 0,
    artifactDir,
  });

  process.stdout.write(`${JSON.stringify({
    provider: "fixture",
    runId,
    mutationsAttempted: 0,
    artifacts: { tracePath, summaryPath },
  }, null, 2)}\n`);
}

await main();
