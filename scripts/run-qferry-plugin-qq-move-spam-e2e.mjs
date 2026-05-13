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
  return `plugin-qq-move-spam-e2e-${stamp}-${random}`;
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
    event: "plugin_qq_move_spam_e2e_finished",
    ok: false,
    mutationsAttempted: failureContext.mutationsAttempted,
    artifactDir: failureContext.artifactDir,
    error: errorInfo,
    stderrBytes: failureContext.stderrBytes(),
  });
  await writeSummary({
    ...failureContext,
    ok: false,
    errorInfo,
  });
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
    throw new Error("QQMAIL_EMAIL and QQMAIL_KEY are required for plugin QQ move spam e2e");
  }

  const runId = createRunId();
  const candidateLimit = Number(process.env.QFERRY_MOVE_CANDIDATE_LIMIT ?? 10);
  const maxPages = Number(process.env.QFERRY_MOVE_MAX_PAGES ?? 25);
  const targetFolder = process.env.QFERRY_MOVE_TARGET_FOLDER ?? "Junk";
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
    provider: "qqmail",
    accountAlias: maskEmail(qqEmail),
    surface: "codex-plugin",
    destructive: true,
    candidateLimit,
    maxPages,
    targetFolder,
  };
  const state = {
    baseEvent,
    artifactDir,
    tracePath,
    summaryPath,
    mcpConfigPath,
    candidate: undefined,
    beforeInboxExists: undefined,
    afterInboxExists: undefined,
    beforeTargetExists: undefined,
    afterTargetExists: undefined,
    candidateOffset: undefined,
    planStatus: undefined,
    operationPlanId: undefined,
    moved: 0,
    mutationsAttempted: 0,
    noCandidate: false,
    stderrBytes: () => stderrChunks.join("").length,
  };

  await mkdir(artifactDir, { recursive: true });
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_qq_move_spam_e2e_started",
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
      QFERRY_METADATA_SAMPLE_LIMIT: String(candidateLimit),
      QQMAIL_METADATA_SAMPLE_LIMIT: String(candidateLimit),
      QQMAIL_EMAIL: qqEmail,
      QQMAIL_KEY: qqKey,
      QQMAIL_IMAP_HOST: process.env.QQMAIL_IMAP_HOST || dotenv.QQMAIL_IMAP_HOST || "imap.qq.com",
      QQMAIL_IMAP_PORT: process.env.QQMAIL_IMAP_PORT || dotenv.QQMAIL_IMAP_PORT || "993",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "qferry-plugin-qq-move-spam-e2e", version: "0.0.0" });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));
  failureContext = state;

  await client.connect(transport);
  const status = await callToolWithTrace(client, "get_status", {}, tracePath, baseEvent);
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_status",
    statusProvider: status.structuredContent?.status?.provider,
    statusConfigSource: status.structuredContent?.status?.configSource,
    statusWarnings: status.structuredContent?.status?.statusWarnings,
  });

  const beforeInbox = await callToolWithTrace(client, "get_mailbox_summary", { folder: "INBOX" }, tracePath, baseEvent);
  state.beforeInboxExists = beforeInbox.structuredContent?.mailbox?.exists;
  const beforeTarget = await callToolWithTrace(client, "get_mailbox_summary", { folder: targetFolder }, tracePath, baseEvent);
  state.beforeTargetExists = beforeTarget.structuredContent?.mailbox?.exists;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_mailbox_counts_before",
    inboxExists: state.beforeInboxExists,
    targetExists: state.beforeTargetExists,
  });

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * candidateLimit;
    const spamCandidates = await callToolWithTrace(
      client,
      "group_spam_candidates",
      {
        folder: "INBOX",
        limit: candidateLimit,
        offset,
        rules: spamRules(),
      },
      tracePath,
      baseEvent,
    );
    const candidateRefs = extractCandidateRefs(spamCandidates.structuredContent?.groups);
    state.candidate = candidateRefs[0];
    state.candidateOffset = offset;
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_spam_candidates_grouped",
      candidateCount: candidateRefs.length,
      selectedRef: state.candidate,
      scannedMessages: spamCandidates.structuredContent?.scannedMessages,
      scanOrder: spamCandidates.structuredContent?.scanOrder,
      scanOffset: spamCandidates.structuredContent?.scanOffset,
      mutationsAttempted: spamCandidates.structuredContent?.mutationsAttempted,
    });
    if (state.candidate) break;
    if (spamCandidates.structuredContent?.scannedMessages === 0) break;
  }

  if (!state.candidate) {
    state.noCandidate = true;
    await client.close();
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_qq_move_spam_e2e_finished",
      ok: true,
      noCandidate: true,
      mutationsAttempted: 0,
      artifactDir,
    });
    await writeSummary({ ...state, ok: true });
    failureContext = undefined;
    printResult(runId, 0, tracePath, summaryPath, true);
    return;
  }

  const previewPlan = await callToolWithTrace(
    client,
    "plan_cleanup",
    {
      runId,
      folder: "INBOX",
      limit: candidateLimit,
      action: "move",
      target: { folder: targetFolder },
      selectedGroupIds: [],
      messageRefs: [state.candidate],
    },
    tracePath,
    baseEvent,
  );
  const plan = previewPlan.structuredContent?.plan;
  state.planStatus = plan?.status;
  state.operationPlanId = plan?.operationPlanId;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_move_plan_previewed",
    operationPlanId: state.operationPlanId,
    planStatus: state.planStatus,
    plannedMessageRefs: plan?.messageRefs?.length ?? 0,
    targetFolder: plan?.target?.folder,
    mutationsAttempted: previewPlan.structuredContent?.mutationsAttempted,
  });

  const confirmedPlan = {
    ...plan,
    status: "confirmed",
    confirmationRequired: false,
  };
  const execution = await callToolWithTrace(client, "execute_cleanup", { plan: confirmedPlan }, tracePath, baseEvent);
  state.mutationsAttempted = execution.structuredContent?.result?.mutationsAttempted ?? 0;
  state.moved = execution.structuredContent?.result?.moved ?? 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_move_plan_executed",
    operationPlanId: state.operationPlanId,
    result: execution.structuredContent?.result,
    mutationsAttempted: state.mutationsAttempted,
  });

  const afterInbox = await callToolWithTrace(client, "get_mailbox_summary", { folder: "INBOX" }, tracePath, baseEvent);
  state.afterInboxExists = afterInbox.structuredContent?.mailbox?.exists;
  const afterTarget = await callToolWithTrace(client, "get_mailbox_summary", { folder: targetFolder }, tracePath, baseEvent);
  state.afterTargetExists = afterTarget.structuredContent?.mailbox?.exists;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_mailbox_counts_after",
    inboxExists: state.afterInboxExists,
    targetExists: state.afterTargetExists,
  });

  await client.close();
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_qq_move_spam_e2e_finished",
    ok: true,
    mutationsAttempted: state.mutationsAttempted,
    moved: state.moved,
    artifactDir,
  });
  await writeSummary({ ...state, ok: true });

  failureContext = undefined;
  printResult(runId, state.mutationsAttempted, tracePath, summaryPath, false);
}

async function callToolWithTrace(client, name, args, tracePath, baseEvent) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_failed",
      toolName: name,
      errorText: extractToolErrorText(result),
      content: summarizeToolContent(result.content),
    });
    throw new Error(`QFerry plugin tool ${name} returned an error: ${JSON.stringify(result.content)}`);
  }
  if (!result.structuredContent || Object.keys(result.structuredContent).length === 0) {
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_failed",
      toolName: name,
      errorText: "missing structuredContent",
      content: summarizeToolContent(result.content),
    });
    throw new Error(`QFerry plugin tool ${name} did not return structuredContent`);
  }
  return result;
}

function extractToolErrorText(result) {
  const textParts = Array.isArray(result.content)
    ? result.content
      .filter((part) => part?.type === "text")
      .map((part) => String(part.text ?? ""))
    : [];
  return textParts.join("\n").slice(0, 1000);
}

function summarizeToolContent(content) {
  if (!Array.isArray(content)) return [];
  return content.map((part) => {
    if (part?.type === "text") {
      return { type: "text", text: String(part.text ?? "").slice(0, 1000) };
    }
    return { type: part?.type ?? "unknown" };
  });
}

function extractCandidateRefs(groups) {
  if (!groups || typeof groups !== "object") return [];
  return Object.values(groups)
    .flatMap((candidates) => Array.isArray(candidates) ? candidates : [])
    .map((candidate) => candidate?.message?.ref)
    .filter((ref) => ref && typeof ref === "object");
}

function spamRules() {
  return [
    { id: "ad-subject", groupId: "ads_or_spam", match: { subjectIncludes: "广告" } },
    { id: "promo-subject", groupId: "ads_or_spam", match: { subjectIncludes: "优惠" } },
    { id: "unsubscribe-subject", groupId: "ads_or_spam", match: { subjectIncludes: "退订" } },
    { id: "windows-engage", groupId: "ads_or_spam", match: { fromIncludes: "engage.windows.com" } },
    { id: "newsletter-from", groupId: "ads_or_spam", match: { fromIncludes: "newsletter" } },
    { id: "digest-subject", groupId: "ads_or_spam", match: { subjectIncludes: "digest" } },
  ];
}

async function writeSummary(state) {
  await writeFile(
    state.summaryPath,
    [
      `# QFerry Plugin QQ Move Spam E2E ${state.baseEvent.runId}`,
      "",
      "- provider: qqmail",
      `- accountAlias: ${state.baseEvent.accountAlias}`,
      "- surface: codex-plugin",
      "- destructive: true",
      `- ok: ${state.ok}`,
      `- noCandidate: ${state.noCandidate}`,
      `- targetFolder: ${state.baseEvent.targetFolder}`,
      `- candidateLimit: ${state.baseEvent.candidateLimit}`,
      `- maxPages: ${state.baseEvent.maxPages}`,
      `- candidateOffset: ${state.candidateOffset ?? "<none>"}`,
      `- selectedRef: ${JSON.stringify(state.candidate ?? null)}`,
      `- planStatus: ${state.planStatus ?? "<none>"}`,
      `- operationPlanId: ${state.operationPlanId ?? "<none>"}`,
      `- mutationsAttempted: ${state.mutationsAttempted}`,
      `- moved: ${state.moved}`,
      `- beforeInboxExists: ${state.beforeInboxExists ?? "<missing>"}`,
      `- afterInboxExists: ${state.afterInboxExists ?? "<missing>"}`,
      `- beforeTargetExists: ${state.beforeTargetExists ?? "<missing>"}`,
      `- afterTargetExists: ${state.afterTargetExists ?? "<missing>"}`,
      state.errorInfo ? `- errorType: ${state.errorInfo.type}` : undefined,
      state.errorInfo ? `- errorMessage: ${state.errorInfo.message}` : undefined,
      `- trace: ${state.tracePath}`,
      `- mcpConfig: ${state.mcpConfigPath}`,
      `- stderrBytes: ${state.stderrBytes()}`,
      "",
    ].filter(Boolean).join("\n"),
    "utf8",
  );
}

function printResult(runId, mutationsAttempted, tracePath, summaryPath, noCandidate) {
  process.stdout.write(`${JSON.stringify({
    provider: "qqmail",
    runId,
    mutationsAttempted,
    noCandidate,
    artifacts: { tracePath, summaryPath },
  }, null, 2)}\n`);
}

await main().catch(async (error) => {
  await recordFailure(error);
  throw error;
});
