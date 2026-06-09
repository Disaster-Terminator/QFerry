import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { JsonlTraceWriter } from "@qferry/core";

export interface CliAuditInfo {
  runId: string;
  tracePath: string;
  summaryPath: string;
}

export async function writeCliAudit(input: {
  root: string;
  runId: string;
  command: string;
  cliInput: Record<string, unknown>;
  result: Record<string, unknown>;
}): Promise<CliAuditInfo> {
  const root = resolve(input.root);
  const runId = validateRunId(input.runId);
  const tracePath = safePathInside(root, "logs", "runs", `${runId}.jsonl`);
  const artifactDir = safePathInside(root, "artifacts", "e2e", runId);
  const summaryPath = join(artifactDir, "summary.md");
  const summary = summarizeCliResult(input.result);
  const trace = new JsonlTraceWriter(tracePath);

  await trace.write({
    event: "cli_command_result",
    runId: input.runId,
    command: input.command,
    input: summarizeCliInput(input.cliInput),
    ...summary,
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    summaryPath,
    [
      `# QFerry CLI Audit ${input.runId}`,
      "",
      `- command: ${input.command}`,
      `- provider: ${summary.provider ?? "<none>"}`,
      `- folder: ${summary.folder ?? "<none>"}`,
      `- folders: ${formatSummaryJson(summary.folders)}`,
      `- fromDomainIncludes: ${summary.fromDomainIncludes ?? "<none>"}`,
      `- fromIncludes: ${summary.fromIncludes ?? "<none>"}`,
      `- maxSenderCandidates: ${summary.maxSenderCandidates ?? "<none>"}`,
      `- workflowPhases: ${formatWorkflowPhases(summary.workflowPhases)}`,
      `- error: ${summary.error ?? "<none>"}`,
      `- scanOffset: ${summary.scanOffset ?? "<none>"}`,
      `- scannedMessages: ${summary.scannedMessages ?? "<none>"}`,
      `- matchedMessages: ${summary.matchedMessages ?? "<none>"}`,
      `- senderCandidates: ${summary.senderCandidates ?? "<none>"}`,
      `- plannedMessages: ${summary.plannedMessages ?? "<none>"}`,
      `- recommendedNextAction: ${summary.recommendedNextAction ?? "<none>"}`,
      `- rulesToAdd: ${summary.rulesToAdd ?? "<none>"}`,
      `- rulesToReplace: ${summary.rulesToReplace ?? "<none>"}`,
      `- skippedDuplicateRules: ${summary.skippedDuplicateRules ?? "<none>"}`,
      `- mutationsAttempted: ${summary.mutationsAttempted}`,
      `- groupCounts: ${formatSummaryJson(summary.groupCounts)}`,
      `- campaignReport: ${formatSummaryJson(summary.campaignReport)}`,
      `- folderReports: ${formatSummaryJson(summary.folderReports)}`,
      `- groupPlans: ${formatSummaryJson(summary.groupPlans)}`,
      `- skippedGroups: ${formatSummaryJson(summary.skippedGroups)}`,
      `- trace: ${tracePath}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return { runId: input.runId, tracePath, summaryPath };
}

function validateRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(runId)) {
    throw new Error("QFerry runId may only contain letters, numbers, dot, underscore, and dash");
  }
  return runId;
}

function safePathInside(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("QFerry audit path must stay inside the trace root");
  }
  return target;
}

function summarizeCliInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    runId: input.runId,
    folder: input.folder,
    folders: input.folders,
    action: input.action,
    target: input.target,
    scanOffset: input.scanOffset,
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    maxPagesPerFolder: input.maxPagesPerFolder,
    maxMessageRefs: input.maxMessageRefs,
    maxMessageRefsPerGroup: input.maxMessageRefsPerGroup,
    selectedGroupIds: input.selectedGroupIds,
    selectedCategoryIds: input.selectedCategoryIds,
    fromDomainIncludes: input.fromDomainIncludes,
    fromIncludes: input.fromIncludes,
    maxSenderCandidates: input.maxSenderCandidates,
    rulesFile: input.rulesFile,
  };
}

function summarizeCliResult(result: Record<string, unknown>): Record<string, unknown> {
  const workflow = record(result.workflow);
  const workflowDiscovery = record(workflow?.discovery);
  const workflowPreview = record(workflow?.preview);
  const workflowPatch = record(workflow?.rulesetPatch);
  const planner = record(result.planner);
  const preview = record(result.preview) ?? workflowPreview;
  const campaign = record(result.campaign) ?? record(workflowDiscovery?.campaign);
  const breakdown = record(result.breakdown);
  const rulesetPatch = record(result.rulesetPatch) ?? workflowPatch;
  const campaignReport = record(preview?.campaignReport);
  const previewCampaign = record(workflowPreview?.campaign);

  return {
    provider: planner?.provider ?? preview?.provider ?? campaign?.provider ?? previewCampaign?.provider ?? breakdown?.provider,
    error: typeof result.error === "string" ? result.error : undefined,
    workflowPhases: workflow?.phases,
    folder: planner?.folder ?? preview?.folder ?? breakdown?.folder,
    folders: previewCampaign?.folders ?? campaign?.folders,
    fromDomainIncludes: breakdown?.fromDomainIncludes,
    fromIncludes: breakdown?.fromIncludes,
    maxSenderCandidates: record(breakdown?.candidateSummary)?.maxSenderCandidates,
    scanOffset: planner?.scanOffset ?? preview?.scanOffset ?? previewCampaign?.scanOffset ?? campaign?.scanOffset,
    scannedMessages: planner?.scannedMessages ?? preview?.scannedMessages ?? previewCampaign?.scannedMessages ?? campaign?.scannedMessages ?? breakdown?.scannedMessages,
    matchedMessages: breakdown?.matchedMessages,
    senderCandidates: record(breakdown?.candidateSummary)?.returnedSenderCandidates,
    plannedMessages: previewCampaign?.plannedMessages ?? campaign?.plannedMessages ?? campaignReport?.plannedMessages,
    recommendedNextAction: workflow?.recommendedNextAction ?? planner?.recommendedNextAction ?? previewCampaign?.recommendedNextAction ?? campaign?.recommendedNextAction,
    rulesToAdd: typeof rulesetPatch?.addedRuleCount === "number"
      ? rulesetPatch.addedRuleCount
      : Array.isArray(rulesetPatch?.rulesToAdd) ? rulesetPatch.rulesToAdd.length : undefined,
    rulesToReplace: typeof rulesetPatch?.replacedRuleCount === "number"
      ? rulesetPatch.replacedRuleCount
      : Array.isArray(rulesetPatch?.rulesToReplace) ? rulesetPatch.rulesToReplace.length : undefined,
    skippedDuplicateRules: typeof rulesetPatch?.skippedDuplicateRuleCount === "number"
      ? rulesetPatch.skippedDuplicateRuleCount
      : Array.isArray(rulesetPatch?.skippedDuplicateRules) ? rulesetPatch.skippedDuplicateRules.length : undefined,
    mutationsAttempted: result.mutationsAttempted
      ?? workflow?.mutationsAttempted
      ?? planner?.mutationsAttempted
      ?? preview?.mutationsAttempted
      ?? previewCampaign?.mutationsAttempted
      ?? campaign?.mutationsAttempted
      ?? 0,
    groupCounts: preview?.groupCounts,
    campaignReport: preview?.campaignReport ?? previewCampaign,
    folderReports: previewCampaign?.folderReports ?? campaign?.folderReports,
    groupPlans: preview?.groupPlans,
    skippedGroups: preview?.skippedGroups,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function formatSummaryJson(value: unknown): string {
  return value === undefined ? "<none>" : JSON.stringify(value);
}

function formatWorkflowPhases(value: unknown): string {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value.join(" -> ")
    : "<none>";
}
