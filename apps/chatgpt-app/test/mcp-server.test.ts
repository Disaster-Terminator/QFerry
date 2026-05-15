import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createQFerryMcpServer } from "../src/mcp-server.js";
import type { MailProvider, MessageSummary } from "@qferry/core";

describe("QFerry ChatGPT App MCP server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, QFERRY_PROVIDER: "fixture", QFERRY_ENV_FILE: "G:\\missing\\qferry.env" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("exposes Gmail-like read-only and preview-first tools", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "get_status",
      "list_mailboxes",
      "get_mailbox_summary",
      "get_capability_snapshot",
      "search",
      "fetch",
      "classify_messages",
      "triage_inbox",
      "group_spam_candidates",
      "plan_cleanup",
      "ensure_classification_folder",
      "preview_cleanup_batch",
      "plan_sender_governance",
      "classification_map",
      "classification_sweep",
      "bulk_governance_preview",
      "apply_ruleset_patch",
      "confirm_cleanup_plan",
      "execute_cleanup",
    ]);
    expect(tools.tools.find((tool) => tool.name === "get_status")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_mailbox_summary")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "triage_inbox")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "group_spam_candidates")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_capability_snapshot")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "classification_map")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "classification_sweep")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "plan_cleanup")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "ensure_classification_folder")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "preview_cleanup_batch")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "plan_sender_governance")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "bulk_governance_preview")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "apply_ruleset_patch")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "confirm_cleanup_plan")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "execute_cleanup")?.annotations?.destructiveHint).toBe(true);

    await client.close();
    await server.close();
  });

  it("calls classification map through the MCP server without creating a plan", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "classification_map",
      arguments: {
        folder: "INBOX",
        pageSize: 2,
        maxPages: 2,
        order: "oldest",
      },
    });

    expect(result.structuredContent).toMatchObject({
      map: {
        scannedMessages: 2,
        categoryCounts: {
          newsletter_or_digest: 1,
          security_or_account: 1,
        },
        buckets: [
          { categoryId: "security_or_account", recommendedAction: "keep_for_account_history" },
          { categoryId: "newsletter_or_digest", recommendedAction: "archive_or_label" },
        ],
        mutationsAttempted: 0,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("operationPlanId");

    await client.close();
    await server.close();
  });

  it("calls classification sweep through the MCP server without returning message refs", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "classification_sweep",
      arguments: {
        folder: "INBOX",
        pageSize: 2,
        maxPages: 2,
        chunkPages: 1,
        order: "oldest",
      },
    });

    expect(result.structuredContent).toMatchObject({
      sweep: {
        scannedMessages: 2,
        categoryCounts: {
          newsletter_or_digest: 1,
          security_or_account: 1,
        },
        chunks: [
          { scanOffset: 0, scannedMessages: 2 },
          { scanOffset: 2, scannedMessages: 0 },
        ],
        mutationsAttempted: 0,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("uid");
    expect(JSON.stringify(result.structuredContent)).not.toContain("operationPlanId");

    await client.close();
    await server.close();
  });

  it("calls bulk governance preview through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "bulk_governance_preview",
      arguments: {
        runId: "mcp-bulk-governance",
        folder: "INBOX",
        pageSize: 2,
        maxPages: 2,
        maxMessageRefs: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedCategoryIds: ["newsletter_or_digest"],
      },
    });

    expect(result.structuredContent).toMatchObject({
      preview: {
        scannedMessages: 2,
        selectedMessageRefs: 1,
        selectedCategoryIds: ["newsletter_or_digest"],
        mutationsAttempted: 0,
      },
      plan: {
        status: "preview",
        source: "bulk_governance",
      },
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("writes preview mailbox snapshots to MCP audit summaries", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-preview-audit-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const messages: MessageSummary[] = [
      {
        ref: { provider: "qqmail", accountAlias: "test", folder: "INBOX", uid: "42", uidValidity: "uv-preview" },
        from: "security@example.com",
        subject: "Security verification code",
        date: "2026-05-15T00:00:00.000Z",
        snippet: "Account verification",
        flags: [],
      },
    ];
    const provider: MailProvider = {
      async listMailboxes() {
        return [];
      },
      async scanMailboxMetadata() {
        return messages;
      },
      async scanMailboxMetadataWindow() {
        return {
          messages,
          pagesScanned: 1,
          mailboxSnapshot: { folder: "INBOX", exists: 2385, uidValidity: "uv-preview" },
        };
      },
      async fetchMessage(ref) {
        return { ...messages[0], ref, bodyText: "" };
      },
    };
    const server = createQFerryMcpServer({ provider });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "bulk_governance_preview",
      arguments: {
        runId: "run-mcp-preview-snapshot",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefs: 50,
        action: "move",
        target: { folder: "其他文件夹/账号安全" },
        selectedCategoryIds: ["security_or_account"],
      },
    });

    const audit = result.structuredContent as { audit?: { summaryPath?: string; tracePath?: string } };
    const summary = await readFile(audit.audit?.summaryPath ?? "", "utf8");
    expect(summary).toContain("- selectedMessageRefs: 1");
    expect(summary).toContain('- mailboxSnapshot: {"folder":"INBOX","exists":2385,"uidValidity":"uv-preview"}');
    expect(summary).toContain('"security_or_account":1');
    const trace = await readFile(audit.audit?.tracePath ?? "", "utf8");
    expect(trace).toContain('"mailboxSnapshot":{"folder":"INBOX","exists":2385,"uidValidity":"uv-preview"}');

    await client.close();
    await server.close();
  });

  it("calls runtime status through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({ name: "get_status", arguments: {} });

    expect(result.structuredContent).toMatchObject({
      status: {
        provider: "fixture",
        configSource: "env",
        mutationAllowed: false,
      },
    });

    await client.close();
    await server.close();
  });

  it("calls fixture search without returning message bodies", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "search",
      arguments: { folder: "INBOX", limit: 10, query: "digest" },
    });

    expect(result.structuredContent).toMatchObject({
      messages: [
        {
          subject: "Weekly digest",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("fixture full body");

    await client.close();
    await server.close();
  });

  it("rejects QQ message refs without UIDVALIDITY at the MCP schema boundary", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "fetch",
      arguments: {
        provider: "qqmail",
        accountAlias: "25***@qq.com",
        folder: "INBOX",
        uid: "123",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("uidValidity");

    await client.close();
    await server.close();
  });

  it("passes search offsets through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "search",
      arguments: { folder: "INBOX", limit: 1, order: "oldest", offset: 1 },
    });

    expect(result.structuredContent).toMatchObject({
      messages: [
        {
          subject: "Security alert",
        },
      ],
    });

    await client.close();
    await server.close();
  });

  it("passes structured search filters through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "search",
      arguments: {
        folder: "INBOX",
        limit: 10,
        fromIncludes: "newsletter@",
        fromDomainIncludes: "example.com",
        subjectIncludes: "digest",
        hasFlag: "\\Seen",
      },
    });

    expect(result.structuredContent).toMatchObject({
      messages: [
        {
          subject: "Weekly digest",
        },
      ],
    });

    await client.close();
    await server.close();
  });

  it("calls mailbox summary through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "get_mailbox_summary",
      arguments: { folder: "INBOX" },
    });

    expect(result.structuredContent).toMatchObject({
      mailbox: {
        path: "INBOX",
        exists: 2,
      },
    });

    await client.close();
    await server.close();
  });

  it("calls capability snapshot through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({ name: "get_capability_snapshot", arguments: {} });

    expect(result.structuredContent).toMatchObject({
      capability: {
        provider: "fixture",
        supportsMutation: false,
      },
    });

    await client.close();
    await server.close();
  });

  it("calls read-only inbox triage through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "triage_inbox",
      arguments: {
        folder: "INBOX",
        limit: 10,
        defaultGroupId: "review",
        rules: [{
          id: "newsletter",
          groupId: "newsletter",
          match: { fromIncludes: "newsletter@" },
          priority: {
            bucketId: "bulk",
            reason: "Configured newsletter sender rule",
            confidence: "high",
            weight: 42,
            nextAction: "Archive after confirming this sender is expected",
          },
        }],
      },
    });

    expect(result.structuredContent).toMatchObject({
      triage: {
        provider: "fixture",
        sampledMessages: 2,
        mutationsAttempted: 0,
      },
      priorityCounts: {
        urgent: 1,
        bulk: 1,
      },
      priorityBuckets: [
        { id: "urgent" },
        { id: "needs_review" },
        { id: "waiting" },
        { id: "fyi" },
        {
          id: "bulk",
          candidates: [
            {
              reason: "Configured newsletter sender rule",
              confidence: "high",
              weight: 42,
              nextAction: "Archive after confirming this sender is expected",
            },
          ],
        },
      ],
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("groups oldest spam candidates through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "group_spam_candidates",
      arguments: {
        folder: "INBOX",
        limit: 10,
        rules: [{ id: "newsletter", groupId: "ads_or_newsletters", match: { fromIncludes: "newsletter@" } }],
      },
    });

    expect(result.structuredContent).toMatchObject({
      folder: "INBOX",
      scanOrder: "oldest",
      mutationsAttempted: 0,
      sampledMessages: [
        {
          subject: "Weekly digest",
        },
        {
          subject: "Security alert",
        },
      ],
      groups: {
        ads_or_newsletters: [
          {
            matchedRuleId: "newsletter",
          },
        ],
      },
    });

    await client.close();
    await server.close();
  });

  it("passes spam candidate offsets through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "group_spam_candidates",
      arguments: {
        folder: "INBOX",
        limit: 1,
        offset: 1,
        rules: [{ id: "security", groupId: "attention", match: { subjectIncludes: "Security" } }],
      },
    });

    expect(result.structuredContent).toMatchObject({
      folder: "INBOX",
      scanOrder: "oldest",
      scanOffset: 1,
      groups: {
        attention: [
          {
            matchedRuleId: "security",
          },
        ],
      },
    });

    await client.close();
    await server.close();
  });

  it("blocks execute cleanup through the MCP server until a server-side plan is confirmed", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "execute_cleanup",
      arguments: {
        operationPlanId: "op-test",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("not found");

    await client.close();
    await server.close();
  });

  it("rejects forged confirmed cleanup plans through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "execute_cleanup",
      arguments: {
        plan: {
          operationPlanId: "op-forged",
          runId: "run-test",
          provider: "fixture",
          action: "move",
          status: "confirmed",
          confirmationRequired: false,
          messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }],
          target: { folder: "Archive" },
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("operationPlanId");

    await client.close();
    await server.close();
  });

  it("confirms cleanup plans through server-side state", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "run-confirm-flow",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);

    const confirmed = await client.callTool({
      name: "confirm_cleanup_plan",
      arguments: { operationPlanId },
    });

    expect(confirmed.structuredContent).toMatchObject({
      plan: {
        operationPlanId,
        status: "confirmed",
        confirmationRequired: false,
      },
    });

    await client.close();
    await server.close();
  });

  it("previews classification folder creation through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "ensure_classification_folder",
      arguments: {
        runId: "run-mcp-folder-preview",
        displayName: "开发社区",
      },
    });

    expect(result.structuredContent).toMatchObject({
      folder: {
        displayName: "开发社区",
        fullPath: "其他文件夹/开发社区",
        exists: false,
      },
      plan: {
        action: "create_folder",
        status: "preview",
        target: {
          folder: "其他文件夹/开发社区",
          displayName: "开发社区",
        },
      },
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("consumes confirmed cleanup plans after one execute attempt", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "run-single-consume",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);

    await client.callTool({
      name: "confirm_cleanup_plan",
      arguments: { operationPlanId },
    });

    const firstExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId },
    });
    expect(firstExecute.isError).toBe(true);
    expect(JSON.stringify(firstExecute.content)).toContain("does not support mailbox mutation");

    const secondExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId },
    });
    expect(secondExecute.isError).toBe(true);
    expect(JSON.stringify(secondExecute.content)).toContain("already consumed");

    await client.close();
    await server.close();
  });

  it("keeps partially executed cleanup plans resumable through the MCP server", async () => {
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "newsletter@example.com",
        subject: "Promo one",
        date: "2020-01-01T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "newsletter@example.com",
        subject: "Promo two",
        date: "2020-01-02T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "newsletter@example.com",
        subject: "Promo three",
        date: "2020-01-03T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const movedBatches: unknown[] = [];
    const counts = new Map([
      ["INBOX", 3],
      ["Archive", 0],
    ]);
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [{ path: "INBOX", name: "INBOX" }, { path: "Archive", name: "Archive" }],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({
          ref,
          from: "newsletter@example.com",
          subject: "Promo",
          date: "2020-01-01T00:00:00.000Z",
          snippet: "",
          flags: [],
          bodyText: "",
        }),
        getMailboxSummary: async (folder) => ({ path: folder, exists: counts.get(folder) ?? 0 }),
        getCapabilitySnapshot: async () => ({
          provider: "fixture",
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 10,
        }),
        moveMessages: async (refs, targetFolder) => {
          movedBatches.push(refs);
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "run-resumable-execute",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [{ id: "promo", groupId: "archive", match: { subjectIncludes: "Promo" } }],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });

    const firstExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 2 },
    });
    expect(firstExecute.structuredContent).toMatchObject({
      result: {
        operationPlanId,
        status: "partially_executed",
        attemptedMessages: 2,
        moved: 2,
        remainingMessages: 1,
      },
    });

    const secondExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 2 },
    });
    expect(secondExecute.structuredContent).toMatchObject({
      result: {
        operationPlanId,
        status: "executed",
        attemptedMessages: 1,
        moved: 1,
        remainingMessages: 0,
      },
    });

    const thirdExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId },
    });
    expect(thirdExecute.isError).toBe(true);
    expect(JSON.stringify(thirdExecute.content)).toContain("already consumed");
    expect(movedBatches).toEqual([
      [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
      [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "3" }],
    ]);

    await client.close();
    await server.close();
  });

  it("allows 50-message cleanup execution batches through the MCP server", async () => {
    const messages: MessageSummary[] = Array.from({ length: 60 }, (_, index) => ({
      ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: String(index + 1) },
      from: "Codeforces <noreply@codeforces.com>",
      subject: `Codeforces notification ${index + 1}`,
      date: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
      snippet: "",
      flags: [],
    }));
    const movedBatches: unknown[] = [];
    const counts = new Map([
      ["INBOX", 60],
      ["Archive", 0],
    ]);
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [{ path: "INBOX", name: "INBOX" }, { path: "Archive", name: "Archive" }],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({
          ref,
          from: "Codeforces <noreply@codeforces.com>",
          subject: "Codeforces notification",
          date: "2020-01-01T00:00:00.000Z",
          snippet: "",
          flags: [],
          bodyText: "",
        }),
        getMailboxSummary: async (folder) => ({ path: folder, exists: counts.get(folder) ?? 0 }),
        getCapabilitySnapshot: async () => ({
          provider: "fixture",
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        }),
        moveMessages: async (refs, targetFolder) => {
          movedBatches.push(refs);
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "bulk_governance_preview",
      arguments: {
        runId: "run-50-message-execute",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 2,
        maxMessageRefs: 60,
        action: "move",
        target: { folder: "Archive" },
        selectedCategoryIds: ["developer_community"],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });

    const firstExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 50 },
    });

    expect(firstExecute.structuredContent).toMatchObject({
      result: {
        operationPlanId,
        status: "partially_executed",
        attemptedMessages: 50,
        moved: 50,
        remainingMessages: 10,
      },
    });
    expect(movedBatches).toHaveLength(1);
    expect((movedBatches[0] as unknown[])).toHaveLength(50);

    await client.close();
    await server.close();
  });

  it("writes trace artifacts for confirmed MCP cleanup execution", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-trace-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "newsletter@example.com",
        subject: "Promo one",
        date: "2020-01-01T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const counts = new Map([
      ["INBOX", 1],
      ["Archive", 0],
    ]);
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [{ path: "INBOX", name: "INBOX" }, { path: "Archive", name: "Archive" }],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({
          ref,
          from: "newsletter@example.com",
          subject: "Promo",
          date: "2020-01-01T00:00:00.000Z",
          snippet: "",
          flags: [],
          bodyText: "",
        }),
        getMailboxSummary: async (folder) => ({ path: folder, exists: counts.get(folder) ?? 0 }),
        getCapabilitySnapshot: async () => ({
          provider: "fixture",
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 10,
        }),
        moveMessages: async (refs, targetFolder) => {
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "run-mcp-trace-execute",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [{ id: "promo", groupId: "archive", match: { subjectIncludes: "Promo" } }],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });

    const execute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 1 },
    });

    expect(execute.structuredContent).toMatchObject({
      audit: {
        runId: "run-mcp-trace-execute",
      },
      result: {
        status: "executed",
        moved: 1,
      },
    });
    const audit = execute.structuredContent as { audit?: { tracePath?: string; summaryPath?: string } };
    expect(audit.audit?.tracePath).toBe(join(traceRoot, "logs", "runs", "run-mcp-trace-execute.jsonl"));
    expect(audit.audit?.summaryPath).toBe(join(traceRoot, "artifacts", "e2e", "run-mcp-trace-execute", "summary.md"));
    const trace = await readFile(audit.audit?.tracePath ?? "", "utf8");
    expect(trace).toContain("\"toolName\":\"execute_cleanup\"");
    expect(trace).toContain("\"mutationsAttempted\":1");
    const summary = await readFile(audit.audit?.summaryPath ?? "", "utf8");
    expect(summary).toContain("# QFerry MCP Audit run-mcp-trace-execute");
    expect(summary).toContain("- lastTool: execute_cleanup");

    await client.close();
    await server.close();
  });

  it("previews cleanup batches through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "preview_cleanup_batch",
      arguments: {
        runId: "run-mcp-batch-preview",
        folder: "INBOX",
        pageSize: 1,
        maxPages: 2,
        maxMessageRefs: 1,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [
          { id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } },
          { id: "security", groupId: "archive", match: { subjectIncludes: "Security" } },
        ],
      },
    });

    expect(result.structuredContent).toMatchObject({
      preview: {
        provider: "fixture",
        folder: "INBOX",
        pagesScanned: 2,
        scannedMessages: 2,
        selectedMessageRefs: 1,
        mutationsAttempted: 0,
      },
      plan: {
        status: "preview",
        confirmationRequired: true,
        messageRefs: [
          { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        ],
      },
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("accepts 50-message pages for rules-based cleanup previews", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "preview_cleanup_batch",
      arguments: {
        runId: "run-mcp-batch-preview-50",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefs: 50,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: ["archive"],
        rules: [
          { id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } },
        ],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      preview: {
        pageSize: 50,
        maxMessageRefs: 50,
      },
    });

    await client.close();
    await server.close();
  });

  it("uses ruleset group target folders in MCP cleanup previews", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mcp-rules-target-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "mcp-target",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "newsletter", label: "订阅摘要", target: { folder: "其他文件夹/订阅摘要" } },
      ],
      rules: [{ id: "newsletter", groupId: "newsletter", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "preview_cleanup_batch",
      arguments: {
        runId: "run-mcp-rules-target",
        folder: "INBOX",
        pageSize: 10,
        maxPages: 1,
        maxMessageRefs: 10,
        action: "move",
        rulesFile,
        selectedGroupIds: ["newsletter"],
      },
    });

    expect(result.structuredContent).toMatchObject({
      preview: {
        selectedGroupTargets: {
          newsletter: { folder: "其他文件夹/订阅摘要" },
        },
      },
      plan: {
        target: { folder: "其他文件夹/订阅摘要" },
      },
    });
    const content = result.structuredContent as { audit?: { summaryPath?: string } };
    const summary = await readFile(content.audit?.summaryPath ?? "", "utf8");
    expect(summary).toContain("- target: {\"folder\":\"其他文件夹/订阅摘要\"}");
    expect(summary).toContain("- selectedGroupTargets: {\"newsletter\":{\"folder\":\"其他文件夹/订阅摘要\"}}");

    await client.close();
    await server.close();
  });

  it("plans sender governance through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "plan_sender_governance",
      arguments: {
        runId: "run-mcp-sender-governance",
        folder: "INBOX",
        pageSize: 1,
        maxPages: 2,
        maxMessageRefs: 1,
        action: "move",
        target: { folder: "Archive" },
        selectedSenderDomains: ["example.com"],
      },
    });

    expect(result.structuredContent).toMatchObject({
      governance: {
        provider: "fixture",
        folder: "INBOX",
        scannedMessages: 2,
        selectedMessageRefs: 1,
        serverBlocklistCapability: { supported: false },
        domainCandidates: [
          {
            domain: "example.com",
            suggestedRule: {
              match: { fromDomainIncludes: "example.com" },
            },
          },
        ],
        mutationsAttempted: 0,
      },
      rulesetPatch: {
        groupToEnsure: { id: "sender_governance", label: "Sender governance" },
        candidateRuleCount: 1,
        rulesToAdd: [
          {
            id: "sender-domain-example-com",
            groupId: "sender_governance",
            match: { fromDomainIncludes: "example.com" },
          },
        ],
        renderedDraft: {
          groups: [
            { id: "review", label: "Needs review" },
            { id: "sender_governance", label: "Sender governance" },
          ],
          rules: [
            {
              id: "sender-domain-example-com",
              groupId: "sender_governance",
              match: { fromDomainIncludes: "example.com" },
            },
          ],
        },
        changelog: "groupToEnsure: sender_governance\ncandidateRuleCount: 1\nrulesToAdd: 1\n+ rule sender-domain-example-com (fromDomainIncludes: example.com)\nskippedDuplicateRules: 0",
      },
      plan: {
        status: "preview",
        confirmationRequired: true,
        messageRefs: [
          { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        ],
      },
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("dry-runs ruleset patch application through the MCP server", async () => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "qferry-mcp-rules-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Needs review" }],
      rules: [{ id: "keep", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, null, 2)}\n`, "utf8");
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "apply_ruleset_patch",
      arguments: {
        rulesFile,
        apply: false,
        patch: {
          groupToEnsure: { id: "sender_governance", label: "Sender governance" },
          candidateRuleCount: 1,
          rulesToAdd: [
            { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
          ],
          skippedDuplicateRules: [],
        },
      },
    });

    expect(result.structuredContent).toMatchObject({
      applied: false,
      beforeRuleCount: 1,
      afterRuleCount: 2,
      addedRuleCount: 1,
    });
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules).toHaveLength(1);

    await client.close();
    await server.close();
  });

  it("rejects applying ruleset patches to non-ruleset files", async () => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "qferry-mcp-rules-"));
    const rulesFile = join(dir, "not-rules.txt");
    const original = `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Needs review" }],
      rules: [{ id: "keep", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, null, 2)}\n`;
    await writeFile(rulesFile, original, "utf8");
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "apply_ruleset_patch",
      arguments: {
        rulesFile,
        apply: true,
        patch: {
          groupToEnsure: { id: "sender_governance", label: "Sender governance" },
          candidateRuleCount: 1,
          rulesToAdd: [
            { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
          ],
          skippedDuplicateRules: [],
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("qferry.rules.json");
    expect(await readFile(rulesFile, "utf8")).toBe(original);

    await client.close();
    await server.close();
  });
});
