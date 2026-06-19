import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createMailTools,
  applyRulesetPatchDraft,
  confirmOperationPlan,
  createMailProviderFromRuntimeConfig,
  JsonlTraceWriter,
  loadQFerryRuntimeConfigSync,
  type MailProvider,
  type MessageRef,
  type OperationPlan,
  type QFerryRuntimeConfig,
} from "@qferry/core";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const messageRefSchema = z.object({
  provider: z.enum(["fixture", "qqmail", "gmail"]),
  accountAlias: z.string(),
  folder: z.string(),
  uid: z.string(),
  uidValidity: z.string().optional(),
}).superRefine((ref, context) => {
  if (ref.provider === "qqmail" && !ref.uidValidity) {
    context.addIssue({
      code: "custom",
      path: ["uidValidity"],
      message: "uidValidity is required for qqmail message refs",
    });
  }
});

const classificationRuleSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  match: z.object({
    fromIncludes: z.string().optional(),
    fromDomainIncludes: z.string().optional(),
    subjectIncludes: z.string().optional(),
    snippetIncludes: z.string().optional(),
    folderEquals: z.string().optional(),
    hasFlag: z.string().optional(),
  }),
  priority: z.object({
    bucketId: z.enum(["urgent", "needs_review", "waiting", "fyi", "bulk"]),
    reason: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    weight: z.number().min(0).max(100).optional(),
    nextAction: z.string(),
  }).optional(),
});

const classificationGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  target: z.object({
    folder: z.string(),
  }).optional(),
});

const rulesetPatchSchema = z.object({
  groupToEnsure: classificationGroupSchema,
  candidateRuleCount: z.number().int().min(0),
  rulesToReplace: z.array(classificationRuleSchema).optional(),
  rulesToAdd: z.array(classificationRuleSchema),
  skippedDuplicateRules: z.array(z.object({
    ruleId: z.string(),
    reason: z.literal("match already covered by existing rule"),
    match: classificationRuleSchema.shape.match,
  })),
});

const bulkGovernanceCategorySchema = z.enum([
  "high_confidence_marketing",
  "newsletter_or_digest",
  "security_or_account",
  "receipt_or_purchase",
  "github_ci",
  "github_pr_notification",
  "github_code_review",
  "github_account_security",
  "developer_community",
  "review",
]);

const PLAN_TTL_MS = 15 * 60 * 1000;

interface StoredPlan {
  plan: OperationPlan;
  expiresAt: number;
  previewSummary?: Record<string, unknown>;
}

interface OperationPlanStore {
  get(operationPlanId: string): Promise<StoredPlan | undefined>;
  set(operationPlanId: string, storedPlan: StoredPlan): Promise<void>;
  delete(operationPlanId: string): Promise<void>;
  isConsumed(operationPlanId: string): Promise<boolean>;
  markConsumed(operationPlanId: string): Promise<void>;
}

export interface CreateQFerryMcpServerOptions {
  provider?: MailProvider;
  operationPlanStore?: OperationPlanStore;
  runtimeConfig?: QFerryRuntimeConfig;
}

const DEFAULT_MOVE_EXECUTION_MAX_MESSAGES = 5;
const MAX_MOVE_EXECUTION_MAX_MESSAGES = 50;
const LEGACY_DISCOVERY_WORKFLOW_WARNING = {
  code: "legacy_discovery_helper",
  message: "For repeatable batch governance, prefer a user ruleset and ruleset_governance_preview.",
} as const;

interface McpAuditInfo {
  runId: string;
  tracePath: string;
  summaryPath: string;
}

type McpToolErrorKind =
  | "QFERRY_HANDLER_ERROR"
  | "IMAP_PROVIDER_ERROR";

export function createQFerryMcpServer(options: CreateQFerryMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "qferry-chatgpt-app",
    version: "0.0.0",
  });
  const runtimeConfig = options.runtimeConfig ?? loadQFerryRuntimeConfigSync();
  const provider = options.provider ?? createMailProviderFromRuntimeConfig(runtimeConfig);
  const tools = createMailTools({ provider, runtimeConfig });
  const planStore = options.operationPlanStore ?? createFileOperationPlanStore();
  let mutationExecutionQueue: Promise<void> = Promise.resolve();
  const enqueueMutationExecution = async <T>(run: () => Promise<T>): Promise<T> => {
    const previous = mutationExecutionQueue;
    let release!: () => void;
    mutationExecutionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      return await run();
    } finally {
      release();
    }
  };

  server.registerTool(
    "get_status",
    {
      title: "Get QFerry status",
      description: "Use this first to confirm active provider, config source, account alias, read-only limits, and safety warnings.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toToolResult(await tools.getStatus()),
  );

  server.registerTool(
    "list_mailboxes",
    {
      title: "List mailboxes",
      description: "Use this when you need to discover available QQ Mail folders before searching.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toToolResult(await tools.listMailboxes()),
  );

  server.registerTool(
    "get_mailbox_summary",
    {
      title: "Get mailbox summary",
      description: "Use this to get read-only mailbox counts before scanning or grouping candidates.",
      inputSchema: { folder: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.getMailboxSummary(input)),
  );

  server.registerTool(
    "get_capability_snapshot",
    {
      title: "Get capability snapshot",
      description: "Use this when you need provider capabilities and safety limits before scanning or planning.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toToolResult(await tools.getCapabilitySnapshot()),
  );

  server.registerTool(
    "search",
    {
      title: "Search mail",
      description: "Use this when you need bounded mailbox metadata search without reading full message bodies.",
      inputSchema: {
        folder: z.string(),
        limit: z.number().int().min(1).max(20),
        query: z.string().optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        offset: z.number().int().min(0).optional(),
        fromIncludes: z.string().optional(),
        fromDomainIncludes: z.string().optional(),
        subjectIncludes: z.string().optional(),
        snippetIncludes: z.string().optional(),
        hasFlag: z.string().optional(),
        dateAfter: z.string().optional(),
        dateBefore: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.search(input)),
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch message",
      description: "Use this when you need one specific message by its provider reference.",
      inputSchema: messageRefSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.fetch(input as MessageRef)),
  );

  server.registerTool(
    "classify_messages",
    {
      title: "Classify messages",
      description: "Use this when you need to apply local QFerry classification groups to bounded metadata.",
      inputSchema: {
        folder: z.string(),
        limit: z.number().int().min(1).max(20),
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.classifyMessages(input)),
  );

  server.registerTool(
    "triage_inbox",
    {
      title: "Triage inbox",
      description: "Use this as the default Gmail-like read-only inbox review: classify bounded metadata, summarize groups, and recommend preview-only next steps.",
      inputSchema: {
        folder: z.string(),
        limit: z.number().int().min(1).max(20),
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.triageInbox(input)),
  );

  server.registerTool(
    "group_spam_candidates",
    {
      title: "Group spam candidates",
      description: "Use this to scan oldest bounded metadata and group obvious spam or ads for user confirmation before any real operation.",
      inputSchema: {
        folder: z.string(),
        limit: z.number().int().min(1).max(20),
        offset: z.number().int().min(0).optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.groupSpamCandidates(input)),
  );

  server.registerTool(
    "plan_cleanup",
    {
      title: "Plan cleanup",
      description: "Use this when you need a preview-only cleanup/archive plan that requires later confirmation.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        limit: z.number().int().min(1).max(20),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        messageRefs: z.array(messageRefSchema).optional(),
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
        selectedGroupIds: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      return instrumentMcpTool("plan_cleanup", input, async () => {
        const result = await registerPlan(await tools.planCleanup(input), planStore);
        const response = compactOperationPlanResult(result);
        return toToolResult(await withMcpAudit("plan_cleanup", input.runId, input, response, result));
      });
    },
  );

  server.registerTool(
    "ensure_classification_folder",
    {
      title: "Ensure classification folder",
      description: "Use this to preview creating a QQ classification folder from a short display name. Existing folders return no plan; missing folders require confirmation before creation.",
      inputSchema: {
        runId: z.string(),
        displayName: z.string(),
        parentPath: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await tools.ensureClassificationFolder(input);
      const registered = result.plan ? await registerPlan({ ...result, plan: result.plan }, planStore) : result;
      const response = compactOperationPlanResult(registered);
      return toToolResult(await withMcpAudit("ensure_classification_folder", input.runId, input, response, registered));
    },
  );

  server.registerTool(
    "preview_cleanup_batch",
    {
      title: "Preview cleanup batch",
      description: "Use this when you need a cross-page rules preview and bounded cleanup plan before any real mailbox mutation.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(200),
        maxMessageRefs: z.number().int().min(1).max(500),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
        defaultGroupId: z.string().optional(),
        selectedGroupIds: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerPlan(await tools.previewCleanupBatch(input), planStore);
      const response = compactOperationPlanResult(result);
      return toToolResult(await withMcpAudit("preview_cleanup_batch", input.runId, input, response, result));
    },
  );

  server.registerTool(
    "plan_sender_governance",
    {
      title: "Plan sender governance",
      description: "Use this when you need bounded sender/domain governance candidates, local rule suggestions, and a preview-only cleanup plan while recording that server-side QQ blocklist is not exposed.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(200),
        maxMessageRefs: z.number().int().min(0).max(500),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        selectedSenderDomains: z.array(z.string()).optional(),
        selectedFromIncludes: z.array(z.string()).optional(),
        maxDomainCandidates: z.number().int().min(0).max(100).optional(),
        ruleGroup: classificationGroupSchema.optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerPlan(await tools.planSenderGovernance(input), planStore);
      const response = compactOperationPlanResult(result);
      return toToolResult(await withMcpAudit("plan_sender_governance", input.runId, input, response, result));
    },
  );

  server.registerTool(
    "plan_high_yield_governance",
    {
      title: "Plan high-yield governance",
      description: "Use this before mailbox cleanup to rank high-yield sender/domain candidates, draft only low-risk local rules, and stop low-value micro-operations.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        minMessageCount: z.number().int().min(1).max(500).optional(),
        maxCandidates: z.number().int().min(0).max(100).optional(),
        maxDistinctSendersForDomainRule: z.number().int().min(1).max(100).optional(),
        ruleGroup: classificationGroupSchema.optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await withMcpAudit("plan_high_yield_governance", input.runId, input, await tools.planHighYieldGovernance(input))),
  );

  server.registerTool(
    "plan_mailbox_governance_campaign",
    {
      title: "Plan mailbox governance campaign",
      description: "Use this to rank multiple folders by high-yield cleanup opportunity before spending agent time on mailbox governance.",
      inputSchema: {
        runId: z.string(),
        folders: z.array(z.string()).min(1).max(50),
        pageSize: z.number().int().min(1).max(50),
        maxPagesPerFolder: z.number().int().min(1).max(100),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        minMessageCount: z.number().int().min(1).max(500).optional(),
        maxCandidatesPerFolder: z.number().int().min(0).max(100).optional(),
        maxDistinctSendersForDomainRule: z.number().int().min(1).max(100).optional(),
        maxConcurrentFolders: z.number().int().min(1).max(10).optional(),
        scopeDraftRulesToSourceFolder: z.boolean().optional(),
        ruleGroup: classificationGroupSchema.optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await withMcpAudit("plan_mailbox_governance_campaign", input.runId, input, await tools.planMailboxGovernanceCampaign(input))),
  );

  server.registerTool(
    "campaign_workflow",
    {
      title: "Campaign workflow",
      description: "Use this as the high-level GPT workflow for repeatable mailbox governance: discover high-yield candidates, optionally break down mixed domains, draft or apply a local ruleset patch, and preview user-defined group moves in one audited call. It never mutates the mailbox.",
      inputSchema: {
        runId: z.string(),
        folders: z.array(z.string()).min(1).max(50),
        pageSize: z.number().int().min(1).max(50),
        maxPagesPerFolder: z.number().int().min(1).max(100),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        minMessageCount: z.number().int().min(1).max(500).optional(),
        maxCandidatesPerFolder: z.number().int().min(0).max(100).optional(),
        maxDistinctSendersForDomainRule: z.number().int().min(1).max(100).optional(),
        maxConcurrentFolders: z.number().int().min(1).max(10).optional(),
        scopeDraftRulesToSourceFolder: z.boolean().optional(),
        ruleGroup: classificationGroupSchema.optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
        applyRulesetPatch: z.boolean().default(false),
        includeRenderedDraft: z.boolean().default(false),
        breakdownMixedDomains: z.object({
          enabled: z.boolean().optional(),
          draftSenderRules: z.boolean().optional(),
          maxDomains: z.number().int().min(0).max(100).optional(),
          maxSenderCandidatesPerDomain: z.number().int().min(0).max(100).optional(),
          minSenderMessageCount: z.number().int().min(1).max(100_000).optional(),
        }).optional(),
        preview: z.object({
          enabled: z.boolean().optional(),
          action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]).optional(),
          maxMessageRefsPerGroup: z.number().int().min(0).max(1_000).optional(),
          selectedGroupIds: z.array(z.string()).optional(),
          maxUnplannedHintsPerFolder: z.number().int().min(0).max(50).optional(),
        }).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerOperationPlans(await tools.campaignWorkflow(input), planStore);
      const response = compactRulesetGovernanceCampaignPreview(result);
      return toToolResult(await withMcpAudit("campaign_workflow", input.runId, input, response));
    },
  );

  server.registerTool(
    "sender_breakdown",
    {
      title: "Break down senders",
      description: "Use this to split a noisy domain such as qq.com into concrete sender candidates and local sender-level rule suggestions without creating an operation plan.",
      inputSchema: {
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(200),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        fromDomainIncludes: z.string().optional(),
        fromIncludes: z.string().optional(),
        maxSenderCandidates: z.number().int().min(0).max(100).optional(),
        ruleGroup: classificationGroupSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.senderBreakdown(input)),
  );

  server.registerTool(
    "classification_map",
    {
      title: "Classification map",
      description: "Use this only for exploratory built-in heuristic discovery. For repeatable user-defined batch governance, prefer ruleset_governance_preview.",
      inputSchema: {
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(withLegacyDiscoveryWarning(await tools.classificationMap(input))),
  );

  server.registerTool(
    "classification_sweep",
    {
      title: "Classification sweep",
      description: "Use this only for exploratory built-in heuristic discovery over mailbox chunks. For repeatable user-defined batch governance, prefer ruleset_governance_preview.",
      inputSchema: {
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        chunkPages: z.number().int().min(1).max(50).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(withLegacyDiscoveryWarning(await tools.classificationSweep(input))),
  );

  server.registerTool(
    "bulk_governance_preview",
    {
      title: "Bulk governance preview",
      description: "Use this only for previewing built-in heuristic category actions. For repeatable user-defined batch governance, prefer ruleset_governance_preview.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        maxMessageRefs: z.number().int().min(0).max(500),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        selectedCategoryIds: z.array(bulkGovernanceCategorySchema),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerPlan(await tools.bulkGovernancePreview(input), planStore);
      const audited = withLegacyDiscoveryWarning(result);
      const response = compactOperationPlanResult(audited);
      return toToolResult(await withMcpAudit("bulk_governance_preview", input.runId, input, response, audited));
    },
  );

  server.registerTool(
    "ruleset_governance_preview",
    {
      title: "Ruleset governance preview",
      description: "Use this for user-defined batch governance: apply a ruleset, group matching metadata by user-defined groups, and create preview operation plans per target group.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        maxMessageRefsPerGroup: z.number().int().min(0).max(500),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        groups: z.array(classificationGroupSchema).optional(),
        rulesFile: z.string().optional(),
        selectedGroupIds: z.array(z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        includeClassifications: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerOperationPlans(await tools.rulesetGovernancePreview(input), planStore);
      const response = compactRulesetGovernancePreview(result, input.includeClassifications === true);
      return toToolResult(await withMcpAudit("ruleset_governance_preview", input.runId, input, response));
    },
  );

  server.registerTool(
    "ruleset_governance_campaign_preview",
    {
      title: "Ruleset governance campaign preview",
      description: "Use this for compact multi-folder user-defined ruleset governance: rank folders, summarize coverage, and create preview operation plans without returning full message refs.",
      inputSchema: {
        runId: z.string(),
        folders: z.array(z.string()).min(1).max(50),
        pageSize: z.number().int().min(1).max(50),
        maxPagesPerFolder: z.number().int().min(1).max(500),
        maxMessageRefsPerGroup: z.number().int().min(0).max(500),
        maxConcurrentFolders: z.number().int().min(1).max(10).optional(),
        maxUnplannedHintsPerFolder: z.number().int().min(0).max(10).optional(),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        groups: z.array(classificationGroupSchema).optional(),
        rulesFile: z.string().optional(),
        selectedGroupIds: z.array(z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await registerOperationPlans(await tools.rulesetGovernanceCampaignPreview(input), planStore);
      const response = compactRulesetGovernanceCampaignPreview(result);
      return toToolResult(await withMcpAudit("ruleset_governance_campaign_preview", input.runId, input, response));
    },
  );

  server.registerTool(
    "apply_ruleset_patch",
    {
      title: "Apply ruleset patch",
      description: "Use this to dry-run or explicitly apply a local QFerry ruleset patch, including appending rules or replacing stale rules by id. It returns a compact result by default; pass includeRenderedDraft only when the full merged draft is needed. This only writes the local rules file when apply is true and never mutates the mailbox.",
      inputSchema: {
        rulesFile: z.string(),
        apply: z.boolean().default(false),
        includeRenderedDraft: z.boolean().default(false),
        patch: rulesetPatchSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => toToolResult(await applyRulesetPatchDraft(input)),
  );

  server.registerTool(
    "confirm_cleanup_plan",
    {
      title: "Confirm cleanup plan",
      description: "Use this after the user approves a preview plan. It confirms only a cleanup plan previously generated and stored by this QFerry MCP server.",
      inputSchema: {
        operationPlanId: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      return instrumentMcpTool("confirm_cleanup_plan", input, async () => {
        const stored = await getStoredPlan(planStore, input.operationPlanId);
        const confirmed = {
          ...confirmOperationPlan(stored.plan, input.operationPlanId),
          confirmationRequired: false,
        };
        await planStore.set(input.operationPlanId, {
          plan: confirmed,
          expiresAt: Date.now() + PLAN_TTL_MS,
          previewSummary: stored.previewSummary,
        });
        const result = {
          plan: confirmed,
          expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
          mutationsAttempted: 0,
        };
        const response = compactOperationPlanResult(result);
        return toToolResult(await withMcpAudit("confirm_cleanup_plan", confirmed.runId, input, response, result));
      });
    },
  );

  server.registerTool(
    "execute_cleanup",
    {
      title: "Execute cleanup",
      description: "Use this only after confirm_cleanup_plan has confirmed a stored QFerry plan. Move and create-folder actions are currently supported.",
      inputSchema: {
        operationPlanId: z.string(),
        maxMessages: z.number().int().min(1).max(MAX_MOVE_EXECUTION_MAX_MESSAGES).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      return instrumentMcpTool("execute_cleanup", input, async () => {
        return enqueueMutationExecution(async () => {
          const stored = await getStoredPlan(planStore, input.operationPlanId);
          if (stored.plan.status !== "confirmed") {
            throw new Error(`Operation plan is not confirmed: ${input.operationPlanId}`);
          }
          const maxMessages = input.maxMessages ?? (stored.plan.action === "move" ? DEFAULT_MOVE_EXECUTION_MAX_MESSAGES : undefined);
          try {
            const result = await tools.executeCleanup({ plan: stored.plan, maxMessages });
            if (result.result.status === "partially_executed") {
              await planStore.set(input.operationPlanId, {
                plan: {
                  ...stored.plan,
                  messageRefs: stored.plan.messageRefs.slice(result.result.attemptedMessages),
                },
                expiresAt: Date.now() + PLAN_TTL_MS,
                previewSummary: stored.previewSummary,
              });
            } else {
              await planStore.delete(input.operationPlanId);
              await planStore.markConsumed(input.operationPlanId);
            }
            return toToolResult(
              await withMcpAudit("execute_cleanup", stored.plan.runId, input, result, {
                ...result,
                preview: stored.previewSummary,
                plan: { target: stored.plan.target },
              }),
            );
          } catch (error) {
            const attemptedMessages = maxMessages === undefined
              ? stored.plan.messageRefs.length
              : Math.min(maxMessages, stored.plan.messageRefs.length);
            await withMcpAudit("execute_cleanup", stored.plan.runId, input, {
              result: {
                operationPlanId: stored.plan.operationPlanId,
                status: "failed",
                action: stored.plan.action,
                attemptedMessages,
                mutationsAttempted: attemptedMessages,
                totalPlanMessages: stored.plan.messageRefs.length,
                remainingMessages: stored.plan.messageRefs.length,
                errorMessage: errorToMessage(error),
              },
              preview: stored.previewSummary,
              plan: { target: stored.plan.target },
            }).catch(() => {});
            await planStore.delete(input.operationPlanId);
            await planStore.markConsumed(input.operationPlanId);
            throw error;
          }
        });
      });
    },
  );

  return server;
}

async function registerPlan<T extends { plan: OperationPlan }>(
  result: T,
  store: OperationPlanStore,
): Promise<T> {
  return await registerOperationPlans(result, store);
}

async function registerOperationPlans<T extends { plan?: OperationPlan; plans?: OperationPlan[] }>(
  result: T,
  store: OperationPlanStore,
): Promise<T> {
  const plans = result.plans ?? (result.plan ? [result.plan] : []);
  const previewSummary = summarizeMcpToolResult(result);
  for (const plan of plans) {
    await store.set(plan.operationPlanId, {
      plan,
      expiresAt: Date.now() + PLAN_TTL_MS,
      previewSummary,
    });
  }
  return result;
}

function compactRulesetGovernancePreview<T extends { classifications?: unknown[] }>(
  result: T,
  includeClassifications: boolean,
): T | Omit<T, "classifications"> {
  if (includeClassifications) {
    return result;
  }
  const { classifications: _classifications, ...compactResult } = result;
  return compactResult;
}

function compactRulesetGovernanceCampaignPreview<T extends { plans?: unknown[] }>(
  result: T,
): Omit<T, "plans"> {
  const { plans: _plans, ...compactResult } = result;
  return compactResult;
}

function compactOperationPlan(plan: OperationPlan): Omit<OperationPlan, "messageRefs"> & { messageRefCount: number } {
  const { messageRefs, ...compactPlan } = plan;
  return {
    ...compactPlan,
    messageRefCount: messageRefs.length,
  };
}

function compactOperationPlanResult<T extends { plan?: OperationPlan; plans?: OperationPlan[] }>(
  result: T,
): Omit<T, "plan" | "plans"> & { plan?: ReturnType<typeof compactOperationPlan>; plans?: Array<ReturnType<typeof compactOperationPlan>> } {
  const { plan, plans, ...compactResult } = result;
  return {
    ...compactResult,
    ...(plan ? { plan: compactOperationPlan(plan) } : {}),
    ...(plans ? { plans: plans.map(compactOperationPlan) } : {}),
  };
}

async function instrumentMcpTool<T>(
  toolName: string,
  input: object,
  run: () => Promise<T>,
): Promise<T> {
  logMcpToolLifecycle("entered", toolName, input);
  try {
    const result = await run();
    logMcpToolLifecycle("completed", toolName, input, result);
    return result;
  } catch (error) {
    logMcpToolLifecycle("failed", toolName, input, undefined, error);
    throw error;
  }
}

function logMcpToolLifecycle(
  phase: "entered" | "completed" | "failed",
  toolName: string,
  input: object,
  result?: unknown,
  error?: unknown,
): void {
  const structuredResult = unwrapToolStructuredContent(result);
  const event = {
    event: `qferry_mcp_tool_${phase}`,
    timestamp: new Date().toISOString(),
    toolName,
    input: summarizeMcpToolInput(input),
    ...(structuredResult ? { summary: summarizeMcpToolResult(structuredResult) } : {}),
    ...(error ? {
      errorKind: classifyMcpToolError(toolName, error),
      errorMessage: errorToMessage(error),
    } : {}),
  };
  console.error(JSON.stringify(event));
}

function unwrapToolStructuredContent(result: unknown): object | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const maybeToolResult = result as { structuredContent?: unknown };
  if (typeof maybeToolResult.structuredContent === "object" && maybeToolResult.structuredContent !== null) {
    return maybeToolResult.structuredContent;
  }
  return result;
}

function classifyMcpToolError(toolName: string, error: unknown): McpToolErrorKind {
  const message = errorToMessage(error);
  if (
    toolName === "execute_cleanup"
    && !message.startsWith("Operation plan")
  ) {
    return "IMAP_PROVIDER_ERROR";
  }
  return "QFERRY_HANDLER_ERROR";
}

async function getStoredPlan(
  store: OperationPlanStore,
  operationPlanId: string,
): Promise<StoredPlan> {
  if (await store.isConsumed(operationPlanId)) {
    throw new Error(`Operation plan already consumed: ${operationPlanId}`);
  }
  const stored = await store.get(operationPlanId);
  if (!stored) {
    throw new Error(`Operation plan not found in QFerry plan store: ${operationPlanId}`);
  }
  if (stored.expiresAt < Date.now()) {
    await store.delete(operationPlanId);
    throw new Error(`Operation plan expired: ${operationPlanId}`);
  }
  return stored;
}

function createFileOperationPlanStore(rootDir = defaultOperationPlanStoreRoot()): OperationPlanStore {
  mkdirSync(rootDir, { recursive: true });
  const plansDir = join(rootDir, "plans");
  const consumedDir = join(rootDir, "consumed");
  return {
    async get(operationPlanId) {
      try {
        const raw = await readFile(planPath(plansDir, operationPlanId), "utf8");
        return JSON.parse(raw) as StoredPlan;
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async set(operationPlanId, storedPlan) {
      await mkdir(plansDir, { recursive: true });
      await writeFile(planPath(plansDir, operationPlanId), `${JSON.stringify(storedPlan, null, 2)}\n`, "utf8");
    },
    async delete(operationPlanId) {
      await rm(planPath(plansDir, operationPlanId), { force: true });
    },
    async isConsumed(operationPlanId) {
      try {
        await readFile(planPath(consumedDir, operationPlanId), "utf8");
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
    async markConsumed(operationPlanId) {
      await mkdir(consumedDir, { recursive: true });
      await writeFile(planPath(consumedDir, operationPlanId), `${new Date().toISOString()}\n`, "utf8");
    },
  };
}

function defaultOperationPlanStoreRoot(): string {
  const configured = process.env.QFERRY_OPERATION_PLAN_STORE_DIR?.trim();
  if (configured) return configured;
  const stateRoot = process.env.QFERRY_STATE_DIR?.trim() || (
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || os.homedir(), "qferry")
      : join(process.env.XDG_STATE_HOME || join(os.homedir(), ".local", "state"), "qferry")
  );
  return join(stateRoot, "operation-plans");
}

function planPath(rootDir: string, operationPlanId: string): string {
  return join(rootDir, `${encodeURIComponent(operationPlanId)}.json`);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function withMcpAudit<T extends object>(
  toolName: string,
  runId: string,
  input: object,
  structuredContent: T,
  auditStructuredContent: object = structuredContent,
): Promise<T & { audit: McpAuditInfo }> {
  const audit = await writeMcpAudit(toolName, runId, input, auditStructuredContent);
  return { ...structuredContent, audit };
}

async function writeMcpAudit(
  toolName: string,
  runId: string,
  input: object,
  structuredContent: object,
): Promise<McpAuditInfo> {
  const root = process.env.QFERRY_MCP_TRACE_ROOT?.trim() || process.cwd();
  const tracePath = join(root, "logs", "runs", `${runId}.jsonl`);
  const artifactDir = join(root, "artifacts", "e2e", runId);
  const summaryPath = join(artifactDir, "summary.md");
  const summary = summarizeMcpToolResult(structuredContent);
  const trace = new JsonlTraceWriter(tracePath);

  await trace.write({
    event: "mcp_tool_result",
    runId,
    toolName,
    input: summarizeMcpToolInput(input),
    ...summary,
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    summaryPath,
    [
      `# QFerry MCP Audit ${runId}`,
      "",
      `- lastTool: ${toolName}`,
      `- operationPlanId: ${summary.operationPlanId ?? "<none>"}`,
      `- operationPlanIds: ${formatSummaryJson(summary.operationPlanIds)}`,
      `- status: ${summary.status ?? "<none>"}`,
      `- action: ${summary.action ?? "<none>"}`,
      `- target: ${formatSummaryJson(summary.target)}`,
      `- selectedMessageRefs: ${summary.selectedMessageRefs ?? "<none>"}`,
      `- totalPlanMessages: ${summary.totalPlanMessages ?? "<none>"}`,
      `- attemptedMessages: ${summary.attemptedMessages ?? "<none>"}`,
      `- moved: ${summary.moved ?? "<none>"}`,
      `- reconciliationStatus: ${summary.reconciliationStatus ?? "<none>"}`,
      `- errorMessage: ${summary.errorMessage ?? "<none>"}`,
      `- remainingMessages: ${summary.remainingMessages ?? "<none>"}`,
      `- mutationsAttempted: ${summary.mutationsAttempted}`,
      `- batchAudit: ${formatSummaryJson(summary.batchAudit)}`,
      `- mailboxSnapshot: ${formatSummaryJson(summary.mailboxSnapshot)}`,
      `- categoryCounts: ${formatSummaryJson(summary.categoryCounts)}`,
      `- groupCounts: ${formatSummaryJson(summary.groupCounts)}`,
      `- campaignReport: ${formatSummaryJson(summary.campaignReport)}`,
      `- folderReports: ${formatSummaryJson(summary.folderReports)}`,
      `- groupPlans: ${formatSummaryJson(summary.groupPlans)}`,
      `- skippedGroups: ${formatSummaryJson(summary.skippedGroups)}`,
      `- selectedGroupTargets: ${formatSummaryJson(summary.selectedGroupTargets)}`,
      `- reconciliations: ${formatSummaryJson(summary.reconciliations)}`,
      `- trace: ${tracePath}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return { runId, tracePath, summaryPath };
}

function summarizeMcpToolInput(input: object): Record<string, unknown> {
  const raw = input as Record<string, unknown>;
  return {
    runId: typeof raw.runId === "string" ? raw.runId : undefined,
    operationPlanId: typeof raw.operationPlanId === "string" ? raw.operationPlanId : undefined,
    folder: typeof raw.folder === "string" ? raw.folder : undefined,
    folders: raw.folders,
    action: typeof raw.action === "string" ? raw.action : undefined,
    target: raw.target,
    scanOffset: raw.scanOffset,
    pageSize: raw.pageSize,
    maxPages: raw.maxPages,
    maxPagesPerFolder: raw.maxPagesPerFolder,
    maxMessageRefs: raw.maxMessageRefs,
    maxMessageRefsPerGroup: raw.maxMessageRefsPerGroup,
    maxConcurrentFolders: raw.maxConcurrentFolders,
    maxMessages: raw.maxMessages,
    messageRefCount: Array.isArray(raw.messageRefs) ? raw.messageRefs.length : undefined,
    selectedGroupIds: raw.selectedGroupIds,
    selectedCategoryIds: raw.selectedCategoryIds,
    selectedSenderDomains: raw.selectedSenderDomains,
    selectedFromIncludes: raw.selectedFromIncludes,
  };
}

function summarizeMcpToolResult(structuredContent: object): Record<string, unknown> {
  const content = structuredContent as Record<string, unknown>;
  const plan = content.plan as Record<string, unknown> | undefined;
  const plans = content.plans as Array<Record<string, unknown>> | undefined;
  const result = content.result as Record<string, unknown> | undefined;
  const preview = content.preview as Record<string, unknown> | undefined;
  const workflow = content.workflow as Record<string, unknown> | undefined;
  const workflowPreview = workflow?.preview as Record<string, unknown> | undefined;
  const campaign = (content.campaign ?? workflowPreview?.campaign) as Record<string, unknown> | undefined;
  const report = content.report as Record<string, unknown> | undefined;
  const operationPlanIds = Array.isArray(plans)
    ? plans.map((entry) => entry.operationPlanId).filter((entry) => typeof entry === "string")
    : Array.isArray(campaign?.folderReports)
      ? campaign.folderReports
        .flatMap((entry) => (entry as Record<string, unknown>).operationPlanIds)
        .filter((entry) => typeof entry === "string")
    : undefined;

  return {
    provider: result?.provider ?? plan?.provider ?? preview?.provider ?? campaign?.provider ?? report?.provider,
    operationPlanId: result?.operationPlanId ?? plan?.operationPlanId,
    operationPlanIds,
    status: result?.status ?? plan?.status,
    action: result?.action ?? plan?.action,
    target: plan?.target,
    selectedMessageRefs: preview?.selectedMessageRefs ?? report?.selectedMessageRefs,
    totalPlanMessages: result?.totalPlanMessages
      ?? (Array.isArray(plan?.messageRefs) ? plan.messageRefs.length : undefined)
      ?? (typeof plan?.messageRefCount === "number" ? plan.messageRefCount : undefined),
    attemptedMessages: result?.attemptedMessages,
    moved: result?.moved,
    reconciliationStatus: result?.reconciliationStatus,
    errorMessage: result?.errorMessage,
    remainingMessages: result?.remainingMessages,
    mutationsAttempted: content.mutationsAttempted ?? result?.mutationsAttempted ?? 0,
    batchAudit: result?.batchAudit,
    reconciliations: result?.reconciliations,
    mailboxSnapshot: preview?.mailboxSnapshot ?? report?.mailboxSnapshot,
    categoryCounts: preview?.categoryCounts,
    groupCounts: preview?.groupCounts,
    campaignReport: preview?.campaignReport,
    folderReports: campaign?.folderReports,
    groupPlans: preview?.groupPlans,
    skippedGroups: preview?.skippedGroups,
    selectedGroupTargets: preview?.selectedGroupTargets,
  };
}

function formatSummaryJson(value: unknown): string {
  return value === undefined ? "<none>" : JSON.stringify(value);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toToolResult<T extends object>(structuredContent: T) {
  const content = structuredContent as Record<string, unknown>;
  return {
    structuredContent: content,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(content),
      },
    ],
  };
}

function withLegacyDiscoveryWarning<T extends object>(structuredContent: T) {
  return {
    workflowWarning: LEGACY_DISCOVERY_WORKFLOW_WARNING,
    ...structuredContent,
  };
}

async function main(): Promise<void> {
  const server = createQFerryMcpServer();
  await server.connect(new StdioServerTransport());
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
