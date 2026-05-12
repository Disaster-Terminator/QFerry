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
  return `plugin-qq-readonly-e2e-${stamp}-${random}`;
}

function parseDotenv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

async function loadDotenv() {
  try {
    return parseDotenv(await readFile(resolve(repoRoot, ".env"), "utf8"));
  } catch {
    return {};
  }
}

async function writeJsonl(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event, Object.keys(event).sort())}\n`, { encoding: "utf8", flag: "a" });
}

function maskEmail(value) {
  const [name, domain] = String(value).split("@", 2);
  if (!domain) return "<account-provided>";
  return `${name.slice(0, 2) || "*"}***@${domain}`;
}

async function main() {
  const dotenv = await loadDotenv();
  const qqEmail = process.env.QQMAIL_EMAIL || dotenv.QQMAIL_EMAIL;
  const qqKey = process.env.QQMAIL_KEY || dotenv.QQMAIL_KEY;
  if (!qqEmail || !qqKey) {
    throw new Error("QQMAIL_EMAIL and QQMAIL_KEY are required for plugin QQ read-only e2e");
  }

  const runId = createRunId();
  const artifactDir = resolve(repoRoot, "artifacts/e2e", runId);
  const tracePath = resolve(repoRoot, "logs/runs", `${runId}.jsonl`);
  const summaryPath = resolve(artifactDir, "summary.md");
  const mcpConfigPath = resolve(pluginDir, ".mcp.json");
  const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf8"));
  const serverConfig = mcpConfig.qferry;
  if (!serverConfig) {
    throw new Error("plugins/qferry/.mcp.json does not define qferry server");
  }

  const baseEvent = {
    runId,
    provider: "qqmail",
    accountAlias: maskEmail(qqEmail),
    surface: "codex-plugin",
    dryRun: true,
    mutationAllowed: false,
    sampleLimit: 1,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_qq_readonly_e2e_started",
    command: serverConfig.command,
    args: serverConfig.args,
    pluginDir,
  });

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    cwd: pluginDir,
    env: {
      ...process.env,
      ...(serverConfig.env ?? {}),
      QFERRY_PROVIDER: "qqmail",
      QFERRY_MUTATION_ALLOWED: "0",
      QFERRY_METADATA_SAMPLE_LIMIT: "1",
      QQMAIL_METADATA_SAMPLE_LIMIT: "1",
      QQMAIL_EMAIL: qqEmail,
      QQMAIL_KEY: qqKey,
      QQMAIL_IMAP_HOST: process.env.QQMAIL_IMAP_HOST || dotenv.QQMAIL_IMAP_HOST || "imap.qq.com",
      QQMAIL_IMAP_PORT: process.env.QQMAIL_IMAP_PORT || dotenv.QQMAIL_IMAP_PORT || "993",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "qferry-plugin-qq-readonly-e2e", version: "0.0.0" });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  await client.connect(transport);
  const capability = await client.callTool({ name: "get_capability_snapshot", arguments: {} });
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_capability_snapshot",
    structuredContentKeys: Object.keys(capability.structuredContent ?? {}),
  });

  const mailboxes = await client.callTool({ name: "list_mailboxes", arguments: {} });
  const mailboxCount = Array.isArray(mailboxes.structuredContent?.mailboxes)
    ? mailboxes.structuredContent.mailboxes.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "list_mailboxes",
    mailboxCount,
  });

  const search = await client.callTool({ name: "search", arguments: { folder: "INBOX", limit: 1 } });
  const sampledMessages = Array.isArray(search.structuredContent?.messages)
    ? search.structuredContent.messages.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "search",
    sampledMessages,
  });

  await client.close();

  await writeFile(
    summaryPath,
    [
      `# QFerry Plugin QQ Read-only E2E ${runId}`,
      "",
      "- provider: qqmail",
      `- accountAlias: ${maskEmail(qqEmail)}`,
      "- surface: codex-plugin",
      "- dryRun: true",
      "- mutationAllowed: false",
      "- mutationsAttempted: 0",
      `- folderCount: ${mailboxCount}`,
      `- sampledMessages: ${sampledMessages}`,
      `- trace: ${tracePath}`,
      `- mcpConfig: ${mcpConfigPath}`,
      `- stderrBytes: ${stderrChunks.join("").length}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_qq_readonly_e2e_finished",
    ok: true,
    mutationsAttempted: 0,
    artifactDir,
  });

  process.stdout.write(`${JSON.stringify({
    provider: "qqmail",
    runId,
    mutationsAttempted: 0,
    artifacts: { tracePath, summaryPath },
  }, null, 2)}\n`);
}

await main();
