import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createMailTools,
  applyRulesetPatchDraft,
  FixtureMailProvider,
  loadQFerryRuntimeConfigSync,
  loadQFerryRuntimeSecretsSync,
  QqMutableProvider,
  type MailProvider,
  type MessageRef,
  type QFerryRuntimeConfig,
} from "@qferry/core";
import { pathToFileURL } from "node:url";

const messageRefSchema = z.object({
  provider: z.enum(["fixture", "qqmail", "gmail"]),
  accountAlias: z.string(),
  folder: z.string(),
  uid: z.string(),
  uidValidity: z.string().optional(),
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

const operationPlanSchema = z.object({
  operationPlanId: z.string(),
  runId: z.string(),
  provider: z.enum(["fixture", "qqmail", "gmail"]),
  action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
  status: z.enum(["preview", "confirmed"]),
  confirmationRequired: z.boolean(),
  messageRefs: z.array(messageRefSchema),
  target: z.record(z.string(), z.string()).optional(),
});

const rulesetPatchSchema = z.object({
  groupToEnsure: z.object({
    id: z.literal("sender_governance"),
    label: z.literal("Sender governance"),
  }),
  candidateRuleCount: z.number().int().min(0),
  rulesToAdd: z.array(classificationRuleSchema),
  skippedDuplicateRules: z.array(z.object({
    ruleId: z.string(),
    reason: z.literal("match already covered by existing rule"),
    match: classificationRuleSchema.shape.match,
  })),
});

export function createQFerryMcpServer(): McpServer {
  const server = new McpServer({
    name: "qferry-chatgpt-app",
    version: "0.0.0",
  });
  const runtimeConfig = loadQFerryRuntimeConfigSync();
  const tools = createMailTools({ provider: createProviderFromConfig(runtimeConfig), runtimeConfig });

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
    async (input) => toToolResult(await tools.planCleanup(input)),
  );

  server.registerTool(
    "preview_cleanup_batch",
    {
      title: "Preview cleanup batch",
      description: "Use this when you need a cross-page rules preview and bounded cleanup plan before any real mailbox mutation.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(20),
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
    async (input) => toToolResult(await tools.previewCleanupBatch(input)),
  );

  server.registerTool(
    "plan_sender_governance",
    {
      title: "Plan sender governance",
      description: "Use this when you need bounded sender/domain governance candidates, local rule suggestions, and a preview-only cleanup plan while recording that server-side QQ blocklist is not exposed.",
      inputSchema: {
        runId: z.string(),
        folder: z.string(),
        pageSize: z.number().int().min(1).max(20),
        maxPages: z.number().int().min(1).max(200),
        maxMessageRefs: z.number().int().min(0).max(200),
        action: z.enum(["move", "mark_read", "mark_unread", "create_folder"]),
        target: z.record(z.string(), z.string()).optional(),
        scanOffset: z.number().int().min(0).optional(),
        order: z.enum(["newest", "oldest"]).optional(),
        selectedSenderDomains: z.array(z.string()).optional(),
        selectedFromIncludes: z.array(z.string()).optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.planSenderGovernance(input)),
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
    "execute_cleanup",
    {
      title: "Execute cleanup",
      description: "Use this only after a cleanup plan is explicitly confirmed. Only move actions are currently supported.",
      inputSchema: {
        plan: operationPlanSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.executeCleanup(input)),
  );

  return server;
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
