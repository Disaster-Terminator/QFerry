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
  await writeFile(path, `${JSON.stringify(sortJson(event))}\n`, { encoding: "utf8", flag: "a" });
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortJson(nested)]));
}

async function main() {
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
    env: { ...process.env, ...(serverConfig.env ?? {}), QFERRY_PROVIDER: "fixture" },
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
    ["get_status", {}],
    ["list_mailboxes", {}],
    ["get_mailbox_summary", { folder: "INBOX" }],
    ["search", { folder: "INBOX", limit: 10, query: "digest" }],
    ["classify_messages", { folder: "INBOX", limit: 10, rulesFile }],
    ["triage_inbox", { folder: "INBOX", limit: 10, rulesFile }],
    ["group_spam_candidates", {
      folder: "INBOX",
      limit: 10,
      rules: [
        { id: "newsletter", groupId: "ads_or_newsletters", match: { fromIncludes: "newsletter@" } },
        { id: "digest", groupId: "ads_or_newsletters", match: { subjectIncludes: "digest" } },
      ],
    }],
    ["plan_cleanup", {
      runId,
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rulesFile,
      selectedGroupIds: ["archive"],
    }],
  ];
  let statusResult;
  let mailboxSummaryResult;
  let classifyResult;
  let triageResult;
  let spamCandidatesResult;
  let planResult;

  for (const [name, args] of calls) {
    const result = await callToolWithStructuredContent(client, name, args);
    if (name === "get_status") statusResult = result.structuredContent;
    if (name === "get_mailbox_summary") mailboxSummaryResult = result.structuredContent;
    if (name === "classify_messages") classifyResult = result.structuredContent;
    if (name === "triage_inbox") triageResult = result.structuredContent;
    if (name === "group_spam_candidates") spamCandidatesResult = result.structuredContent;
    if (name === "plan_cleanup") planResult = result.structuredContent;
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_called",
      toolName: name,
      structuredContentKeys: Object.keys(result.structuredContent ?? {}),
      statusProvider: result.structuredContent?.status?.provider,
      sampledMessages: result.structuredContent?.triage?.sampledMessages,
      triageGroupCounts: result.structuredContent?.triage?.groupCounts,
      mailboxExists: result.structuredContent?.mailbox?.exists,
      spamCandidateGroups: result.structuredContent?.groups,
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
      `- statusProvider: ${statusResult?.status?.provider ?? "<missing>"}`,
      `- statusConfigSource: ${statusResult?.status?.configSource ?? "<missing>"}`,
      `- statusWarnings: ${(statusResult?.status?.statusWarnings ?? []).join("; ")}`,
      `- inboxExists: ${mailboxSummaryResult?.mailbox?.exists ?? "<missing>"}`,
      `- rulesFile: ${rulesFile}`,
      `- rulesetVersion: ${classifyResult?.ruleset?.version ?? "<missing>"}`,
      `- rulesetRuleCount: ${classifyResult?.ruleset?.ruleCount ?? "<missing>"}`,
      `- toolsListed: ${tools.tools.length}`,
      `- toolsCalled: ${calls.length}`,
      `- triageGroupCounts: ${JSON.stringify(triageResult?.triage?.groupCounts ?? {})}`,
      `- triageSampledMessages: ${triageResult?.triage?.sampledMessages ?? "<missing>"}`,
      `- spamCandidateGroups: ${JSON.stringify(Object.keys(spamCandidatesResult?.groups ?? {}))}`,
      `- previewPlanStatus: ${planResult?.plan?.status ?? "<missing>"}`,
      `- previewPlanMessageRefs: ${planResult?.plan?.messageRefs?.length ?? "<missing>"}`,
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

await main();
