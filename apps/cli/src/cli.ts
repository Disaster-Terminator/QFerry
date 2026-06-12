#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyRulesetPatchDraft,
  createMailProviderFromRuntimeConfig,
  createMailTools,
  createRunId,
  loadPatchableRuleset,
  loadQFerryRuntimeConfigSync,
  renderRulesetPatchDraft,
  type ClassificationGroup,
  type ClassificationRule,
  type ClassificationRulesetJsonDraft,
  type HighYieldGovernanceInput,
  type MailboxGovernanceCampaignInput,
  type OperationAction,
  type RulesetPatchDraft,
  type RulesetGovernanceCampaignPreviewInput,
  type RulesetGovernancePreviewInput,
  type SenderBreakdownInput,
} from "@qferry/core";
import { writeCliAudit } from "./audit.js";

export interface CliRunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean | string[]>;
}

type CliResult = Record<string, unknown>;
type MailTools = ReturnType<typeof createMailTools>;
type RulesetCampaignPreviewCompact = Omit<
  Awaited<ReturnType<MailTools["rulesetGovernanceCampaignPreview"]>>,
  "plans"
>;
type MixedDomainNextStep = {
  folder: string;
  domain: string;
  messageCount: number;
  uniqueSenderCount: number;
  args: string[];
  command: string;
};
type MixedDomainBreakdownReport = {
  folder: string;
  domain: string;
  matchedMessages: number;
  returnedSenderCandidates: number;
  candidateSenderRules: number;
  selectedSenderRules: number;
  skippedSenderRules: number;
  draftSenderRules: boolean;
};

interface CampaignWorkflowInput extends MailboxGovernanceCampaignInput {
  runId?: string;
  applyRulesetPatch?: boolean;
  includeRenderedDraft?: boolean;
  breakdownMixedDomains?: {
    enabled?: boolean;
    draftSenderRules?: boolean;
    maxDomains?: number;
    maxSenderCandidatesPerDomain?: number;
    minSenderMessageCount?: number;
  };
  preview?: {
    enabled?: boolean;
    action?: OperationAction;
    maxMessageRefsPerGroup?: number;
    selectedGroupIds?: string[];
    maxUnplannedHintsPerFolder?: number;
  };
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 1;

export async function runCli(args: string[] = process.argv.slice(2), options: CliRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = options.stderr ?? ((chunk) => process.stderr.write(chunk));
  const cwd = options.cwd ?? process.cwd();
  const env = { ...process.env, ...options.env };
  let parsedCommand: string | undefined;
  let runId: string | undefined;
  let cliInput: Record<string, unknown> = {};

  try {
    const parsed = parseArgs(args);
    parsedCommand = parsed.command;
    if (parsed.command === "help" || parsed.flags.help === true) {
      stdout(`${usage()}\n`);
      return 0;
    }

    const runtimeConfig = loadQFerryRuntimeConfigSync(env);
    const provider = createMailProviderFromRuntimeConfig(runtimeConfig, { env });
    const tools = createMailTools({ provider, runtimeConfig });
    let result: CliResult;

    switch (parsed.command) {
      case "status":
        result = await tools.getStatus();
        break;
      case "list-mailboxes":
        result = await tools.listMailboxes();
        break;
      case "mailbox-summary":
        cliInput = { folder: requiredString(parsed.flags, "folder") };
        result = await tools.getMailboxSummary(cliInput as { folder: string });
        break;
      case "high-yield": {
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? createRunId("qferry-cli-high-yield"));
        const input = highYieldInput(parsed.flags);
        cliInput = { ...input, runId };
        result = await tools.planHighYieldGovernance(input);
        break;
      }
      case "sender-breakdown": {
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? createRunId("qferry-cli-sender-breakdown"));
        const input = senderBreakdownInput(parsed.flags);
        cliInput = { ...input, runId };
        result = await tools.senderBreakdown(input);
        break;
      }
      case "mailbox-campaign": {
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? createRunId("qferry-cli-mailbox-campaign"));
        const input = await jsonInput<MailboxGovernanceCampaignInput>(cwd, parsed.flags);
        cliInput = { ...input, runId };
        result = await tools.planMailboxGovernanceCampaign(input);
        break;
      }
      case "ruleset-preview": {
        const input = await jsonInput<RulesetGovernancePreviewInput>(cwd, parsed.flags);
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? input.runId ?? createRunId("qferry-cli-ruleset-preview"));
        const resolvedInput = { ...input, runId };
        cliInput = resolvedInput;
        result = compactRulesetGovernancePreview(await tools.rulesetGovernancePreview(resolvedInput), hasFlag(parsed.flags, "include-classifications"));
        break;
      }
      case "ruleset-campaign-preview": {
        const input = await jsonInput<RulesetGovernanceCampaignPreviewInput>(cwd, parsed.flags);
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? input.runId ?? createRunId("qferry-cli-ruleset-campaign"));
        const resolvedInput = { ...input, runId };
        cliInput = resolvedInput;
        result = compactRulesetGovernanceCampaignPreview(await tools.rulesetGovernanceCampaignPreview(resolvedInput));
        break;
      }
      case "campaign-workflow": {
        const input = validateCampaignWorkflowInput(await jsonInput<CampaignWorkflowInput>(cwd, parsed.flags));
        runId = validateRunId(optionalString(parsed.flags, "run-id") ?? input.runId ?? createRunId("qferry-cli-campaign-workflow"));
        const resolvedInput = { ...input, runId };
        cliInput = compactCampaignWorkflowInput(resolvedInput);
        result = await runCampaignWorkflow(tools, resolvedInput);
        break;
      }
      case "apply-ruleset-patch": {
        const rulesFile = requiredString(parsed.flags, "rules-file");
        const patchFile = requiredString(parsed.flags, "patch-file");
        const patch = await readJson(resolvePath(cwd, patchFile));
        cliInput = {
          rulesFile,
          patchFile,
          apply: hasFlag(parsed.flags, "apply"),
          includeRenderedDraft: hasFlag(parsed.flags, "include-rendered-draft"),
        };
        result = await applyRulesetPatchDraft({
          rulesFile,
          patch: patch as never,
          apply: hasFlag(parsed.flags, "apply"),
          includeRenderedDraft: hasFlag(parsed.flags, "include-rendered-draft"),
        }) as unknown as CliResult;
        break;
      }
      default:
        throw new Error(`Unknown QFerry CLI command: ${parsed.command || "<missing>"}`);
    }

    const audit = runId
      ? await writeCliAudit({
          root: env.QFERRY_CLI_TRACE_ROOT?.trim() || env.QFERRY_MCP_TRACE_ROOT?.trim() || cwd,
          runId,
          command: parsed.command,
          cliInput,
          result,
        })
      : undefined;

    stdout(`${JSON.stringify({
      ok: true,
      command: parsed.command,
      ...(runId ? { runId } : {}),
      ...(audit ? { audit } : {}),
      result,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureAudit = parsedCommand === "campaign-workflow" && runId
      ? await writeFailureAudit({
          root: env.QFERRY_CLI_TRACE_ROOT?.trim() || env.QFERRY_MCP_TRACE_ROOT?.trim() || cwd,
          runId,
          command: parsedCommand,
          cliInput,
          error: message,
        })
      : undefined;
    stderr(`${JSON.stringify({
      ok: false,
      ...(runId ? { runId } : {}),
      ...(failureAudit?.audit ? { audit: failureAudit.audit } : {}),
      ...(failureAudit?.auditError ? { auditError: failureAudit.auditError } : {}),
      error: message,
    }, null, 2)}\n`);
    return 1;
  }
}

async function writeFailureAudit(input: {
  root: string;
  runId: string;
  command: string;
  cliInput: Record<string, unknown>;
  error: string;
}): Promise<{ audit?: Awaited<ReturnType<typeof writeCliAudit>>; auditError?: string }> {
  try {
    const audit = await writeCliAudit({
      root: input.root,
      runId: input.runId,
      command: input.command,
      cliInput: input.cliInput,
      result: {
        error: input.error,
        workflow: {
          phases: ["failed"],
          recommendedNextAction: "fix_input",
          mutationsAttempted: 0,
        },
        mutationsAttempted: 0,
      },
    });
    return { audit };
  } catch (error) {
    return { auditError: error instanceof Error ? error.message : String(error) };
  }
}

function validateRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(runId)) {
    throw new Error("QFerry runId may only contain letters, numbers, dot, underscore, and dash");
  }
  return runId;
}

function validateCampaignWorkflowInput(value: CampaignWorkflowInput): CampaignWorkflowInput {
  if (!isRecord(value)) {
    throw new Error("campaign-workflow input must be a JSON object");
  }
  if (
    !Array.isArray(value.folders)
    || value.folders.length === 0
    || !value.folders.every((folder) => typeof folder === "string" && folder.trim().length > 0)
  ) {
    throw new Error("campaign-workflow folders must contain at least one folder");
  }
  validateInteger(value.pageSize, "pageSize", 1, 500);
  validateInteger(value.maxPagesPerFolder, "maxPagesPerFolder", 1, 100);
  validateOptionalInteger(value.scanOffset, "scanOffset", 0, Number.MAX_SAFE_INTEGER);
  validateOptionalInteger(value.minMessageCount, "minMessageCount", 1, 100_000);
  validateOptionalInteger(value.maxCandidatesPerFolder, "maxCandidatesPerFolder", 0, 100);
  validateOptionalInteger(value.maxDistinctSendersForDomainRule, "maxDistinctSendersForDomainRule", 1, 100);
  validateOptionalInteger(value.maxConcurrentFolders, "maxConcurrentFolders", 1, 10);
  if (value.order !== undefined && value.order !== "newest" && value.order !== "oldest") {
    throw new Error("campaign-workflow order must be newest or oldest");
  }
  if (value.rulesFile !== undefined && (typeof value.rulesFile !== "string" || value.rulesFile.trim().length === 0)) {
    throw new Error("campaign-workflow rulesFile must be a non-empty string");
  }
  if (value.applyRulesetPatch !== undefined && typeof value.applyRulesetPatch !== "boolean") {
    throw new Error("campaign-workflow applyRulesetPatch must be a boolean");
  }
  if (value.includeRenderedDraft !== undefined && typeof value.includeRenderedDraft !== "boolean") {
    throw new Error("campaign-workflow includeRenderedDraft must be a boolean");
  }
  validateRuleGroup(value.ruleGroup);
  validateWorkflowBreakdown(value.breakdownMixedDomains);
  validateWorkflowPreview(value.preview);
  return value;
}

function validateWorkflowBreakdown(breakdown: CampaignWorkflowInput["breakdownMixedDomains"]): void {
  if (breakdown === undefined) return;
  if (!isRecord(breakdown)) {
    throw new Error("campaign-workflow breakdownMixedDomains must be an object");
  }
  if (breakdown.enabled !== undefined && typeof breakdown.enabled !== "boolean") {
    throw new Error("campaign-workflow breakdownMixedDomains.enabled must be a boolean");
  }
  if (breakdown.draftSenderRules !== undefined && typeof breakdown.draftSenderRules !== "boolean") {
    throw new Error("campaign-workflow breakdownMixedDomains.draftSenderRules must be a boolean");
  }
  validateOptionalInteger(breakdown.maxDomains, "breakdownMixedDomains.maxDomains", 0, 100);
  validateOptionalInteger(breakdown.maxSenderCandidatesPerDomain, "breakdownMixedDomains.maxSenderCandidatesPerDomain", 0, 100);
  validateOptionalInteger(breakdown.minSenderMessageCount, "breakdownMixedDomains.minSenderMessageCount", 1, 100_000);
}

function validateWorkflowPreview(preview: CampaignWorkflowInput["preview"]): void {
  if (preview === undefined) return;
  if (!isRecord(preview)) {
    throw new Error("campaign-workflow preview must be an object");
  }
  if (preview.enabled !== undefined && typeof preview.enabled !== "boolean") {
    throw new Error("campaign-workflow preview.enabled must be a boolean");
  }
  if (
    preview.action !== undefined
    && preview.action !== "move"
    && preview.action !== "mark_read"
    && preview.action !== "mark_unread"
    && preview.action !== "create_folder"
  ) {
    throw new Error("campaign-workflow preview.action must be move, mark_read, mark_unread, or create_folder");
  }
  validateOptionalInteger(preview.maxMessageRefsPerGroup, "preview.maxMessageRefsPerGroup", 0, 1_000);
  validateOptionalInteger(preview.maxUnplannedHintsPerFolder, "preview.maxUnplannedHintsPerFolder", 0, 50);
  if (
    preview.selectedGroupIds !== undefined
    && (!Array.isArray(preview.selectedGroupIds)
      || !preview.selectedGroupIds.every((groupId) => typeof groupId === "string" && groupId.trim().length > 0))
  ) {
    throw new Error("campaign-workflow preview.selectedGroupIds must be a string array");
  }
}

function validateRuleGroup(ruleGroup: CampaignWorkflowInput["ruleGroup"]): void {
  if (ruleGroup === undefined) return;
  if (!isRecord(ruleGroup)) {
    throw new Error("campaign-workflow ruleGroup must be an object");
  }
  if (typeof ruleGroup.id !== "string" || ruleGroup.id.trim().length === 0) {
    throw new Error("campaign-workflow ruleGroup.id must be a non-empty string");
  }
  if (typeof ruleGroup.label !== "string" || ruleGroup.label.trim().length === 0) {
    throw new Error("campaign-workflow ruleGroup.label must be a non-empty string");
  }
  if (ruleGroup.target !== undefined) {
    if (!isRecord(ruleGroup.target) || typeof ruleGroup.target.folder !== "string" || ruleGroup.target.folder.trim().length === 0) {
      throw new Error("campaign-workflow ruleGroup.target.folder must be a non-empty string");
    }
  }
}

function validateInteger(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`campaign-workflow ${name} must be an integer from ${min} to ${max}`);
  }
}

function validateOptionalInteger(value: unknown, name: string, min: number, max: number): void {
  if (value === undefined) return;
  validateInteger(value, name, min, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(args: string[]): ParsedArgs {
  if (args[0] === "--") {
    return parseArgs(args.slice(1));
  }
  const [command = "help", ...rest] = args;
  const flags: ParsedArgs["flags"] = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const rawName = token.slice(2);
    const equalsIndex = rawName.indexOf("=");
    const name = equalsIndex >= 0 ? rawName.slice(0, equalsIndex) : rawName;
    const inlineValue = equalsIndex >= 0 ? rawName.slice(equalsIndex + 1) : undefined;
    const next = rest[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? rest[++index] : true);
    appendFlag(flags, name, value);
  }
  return { command, flags };
}

async function runCampaignWorkflow(
  tools: MailTools,
  input: CampaignWorkflowInput & { runId: string },
): Promise<CliResult> {
  const previewEnabled = input.preview?.enabled !== false;
  if (input.applyRulesetPatch && !input.rulesFile) {
    throw new Error("campaign-workflow applyRulesetPatch requires rulesFile");
  }
  if (previewEnabled && !input.rulesFile) {
    throw new Error("campaign-workflow preview requires rulesFile");
  }

  const discovery = await tools.planMailboxGovernanceCampaign({
    folders: input.folders,
    pageSize: input.pageSize,
    maxPagesPerFolder: input.maxPagesPerFolder,
    ...(input.order ? { order: input.order } : {}),
    ...(input.scanOffset !== undefined ? { scanOffset: input.scanOffset } : {}),
    ...(input.minMessageCount !== undefined ? { minMessageCount: input.minMessageCount } : {}),
    ...(input.maxCandidatesPerFolder !== undefined ? { maxCandidatesPerFolder: input.maxCandidatesPerFolder } : {}),
    ...(input.maxDistinctSendersForDomainRule !== undefined
      ? { maxDistinctSendersForDomainRule: input.maxDistinctSendersForDomainRule }
      : {}),
    ...(input.maxConcurrentFolders !== undefined ? { maxConcurrentFolders: input.maxConcurrentFolders } : {}),
    ...(input.scopeDraftRulesToSourceFolder !== undefined
      ? { scopeDraftRulesToSourceFolder: input.scopeDraftRulesToSourceFolder }
      : {}),
    ...(input.ruleGroup ? { ruleGroup: input.ruleGroup } : {}),
    ...(input.rules ? { rules: input.rules } : {}),
    ...(input.rulesFile ? { rulesFile: input.rulesFile } : {}),
  });

  const mixedDomainBreakdownEnabled = input.breakdownMixedDomains?.enabled === true;
  const mixedDomainNextSteps = buildMixedDomainNextSteps(discovery, input);
  const mixedDomainBreakdown = mixedDomainBreakdownEnabled
    ? await runMixedDomainBreakdowns(tools, discovery, input)
    : undefined;
  const workflowPatchDraft = mergeRulesetPatches(
    discovery.rulesetPatch,
    mixedDomainBreakdown?.rulesetPatch,
  );

  const rulesetPatch = input.rulesFile
    ? await applyRulesetPatchDraft({
        rulesFile: input.rulesFile,
        patch: workflowPatchDraft,
        apply: input.applyRulesetPatch === true,
        includeRenderedDraft: input.includeRenderedDraft === true,
      })
    : {
        applied: false,
        rulesFile: "<none>",
        beforeRuleCount: 0,
        afterRuleCount: 0,
        addedRuleCount: workflowPatchDraft.rulesToAdd.length,
        replacedRuleCount: workflowPatchDraft.rulesToReplace?.length ?? 0,
        skippedDuplicateRuleCount: workflowPatchDraft.skippedDuplicateRules.length,
        changelog: workflowPatchDraft.changelog ?? "",
      };
  const previewRuleset = previewEnabled
    ? await buildWorkflowPreviewRuleset(input, workflowPatchDraft)
    : undefined;

  const preview = previewEnabled
    ? compactRulesetGovernanceCampaignPreview(await tools.rulesetGovernanceCampaignPreview({
        runId: `${input.runId}-preview`,
        folders: input.folders,
        pageSize: input.pageSize,
        maxPagesPerFolder: input.maxPagesPerFolder,
        maxMessageRefsPerGroup: input.preview?.maxMessageRefsPerGroup ?? 100,
        action: input.preview?.action ?? "move",
        ...(previewRuleset
          ? {
              rules: previewRuleset.rules,
              groups: previewRuleset.groups,
              defaultGroupId: previewRuleset.defaultGroupId,
            }
          : input.rulesFile ? { rulesFile: input.rulesFile } : {}),
        ...(input.preview?.selectedGroupIds ? { selectedGroupIds: input.preview.selectedGroupIds } : {}),
        ...(input.scanOffset !== undefined ? { scanOffset: input.scanOffset } : {}),
        ...(input.order ? { order: input.order } : {}),
        ...(input.maxConcurrentFolders !== undefined ? { maxConcurrentFolders: input.maxConcurrentFolders } : {}),
        ...(input.preview?.maxUnplannedHintsPerFolder !== undefined
          ? { maxUnplannedHintsPerFolder: input.preview.maxUnplannedHintsPerFolder }
          : {}),
      }))
    : undefined;

  return {
    workflow: {
      phases: [
        "discovery",
        ...(mixedDomainBreakdownEnabled ? ["mixed_domain_breakdown"] : []),
        "ruleset_patch",
        ...(previewEnabled ? ["preview"] : []),
      ],
      discovery,
      rulesetPatch,
      ...(mixedDomainBreakdown ? {
        mixedDomainBreakdowns: mixedDomainBreakdown.reports,
        mixedDomainRulesetPatch: mixedDomainBreakdown.rulesetPatch,
      } : {}),
      mixedDomainNextSteps,
      ...(preview ? { preview } : {}),
      recommendedNextAction: workflowNextAction(preview, rulesetPatch, mixedDomainNextSteps),
      mutationsAttempted: 0,
    },
    mutationsAttempted: 0,
  };
}

function buildMixedDomainNextSteps(
  discovery: Awaited<ReturnType<MailTools["planMailboxGovernanceCampaign"]>>,
  input: CampaignWorkflowInput,
): MixedDomainNextStep[] {
  return discovery.campaign.folderPlans.flatMap((plan) =>
    plan.candidates
      .filter((candidate) => candidate.recommendedAction === "break_down_sender")
      .map((candidate) => {
        const args = senderBreakdownArgs({
          folder: plan.folder,
          domain: candidate.domain,
          pageSize: input.pageSize,
          maxPages: input.maxPagesPerFolder,
          scanOffset: input.scanOffset,
          order: input.order,
          ruleGroup: input.ruleGroup,
        });
        return {
          folder: plan.folder,
          domain: candidate.domain,
          messageCount: candidate.messageCount,
          uniqueSenderCount: candidate.uniqueSenderCount,
          args,
          command: `qferry ${args.map(quoteCommandValue).join(" ")}`,
        };
      })
  );
}

async function runMixedDomainBreakdowns(
  tools: MailTools,
  discovery: Awaited<ReturnType<MailTools["planMailboxGovernanceCampaign"]>>,
  input: CampaignWorkflowInput,
): Promise<{ reports: MixedDomainBreakdownReport[]; rulesetPatch: RulesetPatchDraft }> {
  const ruleGroup = input.ruleGroup ?? { id: "sender_governance", label: "Sender governance" };
  const draftSenderRules = input.breakdownMixedDomains?.draftSenderRules === true;
  const maxDomains = input.breakdownMixedDomains?.maxDomains ?? 5;
  const maxSenderCandidatesPerDomain = input.breakdownMixedDomains?.maxSenderCandidatesPerDomain ?? DEFAULT_PAGE_SIZE;
  const minSenderMessageCount = input.breakdownMixedDomains?.minSenderMessageCount ?? 1;
  const targets = buildMixedDomainNextSteps(discovery, input).slice(0, maxDomains);
  const existingRules = await loadWorkflowExistingRules(input);
  let accumulatedRules: ClassificationRule[] = [
    ...existingRules,
    ...discovery.rulesetPatch.rulesToAdd,
    ...(discovery.rulesetPatch.rulesToReplace ?? []),
  ];
  const reports: MixedDomainBreakdownReport[] = [];
  const patches: RulesetPatchDraft[] = [];

  for (const target of targets) {
    const breakdown = await tools.senderBreakdown({
      folder: target.folder,
      pageSize: input.pageSize,
      maxPages: input.maxPagesPerFolder,
      fromDomainIncludes: target.domain,
      maxSenderCandidates: maxSenderCandidatesPerDomain,
      ...(input.scanOffset !== undefined ? { scanOffset: input.scanOffset } : {}),
      ...(input.order ? { order: input.order } : {}),
      ruleGroup,
    });
    const selectedCandidates = breakdown.breakdown.senderCandidates
      .filter((candidate) => candidate.messageCount >= minSenderMessageCount);
    const patch = draftSenderRules
      ? buildWorkflowRulesetPatch({
          candidateRules: selectedCandidates.map((candidate) => candidate.suggestedRule),
          existingRules: accumulatedRules,
          ruleGroup,
          ruleset: discovery.rulesetPatch.ruleset,
          ...(input.scopeDraftRulesToSourceFolder === false ? {} : { scopeFolder: target.folder }),
        })
      : emptyWorkflowRulesetPatch(ruleGroup, discovery.rulesetPatch.ruleset);
    accumulatedRules = [
      ...accumulatedRules,
      ...patch.rulesToAdd,
      ...(patch.rulesToReplace ?? []),
    ];
    patches.push(patch);
    reports.push({
      folder: target.folder,
      domain: target.domain,
      matchedMessages: breakdown.breakdown.matchedMessages,
      returnedSenderCandidates: breakdown.breakdown.candidateSummary.returnedSenderCandidates,
      candidateSenderRules: selectedCandidates.length,
      selectedSenderRules: patch.rulesToAdd.length,
      skippedSenderRules: patch.skippedDuplicateRules.length,
      draftSenderRules,
    });
  }

  return {
    reports,
    rulesetPatch: mergeRulesetPatches(emptyWorkflowRulesetPatch(ruleGroup, discovery.rulesetPatch.ruleset), ...patches),
  };
}

async function loadWorkflowExistingRules(input: CampaignWorkflowInput): Promise<ClassificationRule[]> {
  if (input.rulesFile) {
    return (await loadPatchableRuleset(input.rulesFile)).rules;
  }
  return input.rules ?? [];
}

async function buildWorkflowPreviewRuleset(
  input: CampaignWorkflowInput,
  workflowPatchDraft: RulesetPatchDraft,
): Promise<ClassificationRulesetJsonDraft | undefined> {
  if (!input.rulesFile || input.applyRulesetPatch === true || !hasRulesetPatchChanges(workflowPatchDraft)) {
    return undefined;
  }
  const existing = await loadPatchableRuleset(input.rulesFile);
  return renderRulesetPatchDraft(workflowPatchDraft, existing);
}

function emptyWorkflowRulesetPatch(
  ruleGroup: ClassificationGroup,
  ruleset: RulesetPatchDraft["ruleset"],
): RulesetPatchDraft {
  return {
    groupToEnsure: ruleGroup,
    candidateRuleCount: 0,
    rulesToAdd: [],
    skippedDuplicateRules: [],
    ruleset,
  };
}

function hasRulesetPatchChanges(patch: RulesetPatchDraft): boolean {
  return patch.rulesToAdd.length > 0 || (patch.rulesToReplace?.length ?? 0) > 0;
}

function mergeRulesetPatches(...patches: Array<RulesetPatchDraft | undefined>): RulesetPatchDraft {
  const definedPatches = patches.filter((patch): patch is RulesetPatchDraft => patch !== undefined);
  const [firstPatch] = definedPatches;
  if (!firstPatch) {
    throw new Error("QFerry cannot merge an empty ruleset patch list");
  }
  const merged: RulesetPatchDraft = {
    groupToEnsure: firstPatch.groupToEnsure,
    candidateRuleCount: definedPatches.reduce((sum, patch) => sum + patch.candidateRuleCount, 0),
    rulesToReplace: definedPatches.flatMap((patch) => patch.rulesToReplace ?? []),
    rulesToAdd: definedPatches.flatMap((patch) => patch.rulesToAdd),
    skippedDuplicateRules: definedPatches.flatMap((patch) => patch.skippedDuplicateRules),
    ruleset: definedPatches.find((patch) => patch.ruleset)?.ruleset,
  };
  return {
    ...merged,
    changelog: formatWorkflowRulesetPatchChangelog(merged),
  };
}

function buildWorkflowRulesetPatch(input: {
  candidateRules: ClassificationRule[];
  existingRules: ClassificationRule[];
  ruleGroup: ClassificationGroup;
  ruleset?: RulesetPatchDraft["ruleset"];
  scopeFolder?: string;
}): RulesetPatchDraft {
  const selectedRules = input.candidateRules
    .map((rule) => input.scopeFolder ? scopeWorkflowRuleToSourceFolder(rule, input.scopeFolder) : rule);
  const rulesToAdd: ClassificationRule[] = [];
  const skippedDuplicateRules: RulesetPatchDraft["skippedDuplicateRules"] = [];

  for (const rule of selectedRules) {
    const duplicate = input.existingRules.find((existingRule) => workflowRuleCoversCandidate(existingRule, rule));
    if (duplicate) {
      skippedDuplicateRules.push({
        ruleId: duplicate.id,
        reason: "match already covered by existing rule",
        match: duplicate.match,
      });
    } else if (!rulesToAdd.some((existingRule) => workflowRuleCoversCandidate(existingRule, rule))) {
      rulesToAdd.push(rule);
    }
  }

  return {
    groupToEnsure: input.ruleGroup,
    candidateRuleCount: selectedRules.length,
    rulesToAdd,
    skippedDuplicateRules,
    ruleset: input.ruleset,
    changelog: "",
  };
}

function scopeWorkflowRuleToSourceFolder(rule: ClassificationRule, folder: string): ClassificationRule {
  return {
    ...rule,
    id: `${rule.id}-in-${scopedWorkflowRuleIdSuffix(folder)}`,
    match: {
      ...rule.match,
      folderEquals: folder,
    },
  };
}

function workflowRuleCoversCandidate(existing: ClassificationRule, candidate: ClassificationRule): boolean {
  return existing.groupId === candidate.groupId && workflowRuleMatchCovers(existing.match, candidate.match);
}

function workflowRuleMatchCovers(
  existing: ClassificationRule["match"],
  candidate: ClassificationRule["match"],
): boolean {
  return workflowMatchFieldCovers(existing.fromIncludes, candidate.fromIncludes)
    && workflowMatchFieldCovers(existing.fromDomainIncludes, candidate.fromDomainIncludes)
    && workflowMatchFieldCovers(existing.subjectIncludes, candidate.subjectIncludes)
    && workflowMatchFieldCovers(existing.snippetIncludes, candidate.snippetIncludes)
    && workflowMatchFieldCovers(existing.folderEquals, candidate.folderEquals)
    && workflowMatchFieldCovers(existing.hasFlag, candidate.hasFlag);
}

function workflowMatchFieldCovers(existing: string | undefined, candidate: string | undefined): boolean {
  return existing === undefined || normalizeWorkflowOptional(existing) === normalizeWorkflowOptional(candidate);
}

function normalizeWorkflowOptional(value: string | undefined): string | undefined {
  return value?.toLocaleLowerCase();
}

function slugifyWorkflowRuleId(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function scopedWorkflowRuleIdSuffix(value: string): string {
  const slug = slugifyWorkflowRuleId(value);
  const readableSlug = slug === "unknown" ? "folder" : slug;
  return `${readableSlug}-${stableWorkflowHexHash(value)}`;
}

function stableWorkflowHexHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatWorkflowRulesetPatchChangelog(patch: RulesetPatchDraft): string {
  const replacementRules = patch.rulesToReplace ?? [];
  return [
    `groupToEnsure: ${patch.groupToEnsure.id}`,
    `candidateRuleCount: ${patch.candidateRuleCount}`,
    ...(replacementRules.length > 0 ? [`rulesToReplace: ${replacementRules.length}`] : []),
    `rulesToAdd: ${patch.rulesToAdd.length}`,
    ...patch.rulesToAdd.map((rule) => `+ rule ${rule.id} (${formatWorkflowRuleMatch(rule.match)})`),
    `skippedDuplicateRules: ${patch.skippedDuplicateRules.length}`,
    ...patch.skippedDuplicateRules.map((duplicate) =>
      `skipped ${duplicate.ruleId}: ${duplicate.reason} (${formatWorkflowRuleMatch(duplicate.match)})`),
  ].join("\n");
}

function formatWorkflowRuleMatch(match: ClassificationRule["match"]): string {
  return Object.entries(match)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

function senderBreakdownArgs(input: {
  folder: string;
  domain: string;
  pageSize: number;
  maxPages: number;
  scanOffset?: number;
  order?: "newest" | "oldest";
  ruleGroup?: ClassificationGroup;
}): string[] {
  return [
    "sender-breakdown",
    "--folder",
    input.folder,
    "--from-domain-includes",
    input.domain,
    "--page-size",
    String(input.pageSize),
    "--max-pages",
    String(input.maxPages),
    ...(input.scanOffset !== undefined ? ["--scan-offset", String(input.scanOffset)] : []),
    ...(input.order ? ["--order", input.order] : []),
    ...(input.ruleGroup ? [
      "--group-id",
      input.ruleGroup.id,
      "--group-label",
      input.ruleGroup.label,
      ...(input.ruleGroup.target ? ["--target-folder", input.ruleGroup.target.folder] : []),
    ] : []),
  ];
}

function quoteCommandValue(value: string): string {
  return JSON.stringify(value);
}

function compactCampaignWorkflowInput(input: CampaignWorkflowInput & { runId: string }): Record<string, unknown> {
  return {
    runId: input.runId,
    folders: input.folders,
    pageSize: input.pageSize,
    maxPagesPerFolder: input.maxPagesPerFolder,
    action: input.preview?.action,
    scanOffset: input.scanOffset,
    maxMessageRefsPerGroup: input.preview?.maxMessageRefsPerGroup,
    selectedGroupIds: input.preview?.selectedGroupIds,
    rulesFile: input.rulesFile,
    applyRulesetPatch: input.applyRulesetPatch === true,
    breakdownMixedDomains: input.breakdownMixedDomains,
    previewEnabled: input.preview?.enabled !== false,
  };
}

function workflowNextAction(
  preview: RulesetCampaignPreviewCompact | undefined,
  rulesetPatch: { addedRuleCount?: number; replacedRuleCount?: number },
  mixedDomainNextSteps: MixedDomainNextStep[],
): string {
  if (preview?.campaign.recommendedNextAction === "confirm_plans") return "review_preview_plans";
  if (preview?.campaign.recommendedNextAction === "review_rules") return "improve_ruleset";
  if ((rulesetPatch.addedRuleCount ?? 0) > 0 || (rulesetPatch.replacedRuleCount ?? 0) > 0) return "review_or_apply_ruleset_patch";
  if (mixedDomainNextSteps.length > 0) return "break_down_mixed_domains";
  return "stop_low_yield";
}

function appendFlag(flags: ParsedArgs["flags"], name: string, value: string | boolean): void {
  const existing = flags[name];
  if (existing === undefined) {
    flags[name] = value;
  } else if (Array.isArray(existing)) {
    existing.push(String(value));
  } else {
    flags[name] = [String(existing), String(value)];
  }
}

function highYieldInput(flags: ParsedArgs["flags"]): HighYieldGovernanceInput {
  const ruleGroup = optionalRuleGroup(flags);
  return {
    folder: requiredString(flags, "folder"),
    pageSize: optionalInteger(flags, "page-size") ?? DEFAULT_PAGE_SIZE,
    maxPages: optionalInteger(flags, "max-pages") ?? DEFAULT_MAX_PAGES,
    ...(optionalInteger(flags, "scan-offset") !== undefined ? { scanOffset: optionalInteger(flags, "scan-offset") } : {}),
    ...(optionalString(flags, "order") ? { order: orderFlag(flags) } : {}),
    ...(optionalInteger(flags, "min-message-count") !== undefined ? { minMessageCount: optionalInteger(flags, "min-message-count") } : {}),
    ...(optionalInteger(flags, "max-candidates") !== undefined ? { maxCandidates: optionalInteger(flags, "max-candidates") } : {}),
    ...(optionalInteger(flags, "max-distinct-senders-for-domain-rule") !== undefined
      ? { maxDistinctSendersForDomainRule: optionalInteger(flags, "max-distinct-senders-for-domain-rule") }
      : {}),
    ...(ruleGroup ? { ruleGroup } : {}),
    ...(optionalString(flags, "rules-file") ? { rulesFile: optionalString(flags, "rules-file") } : {}),
  };
}

function senderBreakdownInput(flags: ParsedArgs["flags"]): SenderBreakdownInput {
  const ruleGroup = optionalRuleGroup(flags);
  return {
    folder: requiredString(flags, "folder"),
    pageSize: optionalInteger(flags, "page-size") ?? DEFAULT_PAGE_SIZE,
    maxPages: optionalInteger(flags, "max-pages") ?? DEFAULT_MAX_PAGES,
    ...(optionalInteger(flags, "scan-offset") !== undefined ? { scanOffset: optionalInteger(flags, "scan-offset") } : {}),
    ...(optionalString(flags, "order") ? { order: orderFlag(flags) } : {}),
    ...(optionalString(flags, "from-domain-includes") ? { fromDomainIncludes: optionalString(flags, "from-domain-includes") } : {}),
    ...(optionalString(flags, "from-includes") ? { fromIncludes: optionalString(flags, "from-includes") } : {}),
    ...(optionalInteger(flags, "max-sender-candidates") !== undefined
      ? { maxSenderCandidates: optionalInteger(flags, "max-sender-candidates") }
      : {}),
    ...(ruleGroup ? { ruleGroup } : {}),
  };
}

function optionalRuleGroup(flags: ParsedArgs["flags"]): ClassificationGroup | undefined {
  const id = optionalString(flags, "group-id");
  const label = optionalString(flags, "group-label");
  const targetFolder = optionalString(flags, "target-folder");
  if (!id && !label && !targetFolder) return undefined;
  if (!id || !label) {
    throw new Error("--group-id and --group-label must be passed together");
  }
  return {
    id,
    label,
    ...(targetFolder ? { target: { folder: targetFolder } } : {}),
  };
}

async function jsonInput<T>(cwd: string, flags: ParsedArgs["flags"]): Promise<T> {
  const inputPath = requiredString(flags, "input");
  return await readJson(resolvePath(cwd, inputPath)) as T;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return JSON.parse(stripUtf8Bom(text)) as unknown;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function compactRulesetGovernancePreview<T extends { classifications?: unknown[] }>(
  result: T,
  includeClassifications: boolean,
): T | Omit<T, "classifications"> {
  if (includeClassifications) return result;
  const { classifications: _classifications, ...compact } = result;
  return compact;
}

function compactRulesetGovernanceCampaignPreview<T extends { plans?: unknown[] }>(
  result: T,
): Omit<T, "plans"> {
  const { plans: _plans, ...compact } = result;
  return compact;
}

function requiredString(flags: ParsedArgs["flags"], name: string): string {
  const value = optionalString(flags, name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function optionalString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  if (value === undefined || value === false) return undefined;
  if (Array.isArray(value)) return value[value.length - 1];
  if (value === true) return "true";
  return value;
}

function optionalInteger(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = optionalString(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Flag --${name} must be an integer`);
  }
  return parsed;
}

function orderFlag(flags: ParsedArgs["flags"]): "newest" | "oldest" {
  const value = requiredString(flags, "order");
  if (value !== "newest" && value !== "oldest") {
    throw new Error("--order must be newest or oldest");
  }
  return value;
}

function hasFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

function usage(): string {
  return [
    "QFerry CLI",
    "",
    "Usage:",
    "  qferry status",
    "  qferry list-mailboxes",
    "  qferry mailbox-summary --folder INBOX",
    "  qferry high-yield --folder INBOX --page-size 50 --max-pages 2 --group-id ads --group-label Ads --target-folder Ads",
    "  qferry sender-breakdown --folder INBOX --from-domain-includes qq.com --page-size 50 --max-pages 2",
    "  qferry mailbox-campaign --input campaign.json",
    "  qferry ruleset-preview --input preview.json",
    "  qferry ruleset-campaign-preview --input campaign-preview.json",
    "  qferry campaign-workflow --input workflow.json",
    "  qferry apply-ruleset-patch --rules-file qferry.rules.json --patch-file patch.json [--apply]",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
