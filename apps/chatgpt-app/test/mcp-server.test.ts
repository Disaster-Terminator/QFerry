import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
      "plan_high_yield_governance",
      "plan_mailbox_governance_campaign",
      "campaign_workflow",
      "sender_breakdown",
      "classification_map",
      "classification_sweep",
      "bulk_governance_preview",
      "ruleset_governance_preview",
      "ruleset_governance_campaign_preview",
      "apply_ruleset_patch",
      "confirm_cleanup_plan",
      "render_sensitive_cleanup_panel",
      "execute_sensitive_cleanup_from_ui",
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
    expect(tools.tools.find((tool) => tool.name === "plan_high_yield_governance")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "plan_mailbox_governance_campaign")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "campaign_workflow")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "sender_breakdown")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "bulk_governance_preview")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "ruleset_governance_preview")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "ruleset_governance_campaign_preview")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "apply_ruleset_patch")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "confirm_cleanup_plan")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "render_sensitive_cleanup_panel")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "render_sensitive_cleanup_panel")?._meta).toMatchObject({
      "openai/outputTemplate": "ui://qferry/sensitive-cleanup.v7.html",
    });
    expect(tools.tools.find((tool) => tool.name === "execute_sensitive_cleanup_from_ui")?.annotations?.destructiveHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "execute_sensitive_cleanup_from_ui")?._meta).toMatchObject({
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
      "openai/visibility": "private",
    });
    expect(tools.tools.find((tool) => tool.name === "execute_cleanup")?.annotations?.destructiveHint).toBe(true);

    await client.close();
    await server.close();
  });

  it("exposes a ChatGPT app UI resource for sensitive cleanup", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const resources = await client.listResources();
    expect(resources.resources).toContainEqual(expect.objectContaining({
      uri: "ui://qferry/sensitive-cleanup.v7.html",
      mimeType: "text/html",
    }));

    const resource = await client.readResource({ uri: "ui://qferry/sensitive-cleanup.v7.html" });
    expect(resource.contents[0]).toMatchObject({
      uri: "ui://qferry/sensitive-cleanup.v7.html",
      mimeType: "text/html;profile=mcp-app",
    });
    const html = (resource.contents[0] as { text?: string }).text ?? "";
    expect(html).toContain("execute_sensitive_cleanup_from_ui");
    expect(html).toContain("Move planned mail");
    expect(html).toContain("Done");
    expect(html).toContain("No remaining sensitive mail in this plan.");
    expect(html).toContain("completed");
    expect(html).toContain("qferry-ui v2026-06-20-1620");
    expect(html).toContain("plan none");
    expect(html).toContain("shortPlanId");
    expect(html).toContain("remaining ");
    expect(html).toContain("notifyIntrinsicHeight");
    expect(html).toContain("syncOpenAiState");
    expect(html).toContain("openai:set_globals");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("hydrateBridgePayload");
    expect(html).toContain("mergedPlanData");
    expect(html).toContain("zeroCategories");
    expect(html).toContain("toolResponseMetadata");
    expect(html).not.toContain("Move selected mail");
    expect(html).not.toContain("No sensitive cleanup plan is loaded");

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
      workflowWarning: {
        code: "legacy_discovery_helper",
      },
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
    expect(JSON.stringify(result.structuredContent)).not.toContain("renderedDraft");

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
      workflowWarning: {
        code: "legacy_discovery_helper",
      },
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
      workflowWarning: {
        code: "legacy_discovery_helper",
      },
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

  it("calls ruleset governance preview through the MCP server", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-ruleset-governance-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const rulesFile = join(traceRoot, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "rules-governance",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "group_alpha", label: "Group Alpha", target: { folder: "Folders/Group Alpha" } },
        { id: "group_beta", label: "Group Beta", target: { folder: "Folders/Group Beta" } },
      ],
      rules: [
        { id: "alpha-domain", groupId: "group_alpha", match: { fromDomainIncludes: "alpha.example" } },
        { id: "beta-domain", groupId: "group_beta", match: { fromDomainIncludes: "beta.example" } },
      ],
    }), "utf8");
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Alpha One <one@alpha.example>",
        subject: "Alpha one",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Beta <notice@beta.example>",
        subject: "Beta",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "",
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
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
        };
      },
      async fetchMessage() {
        throw new Error("not used");
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
      name: "ruleset_governance_preview",
      arguments: {
        runId: "mcp-ruleset-governance",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefsPerGroup: 50,
        action: "move",
        rulesFile,
        selectedGroupIds: ["group_alpha", "group_beta"],
      },
    });

    const content = result.structuredContent as {
      plans?: Array<{ operationPlanId: string }>;
      audit?: { summaryPath: string };
      preview?: {
        campaignReport?: {
          scannedMessages: number;
          plannedMessages: number;
          alreadyInTargetMessages: number;
          unplannedMessages: number;
          coverageBasis: string;
          coverageRatio: number;
          planCount: number;
          truncatedGroups: Array<{ groupId: string; selectedMessageRefs: number; totalMatchedMessages: number }>;
          topUnplannedDomains: Array<{ domain: string; messageCount: number }>;
          topUnplannedSenders: Array<{
            sender: string;
            domain: string;
            messageCount: number;
            sampleSubjects: string[];
          }>;
          nextAction: string;
        };
        groupPlans?: Array<{ groupId: string; operationPlanId: string }>;
      };
    };
    expect(content.plans).toHaveLength(2);
    expect(content.preview?.groupPlans?.map((plan) => plan.groupId)).toEqual(["group_alpha", "group_beta"]);
    expect(content.preview?.campaignReport).toEqual({
      scannedMessages: 2,
      plannedMessages: 2,
      alreadyInTargetMessages: 0,
      unplannedMessages: 0,
      coverageBasis: "scanned_window",
      coverageRatio: 1,
      planCount: 2,
      truncatedGroups: [],
      topUnplannedDomains: [],
      topUnplannedSenders: [],
      nextAction: "confirm_plans",
    });
    expect((result.structuredContent as { classifications?: unknown[] }).classifications).toBeUndefined();
    expect(JSON.stringify(result.structuredContent)).not.toContain("legacy_discovery_helper");
    const summary = await readFile(String(content.audit?.summaryPath), "utf8");
    expect(summary).toContain("- operationPlanIds: [");
    expect(summary).toContain("- campaignReport: {");
    expect(summary).toContain("- groupPlans: [");
    expect(summary).not.toContain("classifications");

    await client.close();
    await server.close();
  });

  it("accepts inline groups for ruleset governance preview through the MCP server", async () => {
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Alpha One <one@alpha.example>",
        subject: "Alpha one",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "",
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
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
        };
      },
      async fetchMessage() {
        throw new Error("not used");
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
      name: "ruleset_governance_preview",
      arguments: {
        runId: "mcp-ruleset-governance-inline-groups",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefsPerGroup: 50,
        action: "move",
        defaultGroupId: "review",
        groups: [
          { id: "review", label: "Review" },
          { id: "group_alpha", label: "Group Alpha", target: { folder: "Folders/Group Alpha" } },
        ],
        rules: [
          { id: "alpha-domain", groupId: "group_alpha", match: { fromDomainIncludes: "alpha.example" } },
        ],
        selectedGroupIds: ["group_alpha"],
      },
    });

    expect(result.structuredContent).toMatchObject({
      preview: {
        campaignReport: {
          plannedMessages: 1,
          planCount: 1,
        },
        groupPlans: [
          {
            groupId: "group_alpha",
            target: { folder: "Folders/Group Alpha" },
            selectedMessageRefs: 1,
          },
        ],
      },
    });

    await client.close();
    await server.close();
  });

  it("calls compact ruleset governance campaign preview through the MCP server", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-ruleset-campaign-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const rulesFile = join(traceRoot, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "rules-campaign",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "group_alpha", label: "Group Alpha", target: { folder: "Folders/Group Alpha" } },
        { id: "group_beta", label: "Group Beta", target: { folder: "Folders/Group Beta" } },
      ],
      rules: [
        { id: "alpha-domain", groupId: "group_alpha", match: { fromDomainIncludes: "alpha.example" } },
        { id: "beta-domain", groupId: "group_beta", match: { fromDomainIncludes: "beta.example" } },
      ],
    }), "utf8");
    const folderMessages: Record<string, MessageSummary[]> = {
      INBOX: [
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
          from: "Alpha One <one@alpha.example>",
          subject: "Alpha one",
          date: "2026-05-10T00:00:00.000Z",
          snippet: "",
          flags: [],
        },
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
          from: "Beta <notice@beta.example>",
          subject: "Beta",
          date: "2026-05-11T00:00:00.000Z",
          snippet: "",
          flags: [],
        },
      ],
      Archive: [
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "Archive", uid: "3" },
          from: "Human <human@example.net>",
          subject: "Manual review",
          date: "2026-05-12T00:00:00.000Z",
          snippet: "",
          flags: [],
        },
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "Archive", uid: "4" },
          from: "Ops <ops@example.org>",
          subject: "Ops review",
          date: "2026-05-13T00:00:00.000Z",
          snippet: "",
          flags: [],
        },
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "Archive", uid: "5" },
          from: "Other <other@example.dev>",
          subject: "Other review",
          date: "2026-05-14T00:00:00.000Z",
          snippet: "",
          flags: [],
        },
      ],
    };
    const provider: MailProvider = {
      async listMailboxes() {
        return [];
      },
      async scanMailboxMetadata({ folder }) {
        return folderMessages[folder] ?? [];
      },
      async scanMailboxMetadataWindow({ folder }) {
        return {
          messages: folderMessages[folder] ?? [],
          pagesScanned: 1,
          mailboxSnapshot: { folder, exists: folderMessages[folder]?.length ?? 0 },
        };
      },
      async fetchMessage() {
        throw new Error("not used");
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
      name: "ruleset_governance_campaign_preview",
      arguments: {
        runId: "mcp-ruleset-campaign",
        folders: ["Archive", "INBOX"],
        pageSize: 50,
        maxPagesPerFolder: 1,
        maxMessageRefsPerGroup: 50,
        maxConcurrentFolders: 2,
        maxUnplannedHintsPerFolder: 1,
        action: "move",
        rulesFile,
        selectedGroupIds: ["group_alpha", "group_beta"],
      },
    });

    const content = result.structuredContent as {
      plans?: unknown[];
      classifications?: unknown[];
      campaign?: {
        selectedGroupIds?: string[];
        folderReports?: Array<{
          folder: string;
          plannedMessages: number;
          operationPlanIds: string[];
          groupPlans?: Array<{ runId: string }>;
          selectedGroupIds?: string[];
          skippedGroups?: Array<{ reason: string }>;
          topUnplannedDomains?: Array<{ domain: string; messageCount: number }>;
          topUnplannedSenders?: Array<{ sender: string; domain: string; messageCount: number }>;
          skippedGroupSummary?: {
            noMatchedMessages: number;
          };
        }>;
        maxUnplannedHintsPerFolder?: number;
        scannedMessages?: number;
        plannedMessages?: number;
        executablePlanCount?: number;
      };
      audit?: { summaryPath: string };
    };
    expect(content.plans).toBeUndefined();
    expect(content.classifications).toBeUndefined();
    expect(content.campaign?.maxUnplannedHintsPerFolder).toBe(1);
    expect(content.campaign?.scannedMessages).toBe(5);
    expect(content.campaign?.plannedMessages).toBe(2);
    expect(content.campaign?.executablePlanCount).toBe(2);
    expect(content.campaign?.selectedGroupIds).toEqual(["group_alpha", "group_beta"]);
    expect(content.campaign?.folderReports?.map((report) => report.folder)).toEqual(["INBOX", "Archive"]);
    expect(content.campaign?.folderReports?.[0]?.operationPlanIds).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(content.campaign?.folderReports?.[0]?.selectedGroupIds).toBeUndefined();
    expect(content.campaign?.folderReports?.[1]?.skippedGroups).toEqual([]);
    expect(content.campaign?.folderReports?.[1]?.skippedGroupSummary?.noMatchedMessages).toBe(2);
    expect(content.campaign?.folderReports?.[1]?.topUnplannedDomains).toHaveLength(1);
    expect(content.campaign?.folderReports?.[1]?.topUnplannedSenders).toHaveLength(1);
    expect(content.campaign?.folderReports?.[0]?.groupPlans?.map((plan) => plan.runId)).toEqual([
      "mcp-ruleset-campaign-inbox-group-alpha",
      "mcp-ruleset-campaign-inbox-group-beta",
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain("\"messageRefs\"");
    const summary = await readFile(String(content.audit?.summaryPath), "utf8");
    expect(summary).toContain("- operationPlanIds: [");
    expect(summary).toContain("- folderReports: [");
    expect(summary).not.toContain("classifications");

    await client.close();
    await server.close();
  });

  it("runs campaign workflow through the MCP server and registers preview plans", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-campaign-workflow-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const rulesFile = join(traceRoot, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "workflow-mcp-test-rules",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
      ],
      rules: [{ id: "review-placeholder", groupId: "review", match: { subjectIncludes: "__never_match__" } }],
    }), "utf8");
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "campaign_workflow",
      arguments: {
        runId: "mcp-campaign-workflow-test",
        folders: ["INBOX"],
        pageSize: 50,
        maxPagesPerFolder: 1,
        minMessageCount: 1,
        maxCandidatesPerFolder: 3,
        maxDistinctSendersForDomainRule: 1,
        rulesFile,
        ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
        breakdownMixedDomains: {
          enabled: true,
          draftSenderRules: true,
          minSenderMessageCount: 1,
          maxSenderCandidatesPerDomain: 10,
        },
        applyRulesetPatch: false,
        preview: {
          enabled: true,
          selectedGroupIds: ["bulk_platform"],
          maxMessageRefsPerGroup: 50,
          maxUnplannedHintsPerFolder: 1,
        },
      },
    });

    const content = result.structuredContent as {
      plans?: unknown[];
      workflow?: {
        phases?: string[];
        rulesetPatch?: { addedRuleCount?: number; applied?: boolean };
        mixedDomainBreakdowns?: Array<{ draftSenderRules: boolean; selectedSenderRules: number }>;
        preview?: {
          campaign?: {
            plannedMessages?: number;
            executablePlanCount?: number;
            folderReports?: Array<{ operationPlanIds?: string[] }>;
          };
        };
        mutationsAttempted?: number;
      };
      mutationsAttempted?: number;
      audit?: { summaryPath: string };
    };
    expect(content.plans).toBeUndefined();
    expect(content.workflow?.phases).toEqual(["discovery", "mixed_domain_breakdown", "ruleset_patch", "preview"]);
    expect(content.workflow?.rulesetPatch).toMatchObject({ applied: false, addedRuleCount: 2 });
    expect(content.workflow?.mixedDomainBreakdowns?.[0]).toMatchObject({
      draftSenderRules: true,
      selectedSenderRules: 2,
    });
    expect(content.workflow?.preview?.campaign?.plannedMessages).toBeGreaterThan(0);
    expect(content.workflow?.preview?.campaign?.executablePlanCount).toBe(1);
    expect(content.workflow?.mutationsAttempted).toBe(0);
    expect(content.mutationsAttempted).toBe(0);
    expect(JSON.stringify(result.structuredContent)).not.toContain("\"messageRefs\"");

    const operationPlanId = content.workflow?.preview?.campaign?.folderReports?.[0]?.operationPlanIds?.[0];
    expect(operationPlanId).toEqual(expect.any(String));
    const summary = await readFile(String(content.audit?.summaryPath), "utf8");
    expect(summary).toContain(String(operationPlanId));
    expect(summary).toContain("- operationPlanIds: [");
    expect(summary).toContain("- folderReports: [");
    const confirmed = await client.callTool({
      name: "confirm_cleanup_plan",
      arguments: { operationPlanId },
    });
    expect(confirmed.structuredContent).toMatchObject({
      plan: {
        operationPlanId,
        status: "confirmed",
      },
    });

    await client.close();
    await server.close();
  });

  it("rejects invalid ruleset campaign unplanned hint limits at the MCP schema boundary", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "ruleset_governance_campaign_preview",
      arguments: {
        runId: "mcp-ruleset-campaign-invalid-hints",
        folders: ["INBOX"],
        pageSize: 50,
        maxPagesPerFolder: 1,
        maxMessageRefsPerGroup: 50,
        maxUnplannedHintsPerFolder: 11,
        action: "move",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("maxUnplannedHintsPerFolder");

    await client.close();
    await server.close();
  });

  it("returns ruleset governance classifications only when explicitly requested", async () => {
    const rulesFile = join(await mkdtemp(join(tmpdir(), "qferry-mcp-ruleset-verbose-")), "rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "1",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "alpha", label: "Alpha", target: { folder: "Folders/Alpha" } },
      ],
      rules: [
        { id: "alpha-domain", groupId: "alpha", match: { fromDomainIncludes: "alpha.example" } },
      ],
    }), "utf8");
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Alpha One <one@alpha.example>",
        subject: "Alpha one",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        scanMailboxMetadataWindow: async () => ({
          messages,
          pagesScanned: 1,
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
        }),
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
      },
    });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "ruleset_governance_preview",
      arguments: {
        runId: "mcp-ruleset-governance-verbose",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefsPerGroup: 50,
        action: "move",
        rulesFile,
        selectedGroupIds: ["alpha"],
        includeClassifications: true,
      },
    });

    expect((result.structuredContent as { classifications?: unknown[] }).classifications).toHaveLength(1);

    await client.close();
    await server.close();
  });

  it("reports incomplete ruleset governance campaigns without extra tool output", async () => {
    const rulesFile = join(await mkdtemp(join(tmpdir(), "qferry-mcp-ruleset-report-")), "rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "1",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "alpha", label: "Alpha", target: { folder: "Folders/Alpha" } },
      ],
      rules: [
        { id: "alpha-domain", groupId: "alpha", match: { fromDomainIncludes: "alpha.example" } },
      ],
    }), "utf8");
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Alpha One <one@alpha.example>",
        subject: "Alpha one",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Alpha Two <two@alpha.example>",
        subject: "Alpha two",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Other <notice@other.example>",
        subject: "Other",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        scanMailboxMetadataWindow: async () => ({
          messages,
          pagesScanned: 1,
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
        }),
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
      },
    });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "ruleset_governance_preview",
      arguments: {
        runId: "mcp-ruleset-campaign-report",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        maxMessageRefsPerGroup: 1,
        action: "move",
        rulesFile,
        selectedGroupIds: ["alpha"],
      },
    });

    expect(result.structuredContent).toMatchObject({
      preview: {
        campaignReport: {
          scannedMessages: 3,
          plannedMessages: 1,
          alreadyInTargetMessages: 0,
          unplannedMessages: 2,
          coverageBasis: "scanned_window",
          coverageRatio: 0.333,
          planCount: 1,
          nextAction: "review_rules",
          topUnplannedDomains: [
            { domain: "alpha.example", messageCount: 1 },
            { domain: "other.example", messageCount: 1 },
          ],
          topUnplannedSenders: [
            {
              sender: "Other <notice@other.example>",
              domain: "other.example",
              messageCount: 1,
              sampleSubjects: ["Other"],
            },
            {
              sender: "Alpha Two <two@alpha.example>",
              domain: "alpha.example",
              messageCount: 1,
              sampleSubjects: ["Alpha two"],
            },
          ],
          truncatedGroups: [
            {
              groupId: "alpha",
              label: "Alpha",
              selectedMessageRefs: 1,
              totalMatchedMessages: 2,
            },
          ],
        },
      },
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
        from: "offers@example.com",
        subject: "Marketing digest",
        date: "2026-05-15T00:00:00.000Z",
        snippet: "Weekly product offers",
        flags: [],
      },
    ];
    const counts = new Map([
      ["INBOX", 1],
      ["Archive", 0],
    ]);
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
      async getMailboxSummary(folder) {
        return { path: folder, exists: counts.get(folder) ?? 0, uidValidity: folder === "INBOX" ? "uv-preview" : "target-uv" };
      },
      async getCapabilitySnapshot() {
        return {
          provider: "qqmail",
          accountAlias: "test",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        };
      },
      async moveMessages(refs, targetFolder) {
        const sourceFolder = refs[0]?.folder ?? "INBOX";
        counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
        counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
        return { moved: refs.length };
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
        target: { folder: "Archive" },
        selectedCategoryIds: ["newsletter_or_digest"],
      },
    });

    const audit = result.structuredContent as { audit?: { summaryPath?: string; tracePath?: string } };
    const summary = await readFile(audit.audit?.summaryPath ?? "", "utf8");
    expect(summary).toContain("- selectedMessageRefs: 1");
    expect(summary).toContain('- mailboxSnapshot: {"folder":"INBOX","exists":2385,"uidValidity":"uv-preview"}');
    expect(summary).toContain('"newsletter_or_digest":1');
    const trace = await readFile(audit.audit?.tracePath ?? "", "utf8");
    expect(trace).toContain('"mailboxSnapshot":{"folder":"INBOX","exists":2385,"uidValidity":"uv-preview"}');

    const preview = result.structuredContent as { plan?: { operationPlanId?: string } };
    const operationPlanId = String(preview.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });
    const execute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 1 },
    });
    const executeAudit = execute.structuredContent as { audit?: { summaryPath?: string; tracePath?: string } };
    const executeSummary = await readFile(executeAudit.audit?.summaryPath ?? "", "utf8");
    expect(executeSummary).toContain("- lastTool: execute_cleanup");
    expect(executeSummary).not.toContain('"uidValidity":"uv-preview"');
    expect(executeSummary).not.toContain("newsletter_or_digest");
    const executeTrace = await readFile(executeAudit.audit?.tracePath ?? "", "utf8");
    const executeTraceLine = executeTrace.split("\n").find((line) => line.includes('"toolName":"execute_cleanup"')) ?? "";
    expect(executeTraceLine).not.toContain("mailboxSnapshot");
    expect(executeTraceLine).not.toContain("newsletter_or_digest");

    await client.close();
    await server.close();
  });

  it("can confirm a preview plan after the MCP server is recreated", async () => {
    const planStoreDir = await mkdtemp(join(tmpdir(), "qferry-plan-store-"));
    process.env.QFERRY_OPERATION_PLAN_STORE_DIR = planStoreDir;
    const firstServer = createQFerryMcpServer();
    const firstClient = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [firstClientTransport, firstServerTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      firstServer.connect(firstServerTransport),
      firstClient.connect(firstClientTransport),
    ]);

    const preview = await firstClient.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "mcp-cross-server-plan",
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
    expect(operationPlanId).toEqual(expect.stringMatching(/^op_/));

    await firstClient.close();
    await firstServer.close();

    const secondServer = createQFerryMcpServer();
    const secondClient = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      secondServer.connect(secondServerTransport),
      secondClient.connect(secondClientTransport),
    ]);

    const confirmed = await secondClient.callTool({
      name: "confirm_cleanup_plan",
      arguments: { operationPlanId },
    });

    expect(confirmed.structuredContent).toMatchObject({
      plan: {
        operationPlanId,
        status: "confirmed",
      },
    });

    await secondClient.close();
    await secondServer.close();
    await rm(planStoreDir, { recursive: true, force: true });
  });

  it("logs sanitized MCP tool lifecycle entries for preview plans", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "mcp-sanitized-lifecycle",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        selectedGroupIds: [],
        messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "secret-uid-1" }],
      },
    });

    expect(result.structuredContent).toMatchObject({
      plan: {
        status: "preview",
        messageRefCount: 1,
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("secret-uid-1");

    const logText = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logText).toContain('"event":"qferry_mcp_tool_entered"');
    expect(logText).toContain('"event":"qferry_mcp_tool_completed"');
    expect(logText).toContain('"toolName":"plan_cleanup"');
    expect(logText).toContain('"messageRefCount":1');
    expect(logText).toContain('"operationPlanId":"op_');
    expect(logText).toContain('"totalPlanMessages":1');
    expect(logText).not.toContain("secret-uid-1");
    expect(logText).not.toContain("\"messageRefs\"");

    await client.close();
    await server.close();
    errorSpy.mockRestore();
  });

  it("initializes the runtime state root when a cloud wrapper starts the MCP server directly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cloud-state-parent-"));
    const stateRoot = join(dir, "missing", "state", "qferry");
    process.env.QFERRY_STATE_DIR = stateRoot;

    const server = createQFerryMcpServer();

    expect((await stat(stateRoot)).isDirectory()).toBe(true);
    await server.close();
    await rm(dir, { recursive: true, force: true });
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

  it("routes sensitive cleanup through the app-only UI tool", async () => {
    const messages: MessageSummary[] = [
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "noreply@github.com",
        subject: "OAuth application authorized",
        date: "2020-01-01T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const movedRefs: unknown[] = [];
    const provider: MailProvider = {
      async listMailboxes() {
        return [{ path: "INBOX" }, { path: "Archive" }];
      },
      async scanMailboxMetadata() {
        return messages;
      },
      async fetchMessage(ref) {
        const message = messages.find((candidate) => candidate.ref.uid === ref.uid) ?? messages[0]!;
        return { ...message, bodyText: "" };
      },
      async getCapabilitySnapshot() {
        return {
          provider: "fixture",
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        };
      },
      async moveMessages(refs) {
        movedRefs.push(...refs);
        return { moved: refs.length };
      },
    };
    const server = createQFerryMcpServer({ provider });
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const preview = await client.callTool({
      name: "plan_cleanup",
      arguments: {
        runId: "run-sensitive-ui",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "其他文件夹/GitHub账号安全" },
        selectedGroupIds: ["github_account_security"],
        rules: [{ id: "github-security", groupId: "github_account_security", match: { fromDomainIncludes: "github.com" } }],
      },
    });
    const operationPlanId = String((preview.structuredContent as { plan?: { operationPlanId?: string } }).plan?.operationPlanId);

    const panel = await client.callTool({
      name: "render_sensitive_cleanup_panel",
      arguments: { operationPlanId },
    });
    const panelText = JSON.stringify(panel.structuredContent);
    const panelMeta = panel._meta as { confirmToken?: string; categories?: Record<string, number> } | undefined;
    expect(panel.structuredContent).toMatchObject({
      kind: "qferry_sensitive_cleanup_panel",
      operationPlanId,
      sensitivity: "sensitive",
      categories: { github_account_security: 1 },
      totalPlanMessages: 1,
    });
    expect(panelText).not.toContain("confirmToken");
    expect(panelMeta?.confirmToken).toEqual(expect.any(String));

    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });
    const modelExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 1 },
    });
    expect(modelExecute.isError).toBe(true);
    expect(JSON.stringify(modelExecute.content)).toContain("SENSITIVE_UI_ONLY");
    expect(movedRefs).toHaveLength(0);

    const wrongTokenExecute = await client.callTool({
      name: "execute_sensitive_cleanup_from_ui",
      arguments: { operationPlanId, confirmToken: "wrong-token" },
    });
    expect(wrongTokenExecute.isError).toBe(true);
    expect(JSON.stringify(wrongTokenExecute.content)).toContain("USER_CONFIRMATION_REQUIRED");

    const uiExecute = await client.callTool({
      name: "execute_sensitive_cleanup_from_ui",
      arguments: { operationPlanId, confirmToken: String(panelMeta?.confirmToken), maxMessages: 1 },
    });
    expect(uiExecute.structuredContent).toMatchObject({
      ok: true,
      moved: 1,
      categories: { github_account_security: 1 },
      result: {
        operationPlanId,
        status: "executed",
        attemptedMessages: 1,
        mutationsAttempted: 1,
      },
    });
    expect(JSON.stringify(uiExecute.structuredContent)).not.toContain("uid");
    expect(movedRefs).toHaveLength(1);

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
        reconciliationStatus: "matched",
      },
    });
    expect(JSON.stringify(execute.structuredContent)).not.toContain("batchAudit");
    expect(JSON.stringify(execute.structuredContent)).not.toContain("reconciliations");
    const audit = execute.structuredContent as { audit?: { tracePath?: string; summaryPath?: string } };
    expect(audit.audit?.tracePath).toBe(join(traceRoot, "logs", "runs", "run-mcp-trace-execute.jsonl"));
    expect(audit.audit?.summaryPath).toBe(join(traceRoot, "artifacts", "e2e", "run-mcp-trace-execute", "summary.md"));
    const trace = await readFile(audit.audit?.tracePath ?? "", "utf8");
    expect(trace).toContain("\"toolName\":\"execute_cleanup\"");
    expect(trace).toContain("\"mutationsAttempted\":1");
    const summary = await readFile(audit.audit?.summaryPath ?? "", "utf8");
    expect(summary).toContain("# QFerry MCP Audit run-mcp-trace-execute");
    expect(summary).toContain("- lastTool: execute_cleanup");
    expect(summary).toContain("- reconciliationStatus: matched");
    expect(summary).not.toContain('"folder":"Archive"');
    expect(summary).not.toContain("firstUid");
    expect(summary).not.toContain("lastUid");

    await client.close();
    await server.close();
  });

  it("writes trace artifacts for failed MCP cleanup execution", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-execute-failure-audit-"));
    process.env.QFERRY_MCP_TRACE_ROOT = traceRoot;
    const messages: MessageSummary[] = [{
      ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
      from: "newsletter@example.com",
      subject: "Promo",
      date: "2020-01-01T00:00:00.000Z",
      snippet: "",
      flags: [],
    }];
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
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
        moveMessages: async () => {
          throw new Error("simulated provider move failure");
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
        runId: "run-mcp-trace-execute-failed",
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

    const failedExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 1 },
    });
    expect(failedExecute.isError).toBe(true);
    expect(failedExecute.content).toContainEqual({
      type: "text",
      text: "simulated provider move failure",
    });

    const tracePath = join(traceRoot, "logs", "runs", "run-mcp-trace-execute-failed.jsonl");
    const summaryPath = join(traceRoot, "artifacts", "e2e", "run-mcp-trace-execute-failed", "summary.md");
    const trace = await readFile(tracePath, "utf8");
    expect(trace).toContain("\"toolName\":\"execute_cleanup\"");
    expect(trace).toContain("\"status\":\"failed\"");
    expect(trace).toContain("simulated provider move failure");
    const summary = await readFile(summaryPath, "utf8");
    expect(summary).toContain("- lastTool: execute_cleanup");
    expect(summary).toContain("- status: failed");
    expect(summary).toContain("- attemptedMessages: 1");
    expect(summary).toContain("- errorMessage: simulated provider move failure");

    await client.close();
    await server.close();
  });

  it("resumes only unattempted refs when a partial move reports fewer moved refs than attempted", async () => {
    const messages: MessageSummary[] = ["1", "2", "3", "4", "5"].map((uid) => ({
      ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid },
      from: "newsletter@example.com",
      subject: `Promo ${uid}`,
      date: "2020-01-01T00:00:00.000Z",
      snippet: "",
      flags: [],
    }));
    let inboxCount = 5;
    let archiveCount = 0;
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: folder === "Archive" ? archiveCount : inboxCount,
        }),
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
        moveMessages: async () => {
          inboxCount -= 1;
          archiveCount += 1;
          return { moved: 1 };
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
        runId: "run-mcp-partial-move-repreview",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        messageRefs: messages.map((message) => message.ref),
        selectedGroupIds: [],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });

    const firstExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 3 },
    });

    expect(firstExecute.structuredContent).toMatchObject({
      result: {
        status: "partially_executed",
        attemptedMessages: 3,
        moved: 1,
        remainingMessages: 2,
      },
    });

    const secondExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 3 },
    });

    expect(secondExecute.structuredContent).toMatchObject({
      result: {
        status: "executed",
        attemptedMessages: 2,
        moved: 1,
        remainingMessages: 0,
      },
    });

    await client.close();
    await server.close();
  });

  it("keeps target-reconciled source-drift move plans resumable through the MCP server", async () => {
    const messages: MessageSummary[] = ["1", "2", "3", "4", "5"].map((uid) => ({
      ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid },
      from: "newsletter@example.com",
      subject: `Promo ${uid}`,
      date: "2020-01-01T00:00:00.000Z",
      snippet: "",
      flags: [],
    }));
    let inboxCount = 5;
    let archiveCount = 0;
    let moveCalls = 0;
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: folder === "Archive" ? archiveCount : inboxCount,
        }),
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
          moveCalls += 1;
          inboxCount -= refs.length + (moveCalls === 1 ? 1 : 0);
          if (targetFolder === "Archive") archiveCount += refs.length;
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
        runId: "run-mcp-source-drift-resumable",
        folder: "INBOX",
        limit: 10,
        action: "move",
        target: { folder: "Archive" },
        messageRefs: messages.map((message) => message.ref),
        selectedGroupIds: [],
      },
    });
    const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
    const operationPlanId = String(previewContent?.plan?.operationPlanId);
    await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });

    const firstExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 3 },
    });

    expect(firstExecute.structuredContent).toMatchObject({
      result: {
        status: "partially_executed",
        attemptedMessages: 3,
        moved: 3,
        remainingMessages: 2,
        reconciliationStatus: "target_reconciled_source_unreliable",
      },
    });

    const secondExecute = await client.callTool({
      name: "execute_cleanup",
      arguments: { operationPlanId, maxMessages: 3 },
    });

    expect(secondExecute.structuredContent).toMatchObject({
      result: {
        status: "executed",
        attemptedMessages: 2,
        moved: 2,
        remainingMessages: 0,
        reconciliationStatus: "matched",
      },
    });

    await client.close();
    await server.close();
  });

  it("serializes concurrent MCP cleanup execution", async () => {
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
    ];
    let activeMoves = 0;
    let maxActiveMoves = 0;
    const server = createQFerryMcpServer({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async (ref) => ({ ...messages[0], ref, bodyText: "" }),
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
        moveMessages: async (refs) => {
          activeMoves += 1;
          maxActiveMoves = Math.max(maxActiveMoves, activeMoves);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeMoves -= 1;
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

    const makePlan = async (runId: string, uid: string) => {
      const preview = await client.callTool({
        name: "plan_cleanup",
        arguments: {
          runId,
          folder: "INBOX",
          limit: 10,
          action: "move",
          target: { folder: "Archive" },
          messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid }],
          selectedGroupIds: [],
        },
      });
      const previewContent = preview.structuredContent as { plan?: { operationPlanId?: string } } | undefined;
      const operationPlanId = String(previewContent?.plan?.operationPlanId);
      await client.callTool({ name: "confirm_cleanup_plan", arguments: { operationPlanId } });
      return operationPlanId;
    };
    const firstPlanId = await makePlan("run-mcp-serialized-execute-1", "1");
    const secondPlanId = await makePlan("run-mcp-serialized-execute-2", "2");

    await Promise.all([
      client.callTool({ name: "execute_cleanup", arguments: { operationPlanId: firstPlanId, maxMessages: 1 } }),
      client.callTool({ name: "execute_cleanup", arguments: { operationPlanId: secondPlanId, maxMessages: 1 } }),
    ]);

    expect(maxActiveMoves).toBe(1);

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
        messageRefCount: 1,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("\"messageRefs\"");

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
        messageRefCount: 1,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("\"messageRefs\"");

    await client.close();
    await server.close();
  });

  it("plans sender governance rules into a requested classification group through the MCP server", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const ruleGroup = {
      id: "ai_dev_tools",
      label: "AI开发工具",
      target: { folder: "其他文件夹/AI开发工具" },
    };
    const result = await client.callTool({
      name: "plan_sender_governance",
      arguments: {
        runId: "run-mcp-sender-target-group",
        folder: "INBOX",
        pageSize: 1,
        maxPages: 2,
        maxMessageRefs: 1,
        action: "move",
        target: { folder: "AI开发工具" },
        selectedSenderDomains: ["example.com"],
        ruleGroup,
      },
    });

    expect(result.structuredContent).toMatchObject({
      governance: {
        domainCandidates: [
          {
            domain: "example.com",
            suggestedRule: {
              groupId: "ai_dev_tools",
              match: { fromDomainIncludes: "example.com" },
            },
          },
        ],
        mutationsAttempted: 0,
      },
      rulesetPatch: {
        groupToEnsure: ruleGroup,
        rulesToAdd: [
          {
            id: "sender-domain-example-com",
            groupId: "ai_dev_tools",
            match: { fromDomainIncludes: "example.com" },
          },
        ],
        renderedDraft: {
          groups: [
            { id: "review", label: "Needs review" },
            ruleGroup,
          ],
        },
      },
      mutationsAttempted: 0,
    });

    await client.close();
    await server.close();
  });

  it("plans high-yield governance through the MCP server without creating operation plans", async () => {
    const messages: MessageSummary[] = [
      ...Array.from({ length: 4 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `steam-${index + 1}` },
        from: index % 2 === 0 ? "Steam <noreply@steampowered.com>" : "Steam Support <support@steampowered.com>",
        subject: `Steam update ${index + 1}`,
        date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "platform",
        flags: [],
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `qq-${index + 1}` },
        from: [
          "QQ Mail Admin <admin@qq.com>",
          "Friend <friend@qq.com>",
          "Shop <shop@qq.com>",
        ][index % 3],
        subject: `QQ mixed ${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "mixed",
        flags: [],
      })),
    ];
    const provider: MailProvider = {
      listMailboxes: async () => [],
      scanMailboxMetadata: async () => {
        throw new Error("plan_high_yield_governance should use the window scanner");
      },
      scanMailboxMetadataWindow: async () => ({
        pagesScanned: 1,
        mailboxSnapshot: { folder: "INBOX", exists: messages.length, uidValidity: "high-yield" },
        messages,
      }),
      fetchMessage: async () => {
        throw new Error("not used");
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
      name: "plan_high_yield_governance",
      arguments: {
        runId: "run-mcp-high-yield",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 1,
        minMessageCount: 3,
        maxDistinctSendersForDomainRule: 2,
        ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "其他文件夹/Bulk platform" } },
      },
    });

    expect(result.structuredContent).toMatchObject({
      planner: {
        provider: "fixture",
        scannedMessages: 9,
        candidateSummary: {
          directRuleCandidates: 1,
          mixedDomainCandidates: 1,
        },
        recommendedNextAction: "review_mixed_domains",
        mutationsAttempted: 0,
      },
      rulesetPatch: {
        rulesToAdd: [
          {
            id: "sender-domain-steampowered-com",
            groupId: "bulk_platform",
            match: { fromDomainIncludes: "steampowered.com" },
          },
        ],
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("operationPlanId");
    expect(JSON.stringify(result.structuredContent)).not.toContain("renderedDraft");

    await client.close();
    await server.close();
  });

  it("plans mailbox governance campaigns through the MCP server without creating operation plans", async () => {
    const byFolder: Record<string, MessageSummary[]> = {
      INBOX: Array.from({ length: 2 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `inbox-${index + 1}` },
        from: "Low Yield <notice@low.example.com>",
        subject: `Low yield ${index + 1}`,
        date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "too small",
        flags: [],
      })),
      Archive: Array.from({ length: 12 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "Archive", uid: `steam-${index + 1}` },
        from: index % 2 === 0 ? "Steam <noreply@steampowered.com>" : "Steam Support <support@steampowered.com>",
        subject: `Steam update ${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "platform",
        flags: [],
      })),
    };
    const provider: MailProvider = {
      listMailboxes: async () => [],
      scanMailboxMetadata: async () => {
        throw new Error("plan_mailbox_governance_campaign should use the window scanner");
      },
      scanMailboxMetadataWindow: async (input) => ({
        pagesScanned: 1,
        mailboxSnapshot: { folder: input.folder, exists: byFolder[input.folder]?.length ?? 0, uidValidity: "campaign" },
        messages: byFolder[input.folder] ?? [],
      }),
      fetchMessage: async () => {
        throw new Error("not used");
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
      name: "plan_mailbox_governance_campaign",
      arguments: {
        runId: "run-mcp-mailbox-campaign",
        folders: ["INBOX", "Archive"],
        pageSize: 50,
        maxPagesPerFolder: 1,
        minMessageCount: 10,
        maxDistinctSendersForDomainRule: 2,
        ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "其他文件夹/Bulk platform" } },
      },
    });

    expect(result.structuredContent).toMatchObject({
      campaign: {
        provider: "fixture",
        foldersScanned: 2,
        scannedMessages: 14,
        recommendedNextAction: "draft_rules",
        folderSummary: {
          draftRuleFolders: 1,
          stopLowYieldFolders: 1,
        },
        folderPlans: [
          { folder: "Archive", recommendedNextAction: "draft_rules" },
          { folder: "INBOX", recommendedNextAction: "stop_low_yield" },
        ],
        mutationsAttempted: 0,
      },
      rulesetPatch: {
        rulesToAdd: [
          {
            groupId: "bulk_platform",
            match: { fromDomainIncludes: "steampowered.com", folderEquals: "Archive" },
          },
        ],
      },
      mutationsAttempted: 0,
    });
    expect((result.structuredContent as any).rulesetPatch.rulesToAdd[0]?.id).toMatch(/^sender-domain-steampowered-com-in-archive-[a-f0-9]{8}$/);
    expect(JSON.stringify(result.structuredContent)).not.toContain("operationPlanId");
    expect(JSON.stringify(result.structuredContent)).not.toContain("renderedDraft");

    await client.close();
    await server.close();
  });

  it("breaks down senders through the MCP server without creating an operation plan", async () => {
    const server = createQFerryMcpServer();
    const client = new Client({ name: "qferry-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "sender_breakdown",
      arguments: {
        folder: "INBOX",
        pageSize: 2,
        maxPages: 1,
        order: "oldest",
        fromDomainIncludes: "example.com",
        maxSenderCandidates: 10,
        ruleGroup: { id: "qq_mail_system", label: "QQ邮箱系统", target: { folder: "其他文件夹/QQ邮箱系统" } },
      },
    });

    expect(result.structuredContent).toMatchObject({
      breakdown: {
        provider: "fixture",
        folder: "INBOX",
        scannedMessages: 2,
        matchedMessages: 2,
        fromDomainIncludes: "example.com",
        senderCandidates: [
          {
            sender: "security@example.com",
            domain: "example.com",
            messageCount: 1,
            suggestedRule: {
              groupId: "qq_mail_system",
              match: { fromIncludes: "security@example.com" },
            },
          },
          {
            sender: "newsletter@example.com",
            domain: "example.com",
            messageCount: 1,
            suggestedRule: {
              groupId: "qq_mail_system",
              match: { fromIncludes: "newsletter@example.com" },
            },
          },
        ],
        mutationsAttempted: 0,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("operationPlanId");

    await client.close();
    await server.close();
  });

  it("accepts large sender governance preview windows through the MCP server", async () => {
    const bulkScanInputs: unknown[] = [];
    const selectedMessages: MessageSummary[] = Array.from({ length: 210 }, (_, index) => ({
      ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: `steam-${index + 1}` },
      from: "Steam Team <noreply@steampowered.com>",
      subject: `Steam login ${index + 1}`,
      date: `2026-05-${String((index % 20) + 1).padStart(2, "0")}T00:00:00.000Z`,
      snippet: "new login",
      flags: [],
    }));
    const provider: MailProvider = {
      listMailboxes: async () => [],
      scanMailboxMetadata: async () => {
        throw new Error("plan_sender_governance should use the window scanner");
      },
      scanMailboxMetadataWindow: async (input) => {
        bulkScanInputs.push(input);
        return {
          pagesScanned: 5,
          mailboxSnapshot: { folder: "INBOX", exists: 211, uidValidity: "mcp-sender-window" },
          messages: [
            ...selectedMessages,
            {
              ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
              from: "Other <other@example.com>",
              subject: "Manual review",
              date: "2026-05-11T00:00:00.000Z",
              snippet: "personal mail",
              flags: [],
            },
          ],
        };
      },
      fetchMessage: async () => {
        throw new Error("not used");
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
      name: "plan_sender_governance",
      arguments: {
        runId: "run-mcp-sender-window-50",
        folder: "INBOX",
        pageSize: 50,
        maxPages: 5,
        maxMessageRefs: 250,
        action: "move",
        target: { folder: "Steam" },
        selectedSenderDomains: ["steampowered.com"],
      },
    });

    expect(bulkScanInputs).toEqual([{ folder: "INBOX", limit: 50, maxPages: 5, order: "oldest", offset: 0 }]);
    expect(result.structuredContent).toMatchObject({
      governance: {
        scannedMessages: 211,
        selectedMessageRefs: 210,
      },
      plan: {
        status: "preview",
        messageRefCount: 210,
      },
      mutationsAttempted: 0,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("\"messageRefs\"");

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
    expect(JSON.stringify(result.structuredContent)).not.toContain("renderedDraft");
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules).toHaveLength(1);

    await client.close();
    await server.close();
  });

  it("initializes a missing JSON rules file through the MCP server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mcp-cloud-rules-"));
    const rulesFile = join(dir, "missing", "qferry-governance-rules.json");
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
          groupToEnsure: { id: "github_account_security", label: "GitHub account security", target: { folder: "其他文件夹/GitHub账号安全" } },
          candidateRuleCount: 1,
          rulesToAdd: [
            {
              id: "github-security-oauth",
              groupId: "github_account_security",
              match: { fromDomainIncludes: "github.com", subjectIncludes: "OAuth" },
            },
          ],
          skippedDuplicateRules: [],
        },
      },
    });

    expect(result.structuredContent).toMatchObject({
      applied: true,
      beforeRuleCount: 0,
      afterRuleCount: 1,
      addedRuleCount: 1,
    });
    expect(JSON.parse(await readFile(rulesFile, "utf8"))).toMatchObject({
      rules: [
        {
          id: "github-security-oauth",
          groupId: "github_account_security",
          match: { fromDomainIncludes: "github.com", subjectIncludes: "OAuth" },
        },
      ],
    });

    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("remaps default root state rules paths through the MCP server", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "qferry-mcp-state-root-"));
    process.env.QFERRY_STATE_DIR = stateRoot;
    const rulesFile = "/root/.local/state/qferry/governance-rules.json";
    const resolvedRulesFile = join(stateRoot, "governance-rules.json");
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
          groupToEnsure: { id: "github_account_security", label: "GitHub account security", target: { folder: "其他文件夹/GitHub账号安全" } },
          candidateRuleCount: 1,
          rulesToAdd: [
            {
              id: "github-security-oauth",
              groupId: "github_account_security",
              match: { fromDomainIncludes: "github.com", subjectIncludes: "OAuth" },
            },
          ],
          skippedDuplicateRules: [],
        },
      },
    });

    expect(result.structuredContent).toMatchObject({
      applied: true,
      rulesFile: resolvedRulesFile,
      beforeRuleCount: 0,
      afterRuleCount: 1,
      addedRuleCount: 1,
    });
    expect((await stat(resolvedRulesFile)).isFile()).toBe(true);
    expect(JSON.parse(await readFile(resolvedRulesFile, "utf8"))).toMatchObject({
      rules: [
        {
          id: "github-security-oauth",
          groupId: "github_account_security",
          match: { fromDomainIncludes: "github.com", subjectIncludes: "OAuth" },
        },
      ],
    });

    await client.close();
    await server.close();
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("dry-runs ruleset rule replacement through the MCP server", async () => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "qferry-mcp-rules-replace-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Needs review" },
        { id: "account_security", label: "Account security" },
      ],
      rules: [
        { id: "sender-domain-tm-openai-com", groupId: "account_security", match: { fromDomainIncludes: "tm.openai.com" } },
      ],
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
        includeRenderedDraft: true,
        patch: {
          groupToEnsure: { id: "account_security", label: "Account security" },
          candidateRuleCount: 1,
          rulesToReplace: [
            {
              id: "sender-domain-tm-openai-com",
              groupId: "account_security",
              match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "verification" },
            },
          ],
          rulesToAdd: [],
          skippedDuplicateRules: [],
        },
      },
    });

    expect(result.structuredContent).toMatchObject({
      applied: false,
      beforeRuleCount: 1,
      afterRuleCount: 1,
      addedRuleCount: 0,
      replacedRuleCount: 1,
      renderedDraft: {
        rules: [
          {
            id: "sender-domain-tm-openai-com",
            groupId: "account_security",
            match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "verification" },
          },
        ],
      },
    });
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules[0].match).toEqual({ fromDomainIncludes: "tm.openai.com" });

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
    expect(JSON.stringify(result.content)).toContain("JSON rules file");
    expect(await readFile(rulesFile, "utf8")).toBe(original);

    await client.close();
    await server.close();
  });
});
