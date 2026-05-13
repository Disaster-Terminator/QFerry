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
  const candidateLimit = 5;
  const artifactDir = resolve(repoRoot, "artifacts/e2e", runId);
  const tracePath = resolve(repoRoot, "logs/runs", `${runId}.jsonl`);
  const summaryPath = resolve(artifactDir, "summary.md");
  const ledgerPath = resolve(artifactDir, "governance-ledger.jsonl");
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
    sampleLimit: 1,
    candidateLimit,
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
      QFERRY_METADATA_SAMPLE_LIMIT: String(candidateLimit),
      QQMAIL_METADATA_SAMPLE_LIMIT: String(candidateLimit),
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
  const status = await callToolWithTrace(client, "get_status", {}, tracePath, baseEvent);
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_status",
    statusProvider: status.structuredContent?.status?.provider,
    statusConfigSource: status.structuredContent?.status?.configSource,
    statusWarnings: status.structuredContent?.status?.statusWarnings,
  });

  const capability = await callToolWithTrace(client, "get_capability_snapshot", {}, tracePath, baseEvent);
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_capability_snapshot",
    structuredContentKeys: Object.keys(capability.structuredContent ?? {}),
  });

  const mailboxes = await callToolWithTrace(client, "list_mailboxes", {}, tracePath, baseEvent);
  const mailboxCount = Array.isArray(mailboxes.structuredContent?.mailboxes)
    ? mailboxes.structuredContent.mailboxes.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "list_mailboxes",
    mailboxCount,
  });

  const mailboxSummary = await callToolWithTrace(client, "get_mailbox_summary", { folder: "INBOX" }, tracePath, baseEvent);
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "get_mailbox_summary",
    mailboxExists: mailboxSummary.structuredContent?.mailbox?.exists,
  });

  const search = await callToolWithTrace(client, "search", { folder: "INBOX", limit: 1 }, tracePath, baseEvent);
  const sampledMessages = Array.isArray(search.structuredContent?.messages)
    ? search.structuredContent.messages.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "search",
    sampledMessages,
  });
  const structuredSearch = await callToolWithTrace(
    client,
    "search",
    { folder: "INBOX", limit: 1, fromIncludes: "@", dateBefore: "2100-01-01T00:00:00.000Z" },
    tracePath,
    baseEvent,
  );
  const structuredSearchMessages = Array.isArray(structuredSearch.structuredContent?.messages)
    ? structuredSearch.structuredContent.messages.length
    : 0;
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "search_structured",
    sampledMessages: structuredSearchMessages,
    mutationsAttempted: 0,
  });

  const spamCandidates = await callToolWithTrace(
    client,
    "group_spam_candidates",
    {
      folder: "INBOX",
      limit: candidateLimit,
      rules: [
        { id: "ad-subject", groupId: "ads_or_spam", match: { subjectIncludes: "广告" } },
        { id: "promo-subject", groupId: "ads_or_spam", match: { subjectIncludes: "优惠" } },
        { id: "newsletter-subject", groupId: "ads_or_spam", match: { subjectIncludes: "newsletter" } },
        { id: "digest-subject", groupId: "ads_or_spam", match: { subjectIncludes: "digest" } },
      ],
    },
    tracePath,
    baseEvent,
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "group_spam_candidates",
    scannedMessages: spamCandidates.structuredContent?.scannedMessages,
    scanOrder: spamCandidates.structuredContent?.scanOrder,
    spamCandidateGroups: spamCandidates.structuredContent?.groups,
    mutationsAttempted: spamCandidates.structuredContent?.mutationsAttempted,
  });
  const spamCandidateRefs = extractCandidateRefs(spamCandidates.structuredContent?.groups);
  const spamPreviewPlan = spamCandidateRefs.length > 0
    ? await callToolWithTrace(
      client,
      "plan_cleanup",
      {
        runId,
        folder: "INBOX",
        limit: candidateLimit,
        action: "move",
        target: { folder: "Junk" },
        selectedGroupIds: [],
        messageRefs: spamCandidateRefs,
      },
      tracePath,
      baseEvent,
    )
    : undefined;
  if (spamPreviewPlan) {
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_called",
      toolName: "plan_cleanup_selected_refs",
      planStatus: spamPreviewPlan.structuredContent?.plan?.status,
      plannedMessageRefs: Array.isArray(spamPreviewPlan.structuredContent?.plan?.messageRefs)
        ? spamPreviewPlan.structuredContent.plan.messageRefs.length
        : 0,
      targetFolder: spamPreviewPlan.structuredContent?.plan?.target?.folder,
      mutationsAttempted: spamPreviewPlan.structuredContent?.mutationsAttempted,
    });
  }

  const triage = await callToolWithTrace(
    client,
    "triage_inbox",
    {
      folder: "INBOX",
      limit: 1,
      rulesFile,
    },
    tracePath,
    baseEvent,
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "triage_inbox",
    sampledMessages: triage.structuredContent?.triage?.sampledMessages,
    triageGroupCounts: triage.structuredContent?.triage?.groupCounts,
    priorityCounts: triage.structuredContent?.priorityCounts,
    priorityBucketWeights: summarizePriorityBucketWeights(triage.structuredContent?.priorityBuckets),
    mutationsAttempted: triage.structuredContent?.mutationsAttempted,
  });

  const previewPlan = await callToolWithTrace(
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
    tracePath,
    baseEvent,
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

  const batchPreview = await callToolWithTrace(
    client,
    "preview_cleanup_batch",
    {
      runId,
      folder: "INBOX",
      pageSize: candidateLimit,
      maxPages: 2,
      maxMessageRefs: 5,
      action: "move",
      target: { folder: "Junk" },
      rules: [
        { id: "ad-subject", groupId: "ads_or_spam", match: { subjectIncludes: "广告" } },
        { id: "promo-subject", groupId: "ads_or_spam", match: { subjectIncludes: "优惠" } },
        { id: "newsletter-subject", groupId: "ads_or_spam", match: { subjectIncludes: "newsletter" } },
        { id: "digest-subject", groupId: "ads_or_spam", match: { subjectIncludes: "digest" } },
      ],
      selectedGroupIds: ["ads_or_spam"],
      order: "oldest",
    },
    tracePath,
    baseEvent,
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "preview_cleanup_batch",
    pagesScanned: batchPreview.structuredContent?.preview?.pagesScanned,
    scannedMessages: batchPreview.structuredContent?.preview?.scannedMessages,
    selectedMessageRefs: batchPreview.structuredContent?.preview?.selectedMessageRefs,
    planStatus: batchPreview.structuredContent?.plan?.status,
    plannedMessageRefs: Array.isArray(batchPreview.structuredContent?.plan?.messageRefs)
      ? batchPreview.structuredContent.plan.messageRefs.length
      : 0,
    mutationsAttempted: batchPreview.structuredContent?.mutationsAttempted,
  });

  const senderGovernance = await callToolWithTrace(
    client,
    "plan_sender_governance",
    {
      runId,
      folder: "INBOX",
      pageSize: candidateLimit,
      maxPages: 2,
      maxMessageRefs: 0,
      action: "move",
      target: { folder: "Junk" },
      order: "oldest",
    },
    tracePath,
    baseEvent,
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "plan_sender_governance",
    pagesScanned: senderGovernance.structuredContent?.governance?.pagesScanned,
    scannedMessages: senderGovernance.structuredContent?.governance?.scannedMessages,
    domainCandidates: senderGovernance.structuredContent?.governance?.domainCandidates?.length,
    selectedMessageRefs: senderGovernance.structuredContent?.governance?.selectedMessageRefs,
    blocklistSupported: senderGovernance.structuredContent?.governance?.serverBlocklistCapability?.supported,
    rulesToAdd: senderGovernance.structuredContent?.rulesetPatch?.rulesToAdd?.length,
    skippedDuplicateRules: senderGovernance.structuredContent?.rulesetPatch?.skippedDuplicateRules?.length,
    renderedDraftRules: senderGovernance.structuredContent?.rulesetPatch?.renderedDraft?.rules?.length,
    changelogLines: countLines(senderGovernance.structuredContent?.rulesetPatch?.changelog),
    planStatus: senderGovernance.structuredContent?.plan?.status,
    plannedMessageRefs: Array.isArray(senderGovernance.structuredContent?.plan?.messageRefs)
      ? senderGovernance.structuredContent.plan.messageRefs.length
      : 0,
    mutationsAttempted: senderGovernance.structuredContent?.mutationsAttempted,
  });

  const rulesetPatchDryRun = await callToolWithTrace(
    client,
    "apply_ruleset_patch",
    {
      rulesFile,
      apply: false,
      patch: senderGovernance.structuredContent?.rulesetPatch,
    },
    tracePath,
    baseEvent,
  );
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "apply_ruleset_patch",
    applied: rulesetPatchDryRun.structuredContent?.applied,
    beforeRuleCount: rulesetPatchDryRun.structuredContent?.beforeRuleCount,
    afterRuleCount: rulesetPatchDryRun.structuredContent?.afterRuleCount,
    addedRuleCount: rulesetPatchDryRun.structuredContent?.addedRuleCount,
    skippedDuplicateRuleCount: rulesetPatchDryRun.structuredContent?.skippedDuplicateRuleCount,
    mutationsAttempted: 0,
  });
  await writeJsonl(ledgerPath, {
    ...baseEvent,
    event: "governance_batch_recorded",
    batchId: "qq-readonly-batch-0001",
    status: "rules_drafted",
    folder: "INBOX",
    scanOffset: 0,
    pageSize: candidateLimit,
    maxPages: 2,
    resumeToken: {
      folder: "INBOX",
      offset: (senderGovernance.structuredContent?.governance?.pagesScanned ?? 0) * candidateLimit,
      batchConfig: { pageSize: candidateLimit, maxPages: 2 },
    },
    scannedMessages: senderGovernance.structuredContent?.governance?.scannedMessages,
    candidateCount: senderGovernance.structuredContent?.governance?.domainCandidates?.length,
    selectedMessageRefs: senderGovernance.structuredContent?.governance?.selectedMessageRefs,
    rulesToAdd: rulesetPatchDryRun.structuredContent?.addedRuleCount,
    skippedDuplicateRules: rulesetPatchDryRun.structuredContent?.skippedDuplicateRuleCount,
    mutationsAttempted: 0,
    completedRefsCount: 0,
    errorCount: 0,
    tracePath,
    summaryPath,
  });

  const blockedExecute = await client.callTool({
    name: "execute_cleanup",
    arguments: { plan: previewPlan.structuredContent?.plan },
  });
  if (!blockedExecute.isError) {
    throw new Error("QFerry plugin execute_cleanup was expected to be blocked until the plan is confirmed");
  }
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_blocked",
    toolName: "execute_cleanup",
    reason: "plan_not_confirmed",
    mutationsAttempted: 0,
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
      "- mutationsAttempted: 0",
      `- statusProvider: ${status.structuredContent?.status?.provider ?? "<missing>"}`,
      `- statusConfigSource: ${status.structuredContent?.status?.configSource ?? "<missing>"}`,
      `- statusWarnings: ${(status.structuredContent?.status?.statusWarnings ?? []).join("; ")}`,
      `- rulesFile: ${rulesFile}`,
      `- rulesetVersion: ${previewPlan.structuredContent?.ruleset?.version ?? "<missing>"}`,
      `- rulesetRuleCount: ${previewPlan.structuredContent?.ruleset?.ruleCount ?? "<missing>"}`,
      `- folderCount: ${mailboxCount}`,
      `- inboxExists: ${mailboxSummary.structuredContent?.mailbox?.exists ?? "<missing>"}`,
      `- sampledMessages: ${sampledMessages}`,
      `- structuredSearchMessages: ${structuredSearchMessages}`,
      `- spamCandidateGroups: ${JSON.stringify(Object.keys(spamCandidates.structuredContent?.groups ?? {}))}`,
      `- spamCandidateCount: ${countGroupedCandidates(spamCandidates.structuredContent?.groups)}`,
      `- spamPreviewPlanStatus: ${spamPreviewPlan?.structuredContent?.plan?.status ?? "<none>"}`,
      `- spamPreviewPlanMessageRefs: ${spamPreviewPlan?.structuredContent?.plan?.messageRefs?.length ?? 0}`,
      `- spamPreviewPlanTarget: ${spamPreviewPlan?.structuredContent?.plan?.target?.folder ?? "<none>"}`,
      `- triageGroupCounts: ${JSON.stringify(triage.structuredContent?.triage?.groupCounts ?? {})}`,
      `- priorityCounts: ${JSON.stringify(triage.structuredContent?.priorityCounts ?? {})}`,
      `- priorityBucketWeights: ${JSON.stringify(summarizePriorityBucketWeights(triage.structuredContent?.priorityBuckets))}`,
      `- triageSampledMessages: ${triage.structuredContent?.triage?.sampledMessages ?? "<missing>"}`,
      `- previewPlanStatus: ${previewPlan.structuredContent?.plan?.status ?? "<missing>"}`,
      `- previewPlanMessageRefs: ${previewPlan.structuredContent?.plan?.messageRefs?.length ?? "<missing>"}`,
      `- batchPreviewPlanStatus: ${batchPreview.structuredContent?.plan?.status ?? "<missing>"}`,
      `- batchPreviewSelectedRefs: ${batchPreview.structuredContent?.preview?.selectedMessageRefs ?? "<missing>"}`,
      `- batchPreviewScannedMessages: ${batchPreview.structuredContent?.preview?.scannedMessages ?? "<missing>"}`,
      `- batchPreviewPagesScanned: ${batchPreview.structuredContent?.preview?.pagesScanned ?? "<missing>"}`,
      `- senderGovernanceDomainCandidates: ${senderGovernance.structuredContent?.governance?.domainCandidates?.length ?? "<missing>"}`,
      `- senderGovernanceSelectedRefs: ${senderGovernance.structuredContent?.governance?.selectedMessageRefs ?? "<missing>"}`,
      `- senderGovernanceBlocklistSupported: ${senderGovernance.structuredContent?.governance?.serverBlocklistCapability?.supported ?? "<missing>"}`,
      `- senderGovernanceRulesToAdd: ${senderGovernance.structuredContent?.rulesetPatch?.rulesToAdd?.length ?? "<missing>"}`,
      `- senderGovernanceSkippedDuplicates: ${senderGovernance.structuredContent?.rulesetPatch?.skippedDuplicateRules?.length ?? "<missing>"}`,
      `- senderGovernanceRenderedDraftRules: ${senderGovernance.structuredContent?.rulesetPatch?.renderedDraft?.rules?.length ?? "<missing>"}`,
      `- senderGovernanceChangelogLines: ${countLines(senderGovernance.structuredContent?.rulesetPatch?.changelog)}`,
      `- rulesetPatchDryRunApplied: ${rulesetPatchDryRun.structuredContent?.applied ?? "<missing>"}`,
      `- rulesetPatchDryRunAddedRules: ${rulesetPatchDryRun.structuredContent?.addedRuleCount ?? "<missing>"}`,
      `- governanceLedger: ${ledgerPath}`,
      `- executeCleanupBlocked: ${blockedExecute.isError === true}`,
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

async function callToolWithTrace(client, name, args, tracePath, baseEvent) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_failed",
      toolName: name,
      errorText: extractToolErrorText(result),
      content: summarizeToolContent(result.content),
      mutationsAttempted: 0,
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
      mutationsAttempted: 0,
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

function countGroupedCandidates(groups) {
  if (!groups || typeof groups !== "object") return 0;
  return Object.values(groups).reduce((total, candidates) => total + (Array.isArray(candidates) ? candidates.length : 0), 0);
}

function extractCandidateRefs(groups) {
  if (!groups || typeof groups !== "object") return [];
  return Object.values(groups)
    .flatMap((candidates) => Array.isArray(candidates) ? candidates : [])
    .map((candidate) => candidate?.message?.ref)
    .filter((ref) => ref && typeof ref === "object");
}

function summarizePriorityBucketWeights(priorityBuckets) {
  if (!Array.isArray(priorityBuckets)) return {};
  return Object.fromEntries(priorityBuckets.map((bucket) => [
    bucket?.id,
    Array.isArray(bucket?.candidates)
      ? bucket.candidates.map((candidate) => candidate?.weight).filter((weight) => typeof weight === "number")
      : [],
  ]).filter(([id]) => typeof id === "string"));
}

function countLines(value) {
  return typeof value === "string" && value.length > 0 ? value.split("\n").length : 0;
}

await main().catch(async (error) => {
  await recordFailure(error);
  throw error;
});
