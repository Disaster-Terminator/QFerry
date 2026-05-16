import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createMailTools,
  applyRulesetPatchDraft,
  confirmOperationPlan,
  FixtureMailProvider,
  JsonlTraceWriter,
  loadQFerryRuntimeConfigSync,
  loadQFerryRuntimeSecretsSync,
  QqMutableProvider,
  type MailProvider,
  type MessageRef,
  type OperationPlan,
  type QFerryRuntimeConfig,
} from "@qferry/core";
import { mkdir, writeFile } from "node:fs/promises";
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

const rulesetPatchSchema = z.object({
  groupToEnsure: z.object({
    id: z.string(),
    label: z.string(),
    target: z.object({
      folder: z.string(),
    }).optional(),
  }),
  candidateRuleCount: z.number().int().min(0),
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

export interface CreateQFerryMcpServerOptions {
  provider?: MailProvider;
  runtimeConfig?: QFerryRuntimeConfig;
}

const DEFAULT_MOVE_EXECUTION_MAX_MESSAGES = 5;
const MAX_MOVE_EXECUTION_MAX_MESSAGES = 50;

interface McpAuditInfo {
  runId: string;
  tracePath: string;
  summaryPath: string;
}

export function createQFerryMcpServer(options: CreateQFerryMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "qferry-chatgpt-app",
    version: "0.0.0",
  });
  const runtimeConfig = options.runtimeConfig ?? loadQFerryRuntimeConfigSync();
  const provider = options.provider ?? createProviderFromConfig(runtimeConfig);
  const tools = createMailTools({ provider, runtimeConfig });
  const planRegistry = new Map<string, StoredPlan>();
  const consumedPlanIds = new Set<string>();

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
      const result = registerPlan(await tools.planCleanup(input), planRegistry);
      return toToolResult(await withMcpAudit("plan_cleanup", input.runId, input, result));
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
      const registered = result.plan ? registerPlan({ ...result, plan: result.plan }, planRegistry) : result;
      return toToolResult(await withMcpAudit("ensure_classification_folder", input.runId, input, registered));
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
        maxMessageRefs: z.number().int().min(1).max(200),
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
      const result = registerPlan(await tools.previewCleanupBatch(input), planRegistry);
      return toToolResult(await withMcpAudit("preview_cleanup_batch", input.runId, input, result));
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
        maxMessageRefs: z.number().int().min(0).max(200),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        selectedSenderDomains: z.array(z.string()).optional(),
        selectedFromIncludes: z.array(z.string()).optional(),
        maxDomainCandidates: z.number().int().min(0).max(100).optional(),
        ruleGroup: z.object({
          id: z.string(),
          label: z.string(),
          target: z.object({
            folder: z.string(),
          }).optional(),
        }).optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = registerPlan(await tools.planSenderGovernance(input), planRegistry);
      return toToolResult(await withMcpAudit("plan_sender_governance", input.runId, input, result));
    },
  );

  server.registerTool(
    "classification_map",
    {
      title: "Classification map",
      description: "Use this first for Gmail-like mailbox governance: scan a bounded window, classify it into action buckets, and return no operation plan.",
      inputSchema: {
        folder: z.string(),
        pageSize: z.number().int().min(1).max(50),
        maxPages: z.number().int().min(1).max(500),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.classificationMap(input)),
  );

  server.registerTool(
    "classification_sweep",
    {
      title: "Classification sweep",
      description: "Use this for Gmail-like full-mailbox governance: progressively scan classification chunks and return compact aggregate counts plus nextScanOffset, without message refs or an operation plan.",
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
    async (input) => toToolResult(await tools.classificationSweep(input)),
  );

  server.registerTool(
    "bulk_governance_preview",
    {
      title: "Bulk governance preview",
      description: "Use this for Gmail-like large-window dry-run classification by sender/domain/content category and a bounded preview cleanup plan. Use small confirmed mutation only after review.",
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
      const result = registerPlan(await tools.bulkGovernancePreview(input), planRegistry);
      return toToolResult(await withMcpAudit("bulk_governance_preview", input.runId, input, result));
    },
  );

  server.registerTool(
    "apply_ruleset_patch",
    {
      title: "Apply ruleset patch",
      description: "Use this to dry-run or explicitly apply a local QFerry ruleset patch. This only writes the local rules file when apply is true and never mutates the mailbox.",
      inputSchema: {
        rulesFile: z.string(),
        apply: z.boolean().default(false),
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
      description: "Use this after the user approves a preview plan. It confirms only a cleanup plan previously generated by this QFerry MCP server instance.",
      inputSchema: {
        operationPlanId: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const stored = getStoredPlan(planRegistry, consumedPlanIds, input.operationPlanId);
      const confirmed = {
        ...confirmOperationPlan(stored.plan, input.operationPlanId),
        confirmationRequired: false,
      };
      planRegistry.set(input.operationPlanId, {
        plan: confirmed,
        expiresAt: Date.now() + PLAN_TTL_MS,
        previewSummary: stored.previewSummary,
      });
      const result = {
        plan: confirmed,
        expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
        mutationsAttempted: 0,
      };
      return toToolResult(await withMcpAudit("confirm_cleanup_plan", confirmed.runId, input, result));
    },
  );

  server.registerTool(
    "execute_cleanup",
    {
      title: "Execute cleanup",
      description: "Use this only after confirm_cleanup_plan has confirmed a plan generated by this QFerry MCP server instance. Move and create-folder actions are currently supported.",
      inputSchema: {
        operationPlanId: z.string(),
        maxMessages: z.number().int().min(1).max(MAX_MOVE_EXECUTION_MAX_MESSAGES).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const stored = getStoredPlan(planRegistry, consumedPlanIds, input.operationPlanId);
      if (stored.plan.status !== "confirmed") {
        throw new Error(`Operation plan is not confirmed: ${input.operationPlanId}`);
      }
      const maxMessages = input.maxMessages ?? (stored.plan.action === "move" ? DEFAULT_MOVE_EXECUTION_MAX_MESSAGES : undefined);
      try {
        const result = await tools.executeCleanup({ plan: stored.plan, maxMessages });
        if (result.result.status === "partially_executed") {
          planRegistry.set(input.operationPlanId, {
            plan: {
              ...stored.plan,
              messageRefs: stored.plan.messageRefs.slice(result.result.attemptedMessages),
            },
            expiresAt: Date.now() + PLAN_TTL_MS,
            previewSummary: stored.previewSummary,
          });
        } else {
          planRegistry.delete(input.operationPlanId);
          consumedPlanIds.add(input.operationPlanId);
        }
        return toToolResult(
          await withMcpAudit("execute_cleanup", stored.plan.runId, input, result, {
            ...result,
            preview: stored.previewSummary,
            plan: { target: stored.plan.target },
          }),
        );
      } catch (error) {
        planRegistry.delete(input.operationPlanId);
        consumedPlanIds.add(input.operationPlanId);
        throw error;
      }
    },
  );

  return server;
}

function registerPlan<T extends { plan: OperationPlan }>(
  result: T,
  registry: Map<string, StoredPlan>,
): T {
  registry.set(result.plan.operationPlanId, {
    plan: result.plan,
    expiresAt: Date.now() + PLAN_TTL_MS,
    previewSummary: summarizeMcpToolResult(result),
  });
  return result;
}

function getStoredPlan(
  registry: Map<string, StoredPlan>,
  consumedPlanIds: Set<string>,
  operationPlanId: string,
): StoredPlan {
  if (consumedPlanIds.has(operationPlanId)) {
    throw new Error(`Operation plan already consumed: ${operationPlanId}`);
  }
  const stored = registry.get(operationPlanId);
  if (!stored) {
    throw new Error(`Operation plan not found in this QFerry session: ${operationPlanId}`);
  }
  if (stored.expiresAt < Date.now()) {
    registry.delete(operationPlanId);
    throw new Error(`Operation plan expired: ${operationPlanId}`);
  }
  return stored;
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
      `- status: ${summary.status ?? "<none>"}`,
      `- action: ${summary.action ?? "<none>"}`,
      `- target: ${formatSummaryJson(summary.target)}`,
      `- selectedMessageRefs: ${summary.selectedMessageRefs ?? "<none>"}`,
      `- totalPlanMessages: ${summary.totalPlanMessages ?? "<none>"}`,
      `- attemptedMessages: ${summary.attemptedMessages ?? "<none>"}`,
      `- moved: ${summary.moved ?? "<none>"}`,
      `- remainingMessages: ${summary.remainingMessages ?? "<none>"}`,
      `- mutationsAttempted: ${summary.mutationsAttempted}`,
      `- mailboxSnapshot: ${formatSummaryJson(summary.mailboxSnapshot)}`,
      `- categoryCounts: ${formatSummaryJson(summary.categoryCounts)}`,
      `- groupCounts: ${formatSummaryJson(summary.groupCounts)}`,
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
    action: typeof raw.action === "string" ? raw.action : undefined,
    target: raw.target,
    scanOffset: raw.scanOffset,
    pageSize: raw.pageSize,
    maxPages: raw.maxPages,
    maxMessageRefs: raw.maxMessageRefs,
    maxMessages: raw.maxMessages,
    selectedGroupIds: raw.selectedGroupIds,
    selectedCategoryIds: raw.selectedCategoryIds,
    selectedSenderDomains: raw.selectedSenderDomains,
    selectedFromIncludes: raw.selectedFromIncludes,
  };
}

function summarizeMcpToolResult(structuredContent: object): Record<string, unknown> {
  const content = structuredContent as Record<string, unknown>;
  const plan = content.plan as Record<string, unknown> | undefined;
  const result = content.result as Record<string, unknown> | undefined;
  const preview = content.preview as Record<string, unknown> | undefined;
  const report = content.report as Record<string, unknown> | undefined;

  return {
    provider: result?.provider ?? plan?.provider ?? preview?.provider ?? report?.provider,
    operationPlanId: result?.operationPlanId ?? plan?.operationPlanId,
    status: result?.status ?? plan?.status,
    action: result?.action ?? plan?.action,
    target: plan?.target,
    selectedMessageRefs: preview?.selectedMessageRefs ?? report?.selectedMessageRefs,
    totalPlanMessages: result?.totalPlanMessages ?? (Array.isArray(plan?.messageRefs) ? plan.messageRefs.length : undefined),
    attemptedMessages: result?.attemptedMessages,
    moved: result?.moved,
    remainingMessages: result?.remainingMessages,
    mutationsAttempted: content.mutationsAttempted ?? result?.mutationsAttempted ?? 0,
    reconciliations: result?.reconciliations,
    mailboxSnapshot: preview?.mailboxSnapshot ?? report?.mailboxSnapshot,
    categoryCounts: preview?.categoryCounts,
    groupCounts: preview?.groupCounts,
    selectedGroupTargets: preview?.selectedGroupTargets,
  };
}

function formatSummaryJson(value: unknown): string {
  return value === undefined ? "<none>" : JSON.stringify(value);
}

function createProviderFromConfig(runtimeConfig: QFerryRuntimeConfig): MailProvider {
  if (runtimeConfig.provider !== "qqmail") {
    return FixtureMailProvider.demo();
  }

  const user = runtimeConfig.qqmail?.email;
  const pass = loadQFerryRuntimeSecretsSync().qqmailKey;
  if (!user || !pass) {
    return new UnavailableMailProvider(runtimeConfig);
  }

  return new QqMutableProvider({
    accountAlias: runtimeConfig.accountAlias,
    host: runtimeConfig.qqmail?.imapHost || "imap.qq.com",
    port: runtimeConfig.qqmail?.imapPort || 993,
    maxRecommendedScanLimit: runtimeConfig.metadataSampleLimit,
    auth: { user, pass },
  });
}

class UnavailableMailProvider implements MailProvider {
  constructor(private readonly runtimeConfig: QFerryRuntimeConfig) {}

  async listMailboxes(): Promise<never> {
    throw this.error();
  }

  async scanMailboxMetadata(): Promise<never> {
    throw this.error();
  }

  async fetchMessage(): Promise<never> {
    throw this.error();
  }

  async getCapabilitySnapshot() {
    return {
      provider: this.runtimeConfig.provider,
      accountAlias: this.runtimeConfig.accountAlias,
      supportsListMailboxes: false,
      supportsMetadataScan: false,
      supportsFetchMessage: false,
      supportsMutation: false,
      mutationActions: [],
      maxRecommendedScanLimit: this.runtimeConfig.metadataSampleLimit,
    };
  }

  private error(): Error {
    return new Error(`QFerry provider is not ready: ${this.runtimeConfig.statusWarnings.join("; ")}`);
  }
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

async function main(): Promise<void> {
  const server = createQFerryMcpServer();
  await server.connect(new StdioServerTransport());
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
