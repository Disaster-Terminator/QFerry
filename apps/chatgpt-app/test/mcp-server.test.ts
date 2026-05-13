import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createQFerryMcpServer } from "../src/mcp-server.js";

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
      "preview_cleanup_batch",
      "execute_cleanup",
    ]);
    expect(tools.tools.find((tool) => tool.name === "get_status")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_mailbox_summary")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "triage_inbox")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "group_spam_candidates")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_capability_snapshot")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "plan_cleanup")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "preview_cleanup_batch")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "execute_cleanup")?.annotations?.destructiveHint).toBe(true);

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

  it("blocks execute cleanup through the MCP server until the plan is confirmed", async () => {
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
          operationPlanId: "op-test",
          runId: "run-test",
          provider: "fixture",
          action: "move",
          status: "preview",
          confirmationRequired: true,
          messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }],
          target: { folder: "Archive" },
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("must be confirmed");

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
});
