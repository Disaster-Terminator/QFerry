import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  const tracePath = join(input.root, "logs", "runs", `${input.runId}.jsonl`);
  const artifactDir = join(input.root, "artifacts", "e2e", input.runId);
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
      `- scanOffset: ${summary.scanOffset ?? "<none>"}`,
      `- scannedMessages: ${summary.scannedMessages ?? "<none>"}`,
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
    rulesFile: input.rulesFile,
  };
}

function summarizeCliResult(result: Record<string, unknown>): Record<string, unknown> {
  const planner = record(result.planner);
  const preview = record(result.preview);
  const campaign = record(result.campaign);
  const rulesetPatch = record(result.rulesetPatch);
  const campaignReport = record(preview?.campaignReport);

  return {
    provider: planner?.provider ?? preview?.provider ?? campaign?.provider,
    folder: planner?.folder ?? preview?.folder,
    folders: campaign?.folders,
    scanOffset: planner?.scanOffset ?? preview?.scanOffset ?? campaign?.scanOffset,
    scannedMessages: planner?.scannedMessages ?? preview?.scannedMessages ?? campaign?.scannedMessages,
    plannedMessages: campaign?.plannedMessages ?? campaignReport?.plannedMessages,
    recommendedNextAction: planner?.recommendedNextAction ?? campaign?.recommendedNextAction,
    rulesToAdd: Array.isArray(rulesetPatch?.rulesToAdd) ? rulesetPatch.rulesToAdd.length : undefined,
    rulesToReplace: Array.isArray(rulesetPatch?.rulesToReplace) ? rulesetPatch.rulesToReplace.length : undefined,
    skippedDuplicateRules: Array.isArray(rulesetPatch?.skippedDuplicateRules) ? rulesetPatch.skippedDuplicateRules.length : undefined,
    mutationsAttempted: result.mutationsAttempted
      ?? planner?.mutationsAttempted
      ?? preview?.mutationsAttempted
      ?? campaign?.mutationsAttempted
      ?? 0,
    groupCounts: preview?.groupCounts,
    campaignReport: preview?.campaignReport,
    folderReports: campaign?.folderReports,
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
