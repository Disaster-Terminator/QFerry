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
  type ExecuteCleanupResult,
  type MailProvider,
  type MessageRef,
  type OperationPlan,
  type QFerryRuntimeConfig,
} from "@qferry/core";
import { randomBytes } from "node:crypto";
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
const SENSITIVE_CLEANUP_WIDGET_URI = "ui://qferry/sensitive-cleanup.v9.html";
const SENSITIVE_CLEANUP_WIDGET_VERSION = "qferry-ui v2026-06-20-1840";
const SENSITIVE_CATEGORY_IDS = new Set([
  "security_or_account",
  "github_account_security",
  "google_account_security",
  "account_security",
  "account_recovery",
  "verification_code",
  "account_deletion",
  "email_added",
  "oauth",
  "oauth_authorization",
  "password_reset",
]);

interface PlanExecutionPolicy {
  sensitivity: "normal" | "sensitive";
  categories: Record<string, number>;
  confirmToken?: string;
}

interface StoredPlan {
  plan: OperationPlan;
  expiresAt: number;
  previewSummary?: Record<string, unknown>;
  executionPolicy?: PlanExecutionPolicy;
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

  server.registerResource(
    "qferry_sensitive_cleanup_widget",
    SENSITIVE_CLEANUP_WIDGET_URI,
    {
      title: "QFerry Sensitive Cleanup",
      description: "Confirm and execute account-security mail cleanup from a user-clicked ChatGPT app UI.",
      mimeType: "text/html",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: sensitiveCleanupWidgetHtml(),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          "openai/widgetDescription": "QFerry confirmation card for sensitive account-security mail cleanup.",
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: [],
          },
        },
      }],
    }),
  );

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
          executionPolicy: stored.executionPolicy,
        });
        const result = {
          plan: confirmed,
          expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
          mutationsAttempted: 0,
        };
        const response = compactConfirmedOperationPlanResult(result);
        return toToolResult(await withMcpAudit("confirm_cleanup_plan", confirmed.runId, input, response));
      });
    },
  );

  server.registerTool(
    "render_sensitive_cleanup_panel",
    {
      title: "Render sensitive cleanup panel",
      description: "Render a QFerry UI card for sensitive account-security cleanup. Use this when execute_cleanup returns SENSITIVE_UI_ONLY or when a plan is marked sensitive.",
      inputSchema: {
        operationPlanId: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: SENSITIVE_CLEANUP_WIDGET_URI },
        "openai/outputTemplate": SENSITIVE_CLEANUP_WIDGET_URI,
        "openai/toolInvocation/invoking": "Opening QFerry panel",
        "openai/toolInvocation/invoked": "QFerry panel ready",
      },
    },
    async (input) => {
      return instrumentMcpTool("render_sensitive_cleanup_panel", input, async () => {
        const stored = await getStoredPlan(planStore, input.operationPlanId);
        const policy = stored.executionPolicy ?? normalExecutionPolicy();
        const response = sensitiveCleanupPanelContent(stored, policy);
        return toToolResult(
          await withMcpAudit("render_sensitive_cleanup_panel", stored.plan.runId, input, response),
          {
            operationPlanId: stored.plan.operationPlanId,
            confirmToken: policy.confirmToken,
            categories: policy.categories,
          },
        );
      });
    },
  );

  server.registerTool(
    "execute_sensitive_cleanup_from_ui",
    {
      title: "Execute sensitive cleanup from UI",
      description: "Execute a sensitive account-security cleanup plan after an explicit user click in the QFerry ChatGPT app UI.",
      inputSchema: {
        operationPlanId: z.string(),
        confirmToken: z.string(),
        maxMessages: z.number().int().min(1).max(MAX_MOVE_EXECUTION_MAX_MESSAGES).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: {
        ui: { visibility: ["app"] },
        "openai/widgetAccessible": true,
        "openai/visibility": "private",
        "openai/toolInvocation/invoking": "Moving sensitive mail",
        "openai/toolInvocation/invoked": "Sensitive cleanup complete",
      },
    },
    async (input) => {
      return instrumentMcpTool("execute_sensitive_cleanup_from_ui", sanitizeSensitiveUiInput(input), async () => {
        return enqueueMutationExecution(async () => {
          const stored = await getStoredPlan(planStore, input.operationPlanId);
          const policy = stored.executionPolicy;
          if (!policy || policy.sensitivity !== "sensitive") {
            throw new Error("SENSITIVE_PLAN_REQUIRED");
          }
          if (!policy.confirmToken || policy.confirmToken !== input.confirmToken) {
            throw new Error("USER_CONFIRMATION_REQUIRED");
          }
          const plan = stored.plan.status === "confirmed"
            ? stored.plan
            : {
                ...confirmOperationPlan(stored.plan, input.operationPlanId),
                confirmationRequired: false,
              };
          const maxMessages = input.maxMessages ?? (plan.action === "move" ? DEFAULT_MOVE_EXECUTION_MAX_MESSAGES : undefined);
          const result = await tools.executeCleanup({ plan, maxMessages });
          if (result.result.status === "partially_executed") {
            await planStore.set(input.operationPlanId, {
              plan: {
                ...plan,
                messageRefs: plan.messageRefs.slice(result.result.attemptedMessages),
              },
              expiresAt: Date.now() + PLAN_TTL_MS,
              previewSummary: stored.previewSummary,
              executionPolicy: policy,
            });
          } else {
            await planStore.delete(input.operationPlanId);
            await planStore.markConsumed(input.operationPlanId);
          }
          const response = compactSensitiveUiExecutionResult(result.result, policy);
          return toToolResult(await withMcpAudit("execute_sensitive_cleanup_from_ui", plan.runId, sanitizeSensitiveUiInput(input), response));
        });
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
          if (stored.executionPolicy?.sensitivity === "sensitive") {
            throw new Error("SENSITIVE_UI_ONLY: render_sensitive_cleanup_panel must be used for this account-security cleanup plan");
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
            const response = compactExecuteCleanupResult(result.result);
            return toToolResult(await withMcpAudit("execute_cleanup", stored.plan.runId, input, response));
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
    const executionPolicy = classifyPlanExecutionPolicy(plan, result);
    await store.set(plan.operationPlanId, {
      plan,
      expiresAt: Date.now() + PLAN_TTL_MS,
      previewSummary,
      executionPolicy,
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

function compactConfirmedOperationPlanResult<T extends { plan: OperationPlan; expiresAt: string; mutationsAttempted: number }>(
  result: T,
): {
  plan: Pick<OperationPlan, "operationPlanId" | "runId" | "status" | "action" | "confirmationRequired"> & { messageRefCount: number };
  expiresAt: string;
  mutationsAttempted: number;
} {
  return {
    plan: {
      operationPlanId: result.plan.operationPlanId,
      runId: result.plan.runId,
      status: result.plan.status,
      action: result.plan.action,
      confirmationRequired: result.plan.confirmationRequired,
      messageRefCount: result.plan.messageRefs.length,
    },
    expiresAt: result.expiresAt,
    mutationsAttempted: result.mutationsAttempted,
  };
}

function compactExecuteCleanupResult(result: ExecuteCleanupResult): { result: Omit<ExecuteCleanupResult, "batchAudit" | "reconciliations"> } {
  const { batchAudit: _batchAudit, reconciliations: _reconciliations, ...compactResult } = result;
  return { result: compactResult };
}

function compactSensitiveUiExecutionResult(result: ExecuteCleanupResult, policy: PlanExecutionPolicy) {
  return {
    ok: result.status === "executed" || result.status === "partially_executed",
    result: compactExecuteCleanupResult(result).result,
    moved: result.moved ?? 0,
    categories: policy.categories,
    mutationsAttempted: result.mutationsAttempted,
  };
}

function sensitiveCleanupPanelContent(stored: StoredPlan, policy: PlanExecutionPolicy) {
  return {
    kind: "qferry_sensitive_cleanup_panel",
    operationPlanId: stored.plan.operationPlanId,
    runId: stored.plan.runId,
    sensitivity: policy.sensitivity,
    categories: policy.categories,
    action: stored.plan.action,
    totalPlanMessages: stored.plan.messageRefs.length,
    expiresAt: new Date(stored.expiresAt).toISOString(),
    mutationsAttempted: 0,
  };
}

function classifyPlanExecutionPolicy(plan: OperationPlan, result: object): PlanExecutionPolicy {
  const categories = extractPlanCategoryCounts(plan, result);
  const sensitive = Object.keys(categories).some((category) => isSensitiveCategoryId(category))
    || isSensitiveTarget(plan.target)
    || isSensitiveText(plan.runId);
  return {
    sensitivity: sensitive ? "sensitive" : "normal",
    categories,
    ...(sensitive ? { confirmToken: createConfirmToken() } : {}),
  };
}

function normalExecutionPolicy(): PlanExecutionPolicy {
  return { sensitivity: "normal", categories: {} };
}

function createConfirmToken(): string {
  return randomBytes(18).toString("base64url");
}

function extractPlanCategoryCounts(plan: OperationPlan, result: object): Record<string, number> {
  const categories: Record<string, number> = {};
  const resultRecord = result as Record<string, unknown>;
  const preview = resultRecord.preview as Record<string, unknown> | undefined;
  const workflow = resultRecord.workflow as Record<string, unknown> | undefined;
  const workflowPreview = workflow?.preview as Record<string, unknown> | undefined;
  const campaign = (resultRecord.campaign ?? workflowPreview?.campaign) as Record<string, unknown> | undefined;
  const classifications = resultRecord.classifications as Array<Record<string, unknown>> | undefined;

  const planRefCount = Math.max(plan.messageRefs.length, 0);
  for (const category of stringArray(preview?.selectedCategoryIds)) {
    categories[category] = Math.max(categories[category] ?? 0, planRefCount);
  }

  for (const groupPlan of groupPlansForPlan(plan.operationPlanId, preview)) {
    addCategoryCount(categories, groupPlan.groupId, numericValue(groupPlan.selectedMessageRefs) ?? planRefCount);
    addCategoryCount(categories, groupPlan.label, numericValue(groupPlan.selectedMessageRefs) ?? planRefCount);
  }
  for (const groupPlan of campaignGroupPlansForPlan(plan.operationPlanId, campaign)) {
    addCategoryCount(categories, groupPlan.groupId, numericValue(groupPlan.selectedMessageRefs) ?? planRefCount);
    addCategoryCount(categories, groupPlan.label, numericValue(groupPlan.selectedMessageRefs) ?? planRefCount);
  }

  if (classifications) {
    const plannedRefs = new Set(plan.messageRefs.map(messageRefKeyForPolicy));
    for (const classification of classifications) {
      const messageRef = classification.messageRef as MessageRef | undefined;
      const groupId = typeof classification.groupId === "string" ? classification.groupId : undefined;
      if (messageRef && groupId && plannedRefs.has(messageRefKeyForPolicy(messageRef))) {
        addCategoryCount(categories, groupId, 1);
      }
    }
  }

  const targetCategory = categoryFromTarget(plan.target);
  if (targetCategory) {
    addCategoryCount(categories, targetCategory, planRefCount);
  }
  return Object.fromEntries(Object.entries(categories).filter(([category]) => category.trim().length > 0));
}

function groupPlansForPlan(operationPlanId: string, preview?: Record<string, unknown>): Array<Record<string, unknown>> {
  const groupPlans = preview?.groupPlans;
  if (!Array.isArray(groupPlans)) return [];
  return groupPlans
    .filter((groupPlan) => typeof groupPlan === "object" && groupPlan !== null)
    .map((groupPlan) => groupPlan as Record<string, unknown>)
    .filter((groupPlan) => groupPlan.operationPlanId === operationPlanId);
}

function campaignGroupPlansForPlan(operationPlanId: string, campaign?: Record<string, unknown>): Array<Record<string, unknown>> {
  const folderReports = campaign?.folderReports;
  if (!Array.isArray(folderReports)) return [];
  return folderReports
    .filter((folderReport) => typeof folderReport === "object" && folderReport !== null)
    .flatMap((folderReport) => {
      const groupPlans = (folderReport as Record<string, unknown>).groupPlans;
      return Array.isArray(groupPlans) ? groupPlans : [];
    })
    .filter((groupPlan) => typeof groupPlan === "object" && groupPlan !== null)
    .map((groupPlan) => groupPlan as Record<string, unknown>)
    .filter((groupPlan) => groupPlan.operationPlanId === operationPlanId);
}

function addCategoryCount(categories: Record<string, number>, rawCategory: unknown, count: number): void {
  if (typeof rawCategory !== "string" || rawCategory.trim().length === 0) return;
  const category = rawCategory.trim();
  categories[category] = Math.max(categories[category] ?? 0, Math.max(count, 0));
}

function categoryFromTarget(target?: Record<string, string>): string | undefined {
  const folder = target?.folder;
  if (!folder) return undefined;
  const normalized = normalizeSensitivityText(folder);
  if (normalized.includes("github") && normalized.includes("account")) return "github_account_security";
  if (normalized.includes("google") && normalized.includes("account")) return "google_account_security";
  if (normalized.includes("账号安全") || normalized.includes("account_security") || normalized.includes("account security")) return "account_security";
  return undefined;
}

function isSensitiveCategoryId(category: string): boolean {
  const normalized = normalizeSensitivityText(category);
  return SENSITIVE_CATEGORY_IDS.has(normalized)
    || normalized.includes("account_security")
    || normalized.includes("verification_code")
    || normalized.includes("password_reset")
    || normalized.includes("account_deletion")
    || normalized.includes("email_added")
    || normalized.includes("oauth")
    || normalized.includes("账号安全")
    || normalized.includes("验证码");
}

function isSensitiveTarget(target?: Record<string, string>): boolean {
  return isSensitiveText(target?.folder ?? "");
}

function isSensitiveText(value: string): boolean {
  return isSensitiveCategoryId(value);
}

function normalizeSensitivityText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s/.-]+/g, "_");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function messageRefKeyForPolicy(ref: MessageRef): string {
  return `${ref.provider}:${ref.accountAlias}:${ref.folder}:${ref.uidValidity ?? ""}:${ref.uid}`;
}

function sanitizeSensitiveUiInput(input: { operationPlanId: string; maxMessages?: number }) {
  return {
    operationPlanId: input.operationPlanId,
    ...(input.maxMessages !== undefined ? { maxMessages: input.maxMessages } : {}),
    userGesture: true,
  };
}

function sensitiveCleanupWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: transparent;
      color: CanvasText;
    }
    html {
      margin: 0;
      padding: 0;
      width: 100%;
      overflow: hidden;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 28px 28px;
      min-width: 280px;
      overflow: hidden;
    }
    .panel {
      display: grid;
      gap: 16px;
      width: 100%;
      max-width: 100%;
      min-height: 180px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .count {
      font-size: 13px;
      color: color-mix(in srgb, CanvasText 70%, transparent);
      white-space: nowrap;
    }
    .categories {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .category {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 40px;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 13px;
    }
    .category span:first-child {
      overflow-wrap: anywhere;
    }
    .category span:last-child {
      color: color-mix(in srgb, CanvasText 65%, transparent);
      white-space: nowrap;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    button {
      appearance: none;
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 6px;
      min-height: 40px;
      padding: 8px 14px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      color: white;
      background: #0f766e;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .secondary {
      color: CanvasText;
      background: transparent;
    }
    .status {
      min-height: 18px;
      font-size: 13px;
      color: color-mix(in srgb, CanvasText 72%, transparent);
    }
    .debug-version {
      font-size: 11px;
      color: color-mix(in srgb, CanvasText 45%, transparent);
      user-select: none;
    }
    .meta {
      font-size: 11px;
      color: color-mix(in srgb, CanvasText 52%, transparent);
      user-select: none;
    }
  </style>
</head>
<body>
  <main class="panel" aria-live="polite">
    <div class="head">
      <h1>QFerry sensitive cleanup</h1>
      <div id="total" class="count">Waiting for plan</div>
    </div>
    <ul id="categories" class="categories"></ul>
    <div class="actions">
      <button id="execute" type="button" disabled>Move planned mail</button>
      <button id="refresh" type="button" class="secondary">Refresh</button>
    </div>
    <div id="status" class="status">Open a sensitive cleanup plan from chat.</div>
    <div id="meta" class="meta">plan none</div>
    <div class="debug-version">${SENSITIVE_CLEANUP_WIDGET_VERSION}</div>
  </main>
  <script>
    const state = {
      operationPlanId: undefined,
      confirmToken: undefined,
      categories: {},
      totalPlanMessages: 0,
      completed: false,
      lastResult: undefined,
      busy: false,
      error: undefined,
    };
    const total = document.getElementById("total");
    const categories = document.getElementById("categories");
    const execute = document.getElementById("execute");
    const refresh = document.getElementById("refresh");
    const status = document.getElementById("status");
    const meta = document.getElementById("meta");

    function firstObject(...values) {
      for (const value of values) {
        if (value && typeof value === "object") return value;
      }
      return {};
    }

    function metadataFrom(payload = {}) {
      return firstObject(
        payload._meta,
        payload.meta,
        payload.mcp_tool_result?._meta,
        payload.call_tool_result?._meta,
        payload.result?._meta,
        payload.params?._meta,
        payload.params?.mcp_tool_result?._meta,
        payload.params?.call_tool_result?._meta
      );
    }

    function structuredFrom(payload = {}) {
      return firstObject(
        payload.structuredContent,
        payload.mcp_tool_result?.structuredContent,
        payload.call_tool_result?.structuredContent,
        payload.result?.structuredContent,
        payload.params?.structuredContent,
        payload.params?.mcp_tool_result?.structuredContent,
        payload.params?.call_tool_result?.structuredContent,
        payload
      );
    }

    function planDataFrom(payload = {}) {
      return { ...structuredFrom(payload), ...metadataFrom(payload) };
    }

    function currentPlanData(toolOutput = {}, context = {}, toolResponseMetadata = {}, widgetState = {}) {
      const output = mergedSamePlanData(toolOutput, context, toolResponseMetadata);
      const outputId = output.operationPlanId;
      const stored = planDataFrom(widgetState || {});
      const storedId = stored.operationPlanId;
      if (!outputId) return stored;
      if (storedId && storedId === outputId) return { ...output, ...stored };
      return {
        ...output,
        completed: false,
        totalPlanMessages: output.totalPlanMessages ?? Object.values(output.categories || {}).reduce((sum, value) => sum + Number(value || 0), 0),
        categories: output.categories || {},
        lastResult: undefined,
      };
    }

    function mergedSamePlanData(...payloads) {
      return payloads.reduce((merged, payload) => {
        const next = planDataFrom(payload || {});
        const mergedId = merged.operationPlanId;
        const nextId = next.operationPlanId;
        if (mergedId && nextId && mergedId !== nextId) return merged;
        return { ...merged, ...next };
      }, {});
    }

    function remainingMessagesFrom(plan) {
      const resultRemaining = plan.lastResult?.result?.remainingMessages;
      if (Number.isFinite(Number(resultRemaining))) return Number(resultRemaining);
      const directRemaining = plan.result?.remainingMessages;
      if (Number.isFinite(Number(directRemaining))) return Number(directRemaining);
      const total = plan.totalPlanMessages;
      return Number.isFinite(Number(total)) ? Number(total) : undefined;
    }

    function isCompletedPlan(plan) {
      if (plan.completed === true) return true;
      const remaining = remainingMessagesFrom(plan);
      return remaining === 0;
    }

    function zeroCategories(categoriesValue) {
      return Object.fromEntries(Object.keys(categoriesValue || {}).map((category) => [category, 0]));
    }

    function shortPlanId(value) {
      return typeof value === "string" && value.length > 8 ? value.slice(-8) : value || "none";
    }

    async function resetStoredStateForPlan(plan) {
      const openai = window.openai;
      if (!plan.operationPlanId || openai?.widgetState?.operationPlanId === plan.operationPlanId) return;
      const nextWidgetState = {
        operationPlanId: plan.operationPlanId,
        runId: plan.runId,
        categories: plan.categories || {},
        totalPlanMessages: plan.totalPlanMessages ?? Object.values(plan.categories || {}).reduce((sum, value) => sum + Number(value || 0), 0),
        completed: false,
        lastResult: null,
      };
      await openai?.setWidgetState?.(nextWidgetState);
    }

    function hydrate(payload = {}) {
      const plan = planDataFrom(payload);
      const nextOperationPlanId = plan.operationPlanId;
      const samePlan = !nextOperationPlanId || !state.operationPlanId || nextOperationPlanId === state.operationPlanId;
      if (nextOperationPlanId && state.operationPlanId && nextOperationPlanId !== state.operationPlanId) {
        state.completed = false;
        state.lastResult = undefined;
        state.error = undefined;
      }
      state.operationPlanId = nextOperationPlanId || state.operationPlanId;
      state.confirmToken = plan.confirmToken || state.confirmToken;
      state.lastResult = samePlan ? (plan.lastResult || state.lastResult) : plan.lastResult;
      const completed = samePlan ? (isCompletedPlan({ ...state, ...plan }) || state.completed) : isCompletedPlan(plan);
      state.completed = completed;
      if (state.completed) state.busy = false;
      const sourceCategories = plan.categories || state.categories || {};
      state.categories = completed ? zeroCategories(sourceCategories) : sourceCategories;
      const remaining = remainingMessagesFrom({ ...state, ...plan });
      state.totalPlanMessages = completed
        ? 0
        : remaining ?? Object.values(state.categories).reduce((sum, value) => sum + Number(value || 0), 0);
      render();
    }

    function render() {
      const entries = Object.entries(state.categories || {});
      total.textContent = state.completed ? "Done" : state.totalPlanMessages ? state.totalPlanMessages + " planned" : "No plan";
      categories.innerHTML = "";
      for (const [category, count] of entries) {
        const item = document.createElement("li");
        item.className = "category";
        const label = document.createElement("span");
        label.textContent = category;
        const value = document.createElement("span");
        value.textContent = String(count);
        item.append(label, value);
        categories.append(item);
      }
      const hasPlan = Boolean(state.operationPlanId) && state.totalPlanMessages > 0 && !state.completed;
      execute.disabled = state.busy || !hasPlan || !state.confirmToken;
      execute.textContent = state.completed ? "Moved" : state.busy ? "Moving..." : "Move planned mail";
      if (state.busy) {
        status.textContent = "Moving sensitive mail...";
      } else if (!hasPlan) {
        const moved = state.lastResult?.moved ?? state.lastResult?.result?.moved;
        status.textContent = state.completed
          ? (moved === undefined ? "No remaining sensitive mail in this plan." : "Moved " + String(moved) + " messages.")
          : "Open a sensitive cleanup plan from chat.";
      } else if (state.error) {
        status.textContent = state.error;
      } else if (!state.confirmToken) {
        status.textContent = "Sensitive cleanup plan loaded; waiting for secure app metadata.";
      } else {
        status.textContent = "Sensitive cleanup plan loaded from chat.";
      }
      meta.textContent = "plan " + shortPlanId(state.operationPlanId)
        + " | remaining " + String(state.totalPlanMessages)
        + " | " + (state.completed ? "completed" : state.busy ? "moving" : "ready");
      window.openai?.notifyIntrinsicHeight?.();
    }

    function syncOpenAiState() {
      const plan = currentPlanData(
        window.openai?.toolOutput || {},
        window.openai?.context || {},
        window.openai?.toolResponseMetadata || {},
        window.openai?.widgetState || {}
      );
      hydrate(plan);
      void resetStoredStateForPlan(plan);
    }

    function hydrateOpenAiGlobals(globals = {}) {
      const plan = currentPlanData(
        globals.toolOutput || {},
        globals.context || {},
        globals.toolResponseMetadata || {},
        globals.widgetState || {}
      );
      hydrate(plan);
      void resetStoredStateForPlan(plan);
    }

    function hydrateBridgePayload(payload = {}) {
      if (payload?.method === "openai:set_globals") {
        hydrateOpenAiGlobals(payload.params?.globals || payload.params || {});
        return;
      }
      if (payload?.method === "ui/notifications/tool-result") {
        hydrate(payload.params || {});
        syncOpenAiState();
        return;
      }
      if (payload?.globals) {
        hydrateOpenAiGlobals(payload.globals);
        return;
      }
      hydrate(payload);
    }

    async function callTool(name, args) {
      const openai = window.openai;
      if (openai?.callTool) return await openai.callTool(name, args);
      if (openai?.tools?.call) return await openai.tools.call(name, args);
      throw new Error("ChatGPT app tool bridge is unavailable");
    }

    execute.addEventListener("click", async () => {
      if (state.busy || state.completed || !state.operationPlanId) return;
      state.busy = true;
      state.error = undefined;
      render();
      try {
        const result = await callTool("execute_sensitive_cleanup_from_ui", {
          operationPlanId: state.operationPlanId,
          confirmToken: state.confirmToken,
          maxMessages: state.totalPlanMessages,
        });
        const content = result?.structuredContent || result || {};
        const moved = Number(content.moved ?? content.result?.moved ?? 0);
        const remaining = Number.isFinite(Number(content.result?.remainingMessages))
          ? Number(content.result.remainingMessages)
          : Math.max(0, state.totalPlanMessages - moved);
        state.totalPlanMessages = remaining;
        state.completed = remaining === 0;
        if (state.completed) state.categories = zeroCategories(state.categories);
        state.lastResult = content;
        state.error = undefined;
        const nextWidgetState = {
          operationPlanId: state.operationPlanId,
          categories: state.categories,
          totalPlanMessages: remaining,
          completed: state.completed,
          lastResult: content,
        };
        await window.openai?.setWidgetState?.(nextWidgetState);
        hydrate(nextWidgetState);
        syncOpenAiState();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.busy = false;
        render();
      }
    });

    refresh.addEventListener("click", () => syncOpenAiState());
    window.addEventListener("message", (event) => hydrateBridgePayload(event.data || {}));
    window.addEventListener("openai:set_globals", (event) => hydrateOpenAiGlobals(event.detail?.globals || event.detail || {}));
    window.addEventListener("focus", () => syncOpenAiState());
    document.addEventListener("visibilitychange", () => syncOpenAiState());
    syncOpenAiState();
    let syncCount = 0;
    const syncTimer = window.setInterval(() => {
      syncOpenAiState();
      syncCount += 1;
      if (syncCount >= 20 || state.completed) window.clearInterval(syncTimer);
    }, 500);
  </script>
</body>
</html>`;
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

function toToolResult<T extends object>(structuredContent: T, meta?: Record<string, unknown>) {
  const content = structuredContent as Record<string, unknown>;
  return {
    ...(meta ? { _meta: meta } : {}),
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
