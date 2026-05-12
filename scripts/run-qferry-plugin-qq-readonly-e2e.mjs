import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDir = resolve(repoRoot, "plugins/qferry");
let failureContext;

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
  await writeFile(path, `${JSON.stringify(sortJson(event))}\n`, { encoding: "utf8", flag: "a" });
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortJson(nested)]));
}

function describeError(error) {
  return {
    type: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function recordFailure(error) {
  if (!failureContext) return;
  const errorInfo = describeError(error);
  await writeJsonl(failureContext.tracePath, {
    ...failureContext.baseEvent,
    event: "plugin_qq_readonly_e2e_finished",
    ok: false,
    mutationsAttempted: 0,
    artifactDir: failureContext.artifactDir,
    error: errorInfo,
    stderrBytes: failureContext.stderrBytes(),
  });
  await writeFile(
    failureContext.summaryPath,
    [
      `# QFerry Plugin QQ Read-only E2E ${failureContext.baseEvent.runId}`,
      "",
      "- provider: qqmail",
      `- accountAlias: ${failureContext.baseEvent.accountAlias}`,
      "- surface: codex-plugin",
      "- dryRun: true",
      "- mutationAllowed: false",
      "- mutationsAttempted: 0",
      "- ok: false",
      `- errorType: ${errorInfo.type}`,
      `- errorMessage: ${errorInfo.message}`,
      `- trace: ${failureContext.tracePath}`,
      `- mcpConfig: ${failureContext.mcpConfigPath}`,
      `- stderrBytes: ${failureContext.stderrBytes()}`,
      "",
    ].join("\n"),
    "utf8",
  );
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
  const rulesFile = resolve(repoRoot, "examples/qferry.rules.json");
  const mcpConfigPath = resolve(pluginDir, ".mcp.json");
  const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf8"));
  const serverConfig = mcpConfig.mcpServers?.qferry ?? mcpConfig.qferry;
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
  failureContext = {
    baseEvent,
    artifactDir,
    tracePath,
    summaryPath,
    mcpConfigPath,
    stderrBytes: () => stderrChunks.join("").length,
  };

  await client.connect(transport);
  const status = await callToolWithStructuredContent(client, "get_status", {});
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_status",
    statusProvider: status.structuredContent?.status?.provider,
    statusConfigSource: status.structuredContent?.status?.configSource,
    statusWarnings: status.structuredContent?.status?.statusWarnings,
  });

  const capability = await callToolWithStructuredContent(client, "get_capability_snapshot", {});
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_capability_snapshot",
    structuredContentKeys: Object.keys(capability.structuredContent ?? {}),
  });

  const mailboxes = await callToolWithStructuredContent(client, "list_mailboxes", {});
  const mailboxCount = Array.isArray(mailboxes.structuredContent?.mailboxes)
    ? mailboxes.structuredContent.mailboxes.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "list_mailboxes",
    mailboxCount,
  });

  const search = await callToolWithStructuredContent(client, "search", { folder: "INBOX", limit: 1 });
  const sampledMessages = Array.isArray(search.structuredContent?.messages)
    ? search.structuredContent.messages.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "search",
    sampledMessages,
  });

  const triage = await callToolWithStructuredContent(
    client,
    "triage_inbox",
    {
      folder: "INBOX",
      limit: 1,
      rulesFile,
    },
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "triage_inbox",
    sampledMessages: triage.structuredContent?.triage?.sampledMessages,
    triageGroupCounts: triage.structuredContent?.triage?.groupCounts,
    mutationsAttempted: triage.structuredContent?.mutationsAttempted,
  });

  const previewPlan = await callToolWithStructuredContent(
    client,
    "plan_cleanup",
    {
      runId,
      folder: "INBOX",
      limit: 1,
      action: "move",
      target: { folder: "Archive" },
      rulesFile,
      selectedGroupIds: ["archive"],
    },
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "plan_cleanup",
    rulesetVersion: previewPlan.structuredContent?.ruleset?.version,
    planStatus: previewPlan.structuredContent?.plan?.status,
    plannedMessageRefs: Array.isArray(previewPlan.structuredContent?.plan?.messageRefs)
      ? previewPlan.structuredContent.plan.messageRefs.length
      : 0,
    mutationsAttempted: previewPlan.structuredContent?.mutationsAttempted,
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
      `- statusProvider: ${status.structuredContent?.status?.provider ?? "<missing>"}`,
      `- statusConfigSource: ${status.structuredContent?.status?.configSource ?? "<missing>"}`,
      `- statusWarnings: ${(status.structuredContent?.status?.statusWarnings ?? []).join("; ")}`,
      `- rulesFile: ${rulesFile}`,
      `- rulesetVersion: ${previewPlan.structuredContent?.ruleset?.version ?? "<missing>"}`,
      `- rulesetRuleCount: ${previewPlan.structuredContent?.ruleset?.ruleCount ?? "<missing>"}`,
      `- folderCount: ${mailboxCount}`,
      `- sampledMessages: ${sampledMessages}`,
      `- triageGroupCounts: ${JSON.stringify(triage.structuredContent?.triage?.groupCounts ?? {})}`,
      `- triageSampledMessages: ${triage.structuredContent?.triage?.sampledMessages ?? "<missing>"}`,
      `- previewPlanStatus: ${previewPlan.structuredContent?.plan?.status ?? "<missing>"}`,
      `- previewPlanMessageRefs: ${previewPlan.structuredContent?.plan?.messageRefs?.length ?? "<missing>"}`,
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

  failureContext = undefined;
  process.stdout.write(`${JSON.stringify({
    provider: "qqmail",
    runId,
    mutationsAttempted: 0,
    artifacts: { tracePath, summaryPath },
  }, null, 2)}\n`);
}

async function callToolWithStructuredContent(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`QFerry plugin tool ${name} returned an error: ${JSON.stringify(result.content)}`);
  }
  if (!result.structuredContent || Object.keys(result.structuredContent).length === 0) {
    throw new Error(`QFerry plugin tool ${name} did not return structuredContent`);
  }
  return result;
}

await main().catch(async (error) => {
  await recordFailure(error);
  throw error;
});
