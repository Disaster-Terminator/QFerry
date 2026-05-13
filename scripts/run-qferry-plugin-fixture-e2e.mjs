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
    provider: "fixture",
    surface: "codex-plugin",
    dryRun: true,
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
    ["search", { folder: "INBOX", limit: 10, fromIncludes: "newsletter@", fromDomainIncludes: "example.com", subjectIncludes: "digest", hasFlag: "\\Seen" }],
    ["fetch", { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }],
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
    ["preview_cleanup_batch", {
      runId,
      folder: "INBOX",
      pageSize: 1,
      maxPages: 2,
      maxMessageRefs: 1,
      action: "move",
      target: { folder: "Archive" },
      rulesFile,
      selectedGroupIds: ["archive"],
    }],
    ["plan_sender_governance", {
      runId,
      folder: "INBOX",
      pageSize: 1,
      maxPages: 2,
      maxMessageRefs: 1,
      action: "move",
      target: { folder: "Archive" },
      selectedSenderDomains: ["example.com"],
    }],
    ["bulk_governance_preview", {
      runId,
      folder: "INBOX",
      pageSize: 2,
      maxPages: 2,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "Archive" },
      selectedCategoryIds: ["newsletter_or_digest"],
    }],
  ];
  let statusResult;
  let mailboxSummaryResult;
  let structuredSearchResult;
  let fetchResult;
  let classifyResult;
  let triageResult;
  let spamCandidatesResult;
  let planResult;
  let batchPreviewResult;
  let senderGovernanceResult;
  let bulkGovernanceResult;
  let rulesetPatchApplyResult;
  let blockedExecuteResult;

  for (const [name, args] of calls) {
    const result = await callToolWithStructuredContent(client, name, args);
    if (name === "get_status") statusResult = result.structuredContent;
    if (name === "get_mailbox_summary") mailboxSummaryResult = result.structuredContent;
    if (name === "search" && args.fromIncludes) structuredSearchResult = result.structuredContent;
    if (name === "fetch") fetchResult = result.structuredContent;
    if (name === "classify_messages") classifyResult = result.structuredContent;
    if (name === "triage_inbox") triageResult = result.structuredContent;
    if (name === "group_spam_candidates") spamCandidatesResult = result.structuredContent;
    if (name === "plan_cleanup") planResult = result.structuredContent;
    if (name === "preview_cleanup_batch") batchPreviewResult = result.structuredContent;
    if (name === "plan_sender_governance") senderGovernanceResult = result.structuredContent;
    if (name === "bulk_governance_preview") bulkGovernanceResult = result.structuredContent;
    await writeJsonl(tracePath, {
      ...baseEvent,
      event: "plugin_tool_called",
      toolName: name,
      structuredContentKeys: Object.keys(result.structuredContent ?? {}),
      statusProvider: result.structuredContent?.status?.provider,
      statusMutationCapable: result.structuredContent?.status?.mutationCapable,
      statusMutationOperationallyReady: result.structuredContent?.status?.mutationOperationallyReady,
      statusMutationRequiresConfirmation: result.structuredContent?.status?.mutationRequiresConfirmation,
      statusAuthConfigured: result.structuredContent?.status?.authConfigured,
      statusProviderReady: result.structuredContent?.status?.providerReady,
      sampledMessages: result.structuredContent?.triage?.sampledMessages,
      triageGroupCounts: result.structuredContent?.triage?.groupCounts,
      priorityCounts: result.structuredContent?.priorityCounts,
      priorityBucketWeights: summarizePriorityBucketWeights(result.structuredContent?.priorityBuckets),
      mailboxExists: result.structuredContent?.mailbox?.exists,
      searchResultCount: Array.isArray(result.structuredContent?.messages)
        ? result.structuredContent.messages.length
        : undefined,
      fetchedSubject: result.structuredContent?.message?.subject,
      spamCandidateGroups: result.structuredContent?.groups,
      batchPagesScanned: result.structuredContent?.preview?.pagesScanned,
      batchScannedMessages: result.structuredContent?.preview?.scannedMessages,
      batchSelectedMessageRefs: result.structuredContent?.preview?.selectedMessageRefs,
      batchPlanStatus: result.structuredContent?.plan?.status,
      senderGovernanceDomainCandidates: result.structuredContent?.governance?.domainCandidates?.length,
      senderGovernanceSelectedRefs: result.structuredContent?.governance?.selectedMessageRefs,
      senderGovernanceBlocklistSupported: result.structuredContent?.governance?.serverBlocklistCapability?.supported,
      senderGovernanceRulesToAdd: result.structuredContent?.rulesetPatch?.rulesToAdd?.length,
      senderGovernanceSkippedDuplicates: result.structuredContent?.rulesetPatch?.skippedDuplicateRules?.length,
      senderGovernanceRenderedDraftRules: result.structuredContent?.rulesetPatch?.renderedDraft?.rules?.length,
      senderGovernanceChangelogLines: countLines(result.structuredContent?.rulesetPatch?.changelog),
      bulkGovernanceScannedMessages: result.structuredContent?.preview?.scannedMessages,
      bulkGovernanceSelectedRefs: result.structuredContent?.preview?.selectedMessageRefs,
      bulkGovernanceCategoryCounts: result.structuredContent?.preview?.categoryCounts,
      bulkGovernancePlanSource: result.structuredContent?.plan?.source,
    });
  }

  rulesetPatchApplyResult = await callToolWithStructuredContent(client, "apply_ruleset_patch", {
    rulesFile,
    apply: false,
    patch: senderGovernanceResult.rulesetPatch,
  });
  await writeJsonl(tracePath, {
    ...baseEvent,
    event: "plugin_tool_called",
    toolName: "apply_ruleset_patch",
    applied: rulesetPatchApplyResult.structuredContent?.applied,
    beforeRuleCount: rulesetPatchApplyResult.structuredContent?.beforeRuleCount,
    afterRuleCount: rulesetPatchApplyResult.structuredContent?.afterRuleCount,
    addedRuleCount: rulesetPatchApplyResult.structuredContent?.addedRuleCount,
    skippedDuplicateRuleCount: rulesetPatchApplyResult.structuredContent?.skippedDuplicateRuleCount,
  });
  await writeJsonl(ledgerPath, {
    ...baseEvent,
    event: "governance_batch_recorded",
    batchId: "fixture-batch-0001",
    status: "rules_drafted",
    folder: "INBOX",
    scanOffset: 0,
    pageSize: 1,
    maxPages: 2,
    resumeToken: {
      folder: "INBOX",
      offset: senderGovernanceResult?.governance?.pagesScanned ?? 0,
      batchConfig: { pageSize: 1, maxPages: 2 },
    },
    scannedMessages: senderGovernanceResult?.governance?.scannedMessages,
    candidateCount: senderGovernanceResult?.governance?.domainCandidates?.length,
    selectedMessageRefs: senderGovernanceResult?.governance?.selectedMessageRefs,
    rulesToAdd: rulesetPatchApplyResult.structuredContent?.addedRuleCount,
    skippedDuplicateRules: rulesetPatchApplyResult.structuredContent?.skippedDuplicateRuleCount,
    mutationsAttempted: 0,
    completedRefsCount: 0,
    errorCount: 0,
    tracePath,
    summaryPath,
  });

  blockedExecuteResult = await client.callTool({
    name: "execute_cleanup",
    arguments: { operationPlanId: planResult.plan.operationPlanId },
  });
  if (!blockedExecuteResult.isError) {
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
      `# QFerry Plugin Fixture E2E ${runId}`,
      "",
      "- provider: fixture",
      "- surface: codex-plugin",
      "- dryRun: true",
      "- mutationsAttempted: 0",
      `- statusProvider: ${statusResult?.status?.provider ?? "<missing>"}`,
      `- statusConfigSource: ${statusResult?.status?.configSource ?? "<missing>"}`,
      `- statusMutationCapable: ${statusResult?.status?.mutationCapable ?? "<missing>"}`,
      `- statusMutationOperationallyReady: ${statusResult?.status?.mutationOperationallyReady ?? "<missing>"}`,
      `- statusMutationRequiresConfirmation: ${statusResult?.status?.mutationRequiresConfirmation ?? "<missing>"}`,
      `- statusAuthConfigured: ${statusResult?.status?.authConfigured ?? "<missing>"}`,
      `- statusProviderReady: ${statusResult?.status?.providerReady ?? "<missing>"}`,
      `- statusWarnings: ${(statusResult?.status?.statusWarnings ?? []).join("; ")}`,
      `- inboxExists: ${mailboxSummaryResult?.mailbox?.exists ?? "<missing>"}`,
      `- structuredSearchMessages: ${structuredSearchResult?.messages?.length ?? "<missing>"}`,
      `- fetchedSubject: ${fetchResult?.message?.subject ?? "<missing>"}`,
      `- rulesFile: ${rulesFile}`,
      `- rulesetVersion: ${classifyResult?.ruleset?.version ?? "<missing>"}`,
      `- rulesetRuleCount: ${classifyResult?.ruleset?.ruleCount ?? "<missing>"}`,
      `- toolsListed: ${tools.tools.length}`,
      `- toolsCalled: ${calls.length + 1}`,
      `- executeCleanupBlocked: ${blockedExecuteResult?.isError === true}`,
      `- triageGroupCounts: ${JSON.stringify(triageResult?.triage?.groupCounts ?? {})}`,
      `- priorityCounts: ${JSON.stringify(triageResult?.priorityCounts ?? {})}`,
      `- priorityBucketWeights: ${JSON.stringify(summarizePriorityBucketWeights(triageResult?.priorityBuckets))}`,
      `- triageSampledMessages: ${triageResult?.triage?.sampledMessages ?? "<missing>"}`,
      `- spamCandidateGroups: ${JSON.stringify(Object.keys(spamCandidatesResult?.groups ?? {}))}`,
      `- previewPlanStatus: ${planResult?.plan?.status ?? "<missing>"}`,
      `- previewPlanMessageRefs: ${planResult?.plan?.messageRefs?.length ?? "<missing>"}`,
      `- batchPreviewPlanStatus: ${batchPreviewResult?.plan?.status ?? "<missing>"}`,
      `- batchPreviewSelectedRefs: ${batchPreviewResult?.preview?.selectedMessageRefs ?? "<missing>"}`,
      `- batchPreviewScannedMessages: ${batchPreviewResult?.preview?.scannedMessages ?? "<missing>"}`,
      `- batchPreviewPagesScanned: ${batchPreviewResult?.preview?.pagesScanned ?? "<missing>"}`,
      `- senderGovernanceDomainCandidates: ${senderGovernanceResult?.governance?.domainCandidates?.length ?? "<missing>"}`,
      `- senderGovernanceSelectedRefs: ${senderGovernanceResult?.governance?.selectedMessageRefs ?? "<missing>"}`,
      `- senderGovernanceBlocklistSupported: ${senderGovernanceResult?.governance?.serverBlocklistCapability?.supported ?? "<missing>"}`,
      `- senderGovernanceRulesToAdd: ${senderGovernanceResult?.rulesetPatch?.rulesToAdd?.length ?? "<missing>"}`,
      `- senderGovernanceSkippedDuplicates: ${senderGovernanceResult?.rulesetPatch?.skippedDuplicateRules?.length ?? "<missing>"}`,
      `- senderGovernanceRenderedDraftRules: ${senderGovernanceResult?.rulesetPatch?.renderedDraft?.rules?.length ?? "<missing>"}`,
      `- senderGovernanceChangelogLines: ${countLines(senderGovernanceResult?.rulesetPatch?.changelog)}`,
      `- bulkGovernanceScannedMessages: ${bulkGovernanceResult?.preview?.scannedMessages ?? "<missing>"}`,
      `- bulkGovernanceSelectedRefs: ${bulkGovernanceResult?.preview?.selectedMessageRefs ?? "<missing>"}`,
      `- bulkGovernanceCategoryCounts: ${JSON.stringify(bulkGovernanceResult?.preview?.categoryCounts ?? {})}`,
      `- bulkGovernancePlanSource: ${bulkGovernanceResult?.plan?.source ?? "<missing>"}`,
      `- rulesetPatchDryRunApplied: ${rulesetPatchApplyResult?.structuredContent?.applied ?? "<missing>"}`,
      `- rulesetPatchDryRunAddedRules: ${rulesetPatchApplyResult?.structuredContent?.addedRuleCount ?? "<missing>"}`,
      `- governanceLedger: ${ledgerPath}`,
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

await main();
