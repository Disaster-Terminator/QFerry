import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createMailTools,
  FixtureMailProvider,
  QqReadOnlyProvider,
  type MailProvider,
  type MessageRef,
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
    subjectIncludes: z.string().optional(),
    snippetIncludes: z.string().optional(),
    folderEquals: z.string().optional(),
    hasFlag: z.string().optional(),
  }),
});

export function createQFerryMcpServer(): McpServer {
  const server = new McpServer({
    name: "qferry-chatgpt-app",
    version: "0.0.0",
  });
  const tools = createMailTools({ provider: createProviderFromEnv() });

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
        defaultGroupId: z.string().optional(),
        rules: z.array(classificationRuleSchema).optional(),
        rulesFile: z.string().optional(),
        selectedGroupIds: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await tools.planCleanup(input)),
  );

  return server;
}

function createProviderFromEnv(): MailProvider {
  if (process.env.QFERRY_PROVIDER !== "qqmail") {
    return FixtureMailProvider.demo();
  }

  const user = process.env.QQMAIL_EMAIL;
  const pass = process.env.QQMAIL_KEY;
  if (!user || !pass) {
    throw new Error("QFERRY_PROVIDER=qqmail requires QQMAIL_EMAIL and QQMAIL_KEY");
  }

  return new QqReadOnlyProvider({
    accountAlias: maskEmail(user),
    host: process.env.QQMAIL_IMAP_HOST || "imap.qq.com",
    port: Number.parseInt(process.env.QQMAIL_IMAP_PORT || "993", 10),
    maxRecommendedScanLimit: Number.parseInt(process.env.QQMAIL_METADATA_SAMPLE_LIMIT || "1", 10),
    auth: { user, pass },
  });
}

function maskEmail(value: string): string {
  const [name, domain] = value.split("@", 2);
  if (!domain) return "<account-provided>";
  return `${name.slice(0, 2) || "*"}***@${domain}`;
}

function toToolResult(structuredContent: Record<string, unknown>) {
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent),
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
