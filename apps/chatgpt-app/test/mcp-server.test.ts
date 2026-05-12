import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createQFerryMcpServer } from "../src/mcp-server.js";

describe("QFerry ChatGPT App MCP server", () => {
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
      "list_mailboxes",
      "get_capability_snapshot",
      "search",
      "fetch",
      "classify_messages",
      "plan_cleanup",
    ]);
    expect(tools.tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_capability_snapshot")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "plan_cleanup")?.annotations?.destructiveHint).toBe(false);

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
});
