import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ClassificationRule } from "../src/classification.js";
import { createMailTools } from "../src/tools/mail-tools.js";
import { FixtureMailProvider } from "../src/providers/fixture-provider.js";
import type { MessageSummary } from "../src/providers/types.js";
import { confirmOperationPlan, createOperationPlan } from "../src/operation-plan.js";

describe("mail tools", () => {
  it("lists mailboxes through the provider", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.listMailboxes();

    expect(result.mailboxes.map((mailbox) => mailbox.path)).toEqual(["INBOX", "Archive"]);
  });

  it("returns provider capability snapshots when available", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.getCapabilitySnapshot();

    expect(result.capability).toMatchObject({
      provider: "fixture",
      supportsMutation: false,
    });
  });

  it("returns read-only mailbox summaries", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    await expect(tools.getMailboxSummary({ folder: "INBOX" })).resolves.toEqual({
      mailbox: {
        path: "INBOX",
        exists: 2,
      },
    });
  });

  it("groups oldest spam and ad candidates for confirmation", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.groupSpamCandidates({
      folder: "INBOX",
      limit: 10,
      rules: [
        { id: "newsletter", groupId: "ads_or_newsletters", match: { fromIncludes: "newsletter@" } },
        { id: "security", groupId: "attention", match: { subjectIncludes: "Security" } },
      ],
    });

    expect(result.scanOrder).toBe("oldest");
    expect(result.scannedMessages).toBe(2);
    expect(result.sampledMessages.map((message) => message.subject)).toEqual([
      "Weekly digest",
      "Security alert",
    ]);
    expect(result.groups).toEqual({
      ads_or_newsletters: [
        {
          message: {
            ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
            from: "newsletter@example.com",
            subject: "Weekly digest",
            date: "2026-05-11T00:00:00.000Z",
            snippet: "A low priority newsletter.",
            flags: ["\\Seen"],
          },
          groupId: "ads_or_newsletters",
          matchedRuleId: "newsletter",
          explanation: "from includes newsletter@",
        },
      ],
      attention: [
        {
          message: {
            ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
            from: "security@example.com",
            subject: "Security alert",
            date: "2026-05-12T00:00:00.000Z",
            snippet: "A security notification that should be reviewed.",
            flags: [],
          },
          groupId: "attention",
          matchedRuleId: "security",
          explanation: "subject includes Security",
        },
      ],
    });
    expect(result.mutationsAttempted).toBe(0);
  });

  it("groups spam candidates after an offset", async () => {
    const provider = FixtureMailProvider.demo();
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          return provider.scanMailboxMetadata(input);
        },
      },
    });

    const result = await tools.groupSpamCandidates({
      folder: "INBOX",
      limit: 1,
      offset: 1,
      rules: [
        { id: "security", groupId: "attention", match: { subjectIncludes: "Security" } },
      ],
    });

    expect(scanInputs).toEqual([{ folder: "INBOX", limit: 1, order: "oldest", offset: 1 }]);
    expect(result.scannedMessages).toBe(1);
    expect(result.scanOffset).toBe(1);
    expect(result.groups).toEqual({
      attention: [
        {
          message: {
            ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
            from: "security@example.com",
            subject: "Security alert",
            date: "2026-05-12T00:00:00.000Z",
            snippet: "A security notification that should be reviewed.",
            flags: [],
          },
          groupId: "attention",
          matchedRuleId: "security",
          explanation: "subject includes Security",
        },
      ],
    });
  });

  it("returns runtime status without auth secrets", async () => {
    const tools = createMailTools({
      provider: FixtureMailProvider.demo(),
      runtimeConfig: {
        provider: "qqmail",
        accountAlias: "25***@qq.com",
        configSource: "env",
        mutationAllowed: false,
        mutationCapable: false,
        mutationOperationallyReady: false,
        mutationRequiresConfirmation: false,
        authConfigured: true,
        providerReady: true,
        metadataSampleLimit: 1,
        statusWarnings: [],
        qqmail: {
          email: "25abc@qq.com",
          authCodePresent: true,
          imapHost: "imap.qq.com",
          imapPort: 993,
        },
      },
    });

    const result = await tools.getStatus();

    expect(result.status).toMatchObject({
      provider: "qqmail",
      accountAlias: "25***@qq.com",
      configSource: "env",
      mutationAllowed: false,
      metadataSampleLimit: 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("25abc@qq.com");
    expect(result.status.qqmail?.email).toBeUndefined();
    expect(result.executionPolicy).toEqual({
      moveTargetReconciledSourceUnreliableIsBlocking: false,
    });
  });

  it("searches bounded metadata without returning message bodies", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.search({ folder: "INBOX", limit: 10, query: "digest" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.subject).toBe("Weekly digest");
    expect(JSON.stringify(result)).not.toContain("fixture full body");
  });

  it("searches bounded metadata after an offset", async () => {
    const provider = FixtureMailProvider.demo();
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          return provider.scanMailboxMetadata(input);
        },
      },
    });

    const result = await tools.search({ folder: "INBOX", limit: 1, order: "oldest", offset: 1 });

    expect(scanInputs).toEqual([{ folder: "INBOX", limit: 1, order: "oldest", offset: 1 }]);
    expect(result.messages).toEqual([
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "security@example.com",
        subject: "Security alert",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "A security notification that should be reviewed.",
        flags: [],
      },
    ]);
  });

  it("searches bounded metadata with structured filters", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.search({
      folder: "INBOX",
      limit: 10,
      fromIncludes: "newsletter@",
      fromDomainIncludes: "example.com",
      subjectIncludes: "digest",
      hasFlag: "\\Seen",
      dateAfter: "2026-05-10T00:00:00.000Z",
      dateBefore: "2026-05-12T00:00:00.000Z",
    });

    expect(result.messages).toEqual([
      {
        ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "newsletter@example.com",
        subject: "Weekly digest",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "A low priority newsletter.",
        flags: ["\\Seen"],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture full body");
  });

  it("parses Gmail-like query filters while explicit fields win", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.search({
      folder: "INBOX",
      limit: 10,
      query: "from:example.com subject:(digest) after:2026/05/10 before:2026/05/12 in:INBOX label:news",
      subjectIncludes: "Weekly",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.subject).toBe("Weekly digest");
    expect(result.parsedQuery).toEqual({
      filters: {
        fromDomainIncludes: "example.com",
        subjectIncludes: "digest",
        dateAfter: "2026-05-10",
        dateBefore: "2026-05-12",
        folder: "INBOX",
      },
      remainder: "",
      warnings: [
        {
          code: "unsupported_operator",
          operator: "label",
          token: "label:news",
        },
      ],
    });
  });

  it("fetches a single message detail by provider ref", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.fetch({
      provider: "fixture",
      accountAlias: "demo",
      folder: "INBOX",
      uid: "1",
    });

    expect(result.message.subject).toBe("Security alert");
    expect(result.message.bodyText).toContain("security alert");
  });

  it("classifies messages with local rules", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.classifyMessages({
      folder: "INBOX",
      limit: 10,
      defaultGroupId: "review",
      rules: [
        {
          id: "newsletter",
          groupId: "bulk",
          match: { fromIncludes: "newsletter@" },
        },
      ],
    });

    expect(result.classifications).toContainEqual({
      messageRef: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      groupId: "bulk",
      matchedRuleId: "newsletter",
      explanation: "from includes newsletter@",
    });
  });

  it("creates read-only inbox triage reports", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.triageInbox({
      folder: "INBOX",
      limit: 10,
      defaultGroupId: "review",
      rules: [
        {
          id: "newsletter",
          groupId: "newsletter",
          match: { fromIncludes: "newsletter@" },
        },
      ],
    });

    expect(result.triage).toEqual({
      provider: "fixture",
      folder: "INBOX",
      sampledMessages: 2,
      groupCounts: {
        newsletter: 1,
        review: 1,
      },
      recommendedNextAction: "review_preview_plan",
      mutationsAttempted: 0,
    });
    expect(result.classifications).toHaveLength(2);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("adds urgency priority buckets to inbox triage reports", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.triageInbox({
      folder: "INBOX",
      limit: 10,
      defaultGroupId: "review",
      rules: [
        {
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
        },
      ],
    });

    expect(result.priorityCounts).toEqual({
      urgent: 1,
      needs_review: 0,
      waiting: 0,
      fyi: 0,
      bulk: 1,
    });
    expect(result.priorityBuckets.find((bucket) => bucket.id === "urgent")?.candidates[0]).toMatchObject({
      bucketId: "urgent",
      message: { subject: "Security alert" },
      nextAction: "review first and decide whether a response or cleanup is needed",
    });
    expect(result.priorityBuckets.find((bucket) => bucket.id === "bulk")?.candidates[0]).toMatchObject({
      bucketId: "bulk",
      message: { subject: "Weekly digest" },
      reason: "Configured newsletter sender rule",
      confidence: "high",
      weight: 42,
      nextAction: "Archive after confirming this sender is expected",
    });
    expect(result.mutationsAttempted).toBe(0);
  });

  it("sorts configured priority candidates by weight within a bucket", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.triageInbox({
      folder: "INBOX",
      limit: 10,
      defaultGroupId: "review",
      rules: [
        {
          id: "security",
          groupId: "review",
          match: { fromIncludes: "security@" },
          priority: {
            bucketId: "bulk",
            reason: "Low-weight configured test rule",
            confidence: "low",
            weight: 10,
            nextAction: "Review later",
          },
        },
        {
          id: "newsletter",
          groupId: "newsletter",
          match: { fromIncludes: "newsletter@" },
          priority: {
            bucketId: "bulk",
            reason: "High-weight configured test rule",
            confidence: "high",
            weight: 90,
            nextAction: "Review first",
          },
        },
      ],
    });

    expect(result.priorityBuckets.find((bucket) => bucket.id === "bulk")?.candidates.map((candidate) => ({
      subject: candidate.message.subject,
      weight: candidate.weight,
    }))).toEqual([
      { subject: "Weekly digest", weight: 90 },
      { subject: "Security alert", weight: 10 },
    ]);
  });

  it("classifies messages with rules loaded from a rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "rules-v1",
      defaultGroupId: "review",
      groups: [
        { id: "archive", label: "Archive" },
        { id: "review", label: "Review" },
      ],
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.classifyMessages({
      folder: "INBOX",
      limit: 10,
      rulesFile,
    });

    expect(result.ruleset).toEqual({
      source: rulesFile,
      version: "rules-v1",
      defaultGroupId: "review",
      groupCount: 2,
      ruleCount: 1,
    });
    expect(result.classifications).toContainEqual({
      messageRef: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      groupId: "archive",
      matchedRuleId: "newsletter",
      explanation: "from includes newsletter@",
    });
  });

  it("uses the runtime rules file when rules are not passed explicitly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-default-rules-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "default-rules",
      defaultGroupId: "review",
      groups: [
        { id: "archive", label: "Archive" },
        { id: "review", label: "Review" },
      ],
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    const tools = createMailTools({
      provider: FixtureMailProvider.demo(),
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
        mutationAllowed: false,
        mutationCapable: false,
        mutationOperationallyReady: false,
        mutationRequiresConfirmation: false,
        authConfigured: false,
        providerReady: true,
        metadataSampleLimit: 10,
        statusWarnings: [],
        rulesFile,
      },
    });

    const result = await tools.classifyMessages({
      folder: "INBOX",
      limit: 10,
    });

    expect(result.ruleset?.source).toBe(rulesFile);
    expect(result.classifications).toContainEqual({
      messageRef: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      groupId: "archive",
      matchedRuleId: "newsletter",
      explanation: "from includes newsletter@",
    });
  });

  it("creates preview cleanup plans and does not mutate", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.planCleanup({
      runId: "run-1",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rules: [
        {
          id: "newsletter",
          groupId: "archive",
          match: { fromIncludes: "newsletter@" },
        },
      ],
      selectedGroupIds: ["archive"],
    });

    expect(result.plan.status).toBe("preview");
    expect(result.plan.confirmationRequired).toBe(true);
    expect(result.mutationsAttempted).toBe(0);
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
  });

  it("creates preview cleanup plans from already reviewed message refs without rescanning", async () => {
    const provider = FixtureMailProvider.demo();
    let scanCalls = 0;
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        scanMailboxMetadata: async () => {
          scanCalls += 1;
          throw new Error("plan should not rescan selected refs");
        },
      },
    });

    const result = await tools.planCleanup({
      runId: "run-selected-refs",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Junk" },
      selectedGroupIds: [],
      messageRefs: [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
    });

    expect(result.plan.status).toBe("preview");
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
    expect(result.classifications).toEqual([]);
    expect(result.mutationsAttempted).toBe(0);
    expect(scanCalls).toBe(0);
  });

  it("creates preview batch cleanup plans across pages", async () => {
    const provider = FixtureMailProvider.demo();
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({ path: folder, exists: 3, uidValidity: "batch-preview" }),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          return provider.scanMailboxMetadata(input);
        },
      },
    });

    const result = await tools.previewCleanupBatch({
      runId: "run-batch-preview",
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
    });

    expect(scanInputs).toEqual([
      { folder: "INBOX", limit: 1, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 1, order: "oldest", offset: 1 },
    ]);
    expect(result.preview).toMatchObject({
      provider: "fixture",
      folder: "INBOX",
      mailboxSnapshot: { folder: "INBOX", exists: 3, uidValidity: "batch-preview" },
      scanOrder: "oldest",
      scanOffset: 0,
      pageSize: 1,
      maxPages: 2,
      pagesScanned: 2,
      scannedMessages: 2,
      selectedMessageRefs: 1,
      maxMessageRefs: 1,
      groupCounts: { archive: 2 },
      mutationsAttempted: 0,
    });
    expect(result.preview.sampledMessages.map((message) => message.subject)).toEqual([
      "Weekly digest",
      "Security alert",
    ]);
    expect(result.preview.selectedGroups.archive).toHaveLength(1);
    expect(result.plan.status).toBe("preview");
    expect(result.plan.confirmationRequired).toBe(true);
    expect(result.plan.target).toEqual({ folder: "Archive" });
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
    expect(result.classifications).toHaveLength(2);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses provider bulk metadata windows for rules preview batches when available", async () => {
    const scanCalls: unknown[] = [];
    const bulkScanCalls: unknown[] = [];
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Person <person@example.com>",
        subject: "Manual review",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "personal mail",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Steam Team <noreply@steampowered.com>",
        subject: "Steam login",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "new login",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Other <other@example.com>",
        subject: "Other",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "not selected",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "4" },
        from: "Steam Support <noreply@steampowered.com>",
        subject: "Refund request received",
        date: "2026-05-13T00:00:00.000Z",
        snippet: "refund",
        flags: ["\\Seen"],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async (input) => {
          scanCalls.push(input);
          throw new Error("preview_cleanup_batch should use the provider window scanner");
        },
        scanMailboxMetadataWindow: async (input) => {
          bulkScanCalls.push(input);
          return {
            pagesScanned: 2,
            mailboxSnapshot: { folder: "INBOX", exists: 4, uidValidity: "rules-window" },
            messages,
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.previewCleanupBatch({
      runId: "run-batch-window",
      folder: "INBOX",
      pageSize: 2,
      maxPages: 2,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "Archive/Steam" },
      selectedGroupIds: ["steam"],
      rules: [
        { id: "steam", groupId: "steam", match: { fromDomainIncludes: "steampowered.com" } },
      ],
    });

    expect(scanCalls).toEqual([]);
    expect(bulkScanCalls).toEqual([{ folder: "INBOX", limit: 2, maxPages: 2, order: "oldest", offset: 0 }]);
    expect(result.preview.mailboxSnapshot).toEqual({ folder: "INBOX", exists: 4, uidValidity: "rules-window" });
    expect(result.preview.pagesScanned).toBe(2);
    expect(result.preview.scannedMessages).toBe(4);
    expect(result.preview.groupCounts).toEqual({ review: 2, steam: 2 });
    expect(result.plan.messageRefs.map((ref) => ref.uid)).toEqual(["2", "4"]);
    expect(result.classifications).toHaveLength(4);
  });

  it("plans sender and domain governance without server-side blocklist mutation", async () => {
    const provider = FixtureMailProvider.demo();
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          return provider.scanMailboxMetadata(input);
        },
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-governance",
      folder: "INBOX",
      pageSize: 1,
      maxPages: 2,
      maxMessageRefs: 1,
      action: "move",
      target: { folder: "Archive" },
      selectedSenderDomains: ["example.com"],
    });

    expect(scanInputs).toEqual([
      { folder: "INBOX", limit: 1, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 1, order: "oldest", offset: 1 },
    ]);
    expect(result.governance).toMatchObject({
      provider: "fixture",
      folder: "INBOX",
      scanOrder: "oldest",
      scannedMessages: 2,
      selectedMessageRefs: 1,
      mutationsAttempted: 0,
      serverBlocklistCapability: {
        supported: false,
        reason: "Provider capability exposes move only; server-side blocklist or filter mutation is not available through QFerry.",
      },
    });
    expect(result.governance.domainCandidates[0]).toMatchObject({
      domain: "example.com",
      messageCount: 2,
      suggestedRule: {
        groupId: "sender_governance",
        match: { fromDomainIncludes: "example.com" },
        priority: {
          bucketId: "bulk",
          weight: 70,
        },
      },
    });
    expect(result.rulesetPatch).toMatchObject({
      groupToEnsure: { id: "sender_governance", label: "Sender governance" },
      candidateRuleCount: 1,
      skippedDuplicateRules: [],
      rulesToAdd: [
        {
          id: "sender-domain-example-com",
          groupId: "sender_governance",
          match: { fromDomainIncludes: "example.com" },
        },
      ],
    });
    expect(result.plan.status).toBe("preview");
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("drafts selected sender governance rules into a requested classification group", async () => {
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Qodo <hello@qodo.ai>",
        subject: "Code review summary",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "review",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Qodo <updates@qodo.ai>",
        subject: "Pull request agent update",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "agent",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const ruleGroup = {
      id: "ai_dev_tools",
      label: "AI开发工具",
      target: { folder: "其他文件夹/AI开发工具" },
    };
    const result = await tools.planSenderGovernance({
      runId: "run-sender-target-group",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "AI开发工具" },
      selectedSenderDomains: ["qodo.ai"],
      ruleGroup,
    });

    expect(result.governance.domainCandidates[0]).toMatchObject({
      domain: "qodo.ai",
      suggestedRule: {
        groupId: "ai_dev_tools",
        match: { fromDomainIncludes: "qodo.ai" },
      },
    });
    expect(result.rulesetPatch.groupToEnsure).toEqual(ruleGroup);
    expect(result.rulesetPatch.rulesToAdd).toMatchObject([
      {
        id: "sender-domain-qodo-ai",
        groupId: "ai_dev_tools",
        match: { fromDomainIncludes: "qodo.ai" },
      },
    ]);
    expect(result.rulesetPatch.renderedDraft?.groups).toContainEqual(ruleGroup);
    expect(result.plan.messageRefs.map((ref) => ref.uid)).toEqual(["1", "2"]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses a requested classification group target for sender governance plans when no explicit target is passed", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "real", folder: "INBOX", uid: "1", uidValidity: "uv" },
        from: "GitHub <noreply@github.com>",
        subject: "Repository notification",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "updated permissions",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-rule-group-target",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      selectedSenderDomains: ["github.com"],
      ruleGroup: {
        id: "github_notifications",
        label: "GitHub通知",
        target: { folder: "GitHub通知" },
      },
    });

    expect(result.plan.target).toEqual({
      folder: "其他文件夹/GitHub通知",
      requestedFolder: "GitHub通知",
      targetResolution: "qqmail_classification_folder",
    });
    expect(result.plan.messageRefs.map((ref) => ref.uid)).toEqual(["1"]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("breaks a noisy domain down into reusable sender-level governance candidates", async () => {
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "QQ Mail Admin <admin@qq.com>",
        subject: "Birthday greeting",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "system",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "QQ Mail Admin <admin@qq.com>",
        subject: "Product update",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "system",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Friend <friend@qq.com>",
        subject: "Manual note",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "personal",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "4" },
        from: "GitHub <notifications@github.com>",
        subject: "Pull request",
        date: "2026-05-13T00:00:00.000Z",
        snippet: "dev",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await (tools as any).senderBreakdown({
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      order: "oldest",
      fromDomainIncludes: "qq.com",
      maxSenderCandidates: 10,
      ruleGroup: { id: "qq_mail_system", label: "QQ邮箱系统", target: { folder: "其他文件夹/QQ邮箱系统" } },
    });

    expect(result.breakdown).toMatchObject({
      provider: "fixture",
      folder: "INBOX",
      scannedMessages: 4,
      matchedMessages: 3,
      fromDomainIncludes: "qq.com",
      mutationsAttempted: 0,
      candidateSummary: {
        totalSenderCandidates: 2,
        returnedSenderCandidates: 2,
        maxSenderCandidates: 10,
        truncated: false,
      },
    });
    expect(result.breakdown.senderCandidates).toEqual([
      expect.objectContaining({
        sender: "QQ Mail Admin <admin@qq.com>",
        domain: "qq.com",
        messageCount: 2,
        seenCount: 1,
        unreadCount: 1,
        sampleSubjects: ["Birthday greeting", "Product update"],
        suggestedRule: expect.objectContaining({
          id: "sender-from-qq-mail-admin-admin-qq-com",
          groupId: "qq_mail_system",
          match: { fromIncludes: "QQ Mail Admin <admin@qq.com>" },
        }),
      }),
      expect.objectContaining({
        sender: "Friend <friend@qq.com>",
        domain: "qq.com",
        messageCount: 1,
        sampleSubjects: ["Manual note"],
      }),
    ]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses provider bulk metadata windows for sender governance plans when available", async () => {
    const scanCalls: unknown[] = [];
    const bulkScanCalls: unknown[] = [];
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Steam Team <noreply@steampowered.com>",
        subject: "Steam login",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "new login",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Person <person@example.com>",
        subject: "Manual review",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "personal mail",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Steam Support <noreply@steampowered.com>",
        subject: "Refund",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "refund",
        flags: ["\\Seen"],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async (input) => {
          scanCalls.push(input);
          throw new Error("plan_sender_governance should use the provider window scanner");
        },
        scanMailboxMetadataWindow: async (input) => {
          bulkScanCalls.push(input);
          return {
            pagesScanned: 2,
            mailboxSnapshot: { folder: "INBOX", exists: 3, uidValidity: "sender-window" },
            messages,
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-window",
      folder: "INBOX",
      pageSize: 2,
      maxPages: 2,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "Archive/Steam" },
      selectedSenderDomains: ["steampowered.com"],
    });

    expect(scanCalls).toEqual([]);
    expect(bulkScanCalls).toEqual([{ folder: "INBOX", limit: 2, maxPages: 2, order: "oldest", offset: 0 }]);
    expect(result.governance.pagesScanned).toBe(2);
    expect(result.governance.scannedMessages).toBe(3);
    expect(result.governance.selectedMessageRefs).toBe(2);
    expect(result.plan.messageRefs.map((ref) => ref.uid)).toEqual(["1", "3"]);
    expect(result.governance.domainCandidates.find((candidate) => candidate.domain === "steampowered.com")).toMatchObject({
      messageCount: 2,
      seenCount: 1,
    });
  });

  it("resolves bare QQ sender governance targets to classification folder paths", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "real", folder: "INBOX", uid: "1", uidValidity: "uv" },
        from: "GitHub <notifications@github.com>",
        subject: "Review requested",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "pull request",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [{ path: "INBOX" }, { path: "其他文件夹/GitHub通知" }],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
      runtimeConfig: {
        provider: "qqmail",
        accountAlias: "real",
        configSource: "test",
        mutationAllowed: false,
        mutationCapable: true,
        mutationOperationallyReady: true,
        mutationRequiresConfirmation: true,
        authConfigured: true,
        providerReady: true,
        metadataSampleLimit: 50,
        statusWarnings: [],
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-target-resolution",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "GitHub通知" },
      selectedSenderDomains: ["github.com"],
    });

    expect(result.plan.target).toEqual({
      folder: "其他文件夹/GitHub通知",
      requestedFolder: "GitHub通知",
      targetResolution: "qqmail_classification_folder",
    });
    expect(result.governance.targetResolution).toEqual({
      requestedFolder: "GitHub通知",
      resolvedFolder: "其他文件夹/GitHub通知",
      parentPath: "其他文件夹",
      strategy: "qqmail_classification_folder",
    });
  });

  it("truncates sender governance candidates by default while keeping selected domains", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => {
      const domain = `sender-${String(index + 1).padStart(2, "0")}.example.com`;
      return {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `${index + 1}` },
        from: `Sender ${index + 1} <mail@${domain}>`,
        subject: `Subject ${index + 1}`,
        date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "metadata only",
        flags: [],
      };
    });
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-compact",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "Archive" },
      selectedSenderDomains: ["sender-12.example.com"],
    });

    expect(result.governance.candidateSummary).toEqual({
      totalDomainCandidates: 12,
      returnedDomainCandidates: 10,
      maxDomainCandidates: 10,
      truncated: true,
    });
    expect(result.governance.domainCandidates).toHaveLength(10);
    expect(result.governance.domainCandidates.map((candidate) => candidate.domain)).toContain("sender-12.example.com");
  });

  it("keeps all explicitly selected sender domains even when they exceed the compact candidate limit", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => {
      const domain = `selected-${String(index + 1).padStart(2, "0")}.example.com`;
      return {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `${index + 1}` },
        from: `Sender ${index + 1} <mail@${domain}>`,
        subject: `Subject ${index + 1}`,
        date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "metadata only",
        flags: [],
      };
    });
    const selectedSenderDomains = messages.map((message) => message.from.match(/@(.*)>/)?.[1] ?? "");
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-selected-over-limit",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      target: { folder: "Archive" },
      selectedSenderDomains,
      maxDomainCandidates: 3,
    });

    expect(result.governance.domainCandidates.map((candidate) => candidate.domain)).toEqual(selectedSenderDomains);
    expect(result.governance.candidateSummary).toEqual({
      totalDomainCandidates: 12,
      returnedDomainCandidates: 12,
      maxDomainCandidates: 3,
      truncated: false,
    });
  });

  it("deduplicates sender governance rule drafts against existing rules", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.planSenderGovernance({
      runId: "run-sender-governance-dedupe",
      folder: "INBOX",
      pageSize: 2,
      maxPages: 1,
      maxMessageRefs: 0,
      action: "move",
      target: { folder: "Archive" },
      selectedSenderDomains: ["example.com"],
      rules: [
        {
          id: "existing-example-domain",
          groupId: "archive",
          match: { fromDomainIncludes: "example.com" },
        },
      ],
    });

    expect(result.rulesetPatch.rulesToAdd).toEqual([]);
    expect(result.rulesetPatch.skippedDuplicateRules).toEqual([
      {
        ruleId: "existing-example-domain",
        reason: "match already covered by existing rule",
        match: { fromDomainIncludes: "example.com" },
      },
    ]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("plans high-yield governance candidates without drafting broad mixed-domain rules", async () => {
    const messages = [
      ...Array.from({ length: 4 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `s${index + 1}` },
        from: index % 2 === 0 ? "Steam <noreply@steampowered.com>" : "Steam Support <support@steampowered.com>",
        subject: `Steam update ${index + 1}`,
        date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "game platform",
        flags: index === 0 ? ["\\Seen"] : [],
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `q${index + 1}` },
        from: [
          "QQ Mail Admin <admin@qq.com>",
          "Friend <friend@qq.com>",
          "Shop <shop@qq.com>",
        ][index % 3],
        subject: `QQ mixed ${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "mixed domain",
        flags: [],
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `l${index + 1}` },
        from: "Low Yield <notice@low.example.com>",
        subject: `Low yield ${index + 1}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "too small",
        flags: [],
      })),
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await (tools as any).planHighYieldGovernance({
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      order: "oldest",
      minMessageCount: 3,
      maxDistinctSendersForDomainRule: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "其他文件夹/Bulk platform" } },
    });

    expect(result.planner).toMatchObject({
      provider: "fixture",
      folder: "INBOX",
      scannedMessages: 11,
      candidateSummary: {
        totalDomainCandidates: 3,
        returnedHighYieldCandidates: 2,
        directRuleCandidates: 1,
        mixedDomainCandidates: 1,
        lowYieldDomainCandidates: 1,
      },
      recommendedNextAction: "review_mixed_domains",
      mutationsAttempted: 0,
    });
    expect(result.planner.candidates.map((candidate: any) => ({
      domain: candidate.domain,
      messageCount: candidate.messageCount,
      uniqueSenderCount: candidate.uniqueSenderCount,
      recommendedAction: candidate.recommendedAction,
    }))).toEqual([
      { domain: "qq.com", messageCount: 5, uniqueSenderCount: 3, recommendedAction: "break_down_sender" },
      { domain: "steampowered.com", messageCount: 4, uniqueSenderCount: 2, recommendedAction: "draft_domain_rule" },
    ]);
    expect(result.rulesetPatch.rulesToAdd).toMatchObject([
      {
        id: "sender-domain-steampowered-com",
        groupId: "bulk_platform",
        match: { fromDomainIncludes: "steampowered.com" },
      },
    ]);
    expect(result.rulesetPatch.rulesToAdd).toHaveLength(1);
  });

  it("uses runtime rules when planning high-yield governance drafts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-high-yield-default-rules-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "default-rules",
      defaultGroupId: "review",
      groups: [
        { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
        { id: "review", label: "Review" },
      ],
      rules: [{ id: "existing-steam", groupId: "bulk_platform", match: { fromDomainIncludes: "steampowered.com" } }],
    }), "utf8");
    const messages: MessageSummary[] = Array.from({ length: 12 }, (_, index) => ({
      ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: `steam-${index + 1}` },
      from: index % 2 === 0 ? "Steam <noreply@steampowered.com>" : "Steam Support <support@steampowered.com>",
      subject: `Steam update ${index + 1}`,
      date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      snippet: "platform",
      flags: [],
    }));
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
        mutationAllowed: false,
        mutationCapable: false,
        mutationOperationallyReady: false,
        mutationRequiresConfirmation: false,
        authConfigured: false,
        providerReady: true,
        metadataSampleLimit: 10,
        statusWarnings: [],
        rulesFile,
      },
    });

    const result = await (tools as any).planHighYieldGovernance({
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      minMessageCount: 10,
      maxDistinctSendersForDomainRule: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
    });

    expect(result.rulesetPatch.rulesToAdd).toEqual([]);
    expect(result.rulesetPatch.skippedDuplicateRules).toEqual([
      {
        ruleId: "existing-steam",
        reason: "match already covered by existing rule",
        match: { fromDomainIncludes: "steampowered.com" },
      },
    ]);
    expect(result.rulesetPatch.renderedDraft?.rules).toHaveLength(1);
  });

  it("ranks folders for mailbox-wide high-yield governance campaigns", async () => {
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
      "开发社区": Array.from({ length: 11 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "开发社区", uid: `qq-${index + 1}` },
        from: [
          "QQ Mail Admin <admin@qq.com>",
          "Friend <friend@qq.com>",
          "Shop <shop@qq.com>",
        ][index % 3],
        subject: `QQ mixed ${index + 1}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "mixed",
        flags: [],
      })),
    };
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("campaign planner should use the window scanner");
        },
        scanMailboxMetadataWindow: async (input) => {
          scanInputs.push(input);
          return {
            pagesScanned: 1,
            mailboxSnapshot: { folder: input.folder, exists: byFolder[input.folder]?.length ?? 0, uidValidity: "campaign" },
            messages: byFolder[input.folder] ?? [],
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await (tools as any).planMailboxGovernanceCampaign({
      folders: ["INBOX", "Archive", "开发社区"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      order: "oldest",
      minMessageCount: 10,
      maxDistinctSendersForDomainRule: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "其他文件夹/Bulk platform" } },
    });

    expect(scanInputs).toEqual([
      { folder: "INBOX", limit: 50, maxPages: 1, order: "oldest", offset: 0 },
      { folder: "Archive", limit: 50, maxPages: 1, order: "oldest", offset: 0 },
      { folder: "开发社区", limit: 50, maxPages: 1, order: "oldest", offset: 0 },
    ]);
    expect(result.campaign).toMatchObject({
      provider: "fixture",
      foldersScanned: 3,
      scannedMessages: 25,
      recommendedNextAction: "draft_rules",
      folderSummary: {
        draftRuleFolders: 1,
        mixedDomainFolders: 1,
        stopLowYieldFolders: 1,
      },
      mutationsAttempted: 0,
    });
    expect(result.campaign.folderPlans.map((plan: any) => ({
      folder: plan.folder,
      recommendedNextAction: plan.recommendedNextAction,
      directRuleCandidates: plan.candidateSummary.directRuleCandidates,
      mixedDomainCandidates: plan.candidateSummary.mixedDomainCandidates,
    }))).toEqual([
      { folder: "Archive", recommendedNextAction: "draft_rules", directRuleCandidates: 1, mixedDomainCandidates: 0 },
      { folder: "开发社区", recommendedNextAction: "review_mixed_domains", directRuleCandidates: 0, mixedDomainCandidates: 1 },
      { folder: "INBOX", recommendedNextAction: "stop_low_yield", directRuleCandidates: 0, mixedDomainCandidates: 0 },
    ]);
    expect(result.rulesetPatch.rulesToAdd).toMatchObject([
      {
        groupId: "bulk_platform",
        match: { fromDomainIncludes: "steampowered.com", folderEquals: "Archive" },
      },
    ]);
    expect(result.rulesetPatch.rulesToAdd[0]?.id).toMatch(/^sender-domain-steampowered-com-in-archive-[a-f0-9]{8}$/);
  });

  it("uses runtime rules when planning mailbox-wide governance campaigns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-campaign-default-rules-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "default-rules",
      defaultGroupId: "review",
      groups: [
        { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
        { id: "review", label: "Review" },
      ],
      rules: [{ id: "existing-steam", groupId: "bulk_platform", match: { fromDomainIncludes: "steampowered.com", folderEquals: "Archive" } }],
    }), "utf8");
    const byFolder: Record<string, MessageSummary[]> = {
      Archive: Array.from({ length: 12 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "Archive", uid: `steam-${index + 1}` },
        from: index % 2 === 0 ? "Steam <noreply@steampowered.com>" : "Steam Support <support@steampowered.com>",
        subject: `Steam update ${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "platform",
        flags: [],
      })),
    };
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("campaign planner should use the window scanner");
        },
        scanMailboxMetadataWindow: async (input) => ({
          pagesScanned: 1,
          mailboxSnapshot: { folder: input.folder, exists: byFolder[input.folder]?.length ?? 0, uidValidity: "campaign" },
          messages: byFolder[input.folder] ?? [],
        }),
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
        mutationAllowed: false,
        mutationCapable: false,
        mutationOperationallyReady: false,
        mutationRequiresConfirmation: false,
        authConfigured: false,
        providerReady: true,
        metadataSampleLimit: 10,
        statusWarnings: [],
        rulesFile,
      },
    });

    const result = await (tools as any).planMailboxGovernanceCampaign({
      folders: ["Archive"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      minMessageCount: 10,
      maxDistinctSendersForDomainRule: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
    });

    expect(result.campaign.folderSummary.draftRuleFolders).toBe(1);
    expect(result.rulesetPatch.rulesToAdd).toEqual([]);
    expect(result.rulesetPatch.skippedDuplicateRules).toEqual([
      {
        ruleId: "existing-steam",
        reason: "match already covered by existing rule",
        match: { fromDomainIncludes: "steampowered.com", folderEquals: "Archive" },
      },
    ]);
    expect(result.rulesetPatch.renderedDraft?.rules).toHaveLength(1);
  });

  it("keeps scoped campaign rule ids unique for non-ascii folders", async () => {
    const folderA = "\u5176\u4ed6\u6587\u4ef6\u5939/\u5e7f\u544a\u8425\u9500";
    const folderB = "\u5176\u4ed6\u6587\u4ef6\u5939/\u8ba2\u5355\u8d26\u5355";
    const byFolder: Record<string, MessageSummary[]> = Object.fromEntries([folderA, folderB].map((folder) => [
      folder,
      Array.from({ length: 10 }, (_, index) => ({
        ref: { provider: "fixture" as const, accountAlias: "demo", folder, uid: `${folder}-${index + 1}` },
        from: "Steam <noreply@steampowered.com>",
        subject: `Steam ${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        snippet: "platform",
        flags: [],
      })),
    ]));
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("campaign planner should use the window scanner");
        },
        scanMailboxMetadataWindow: async (input) => ({
          pagesScanned: 1,
          mailboxSnapshot: { folder: input.folder, exists: byFolder[input.folder]?.length ?? 0, uidValidity: "campaign" },
          messages: byFolder[input.folder] ?? [],
        }),
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await (tools as any).planMailboxGovernanceCampaign({
      folders: [folderA, folderB],
      pageSize: 50,
      maxPagesPerFolder: 1,
      minMessageCount: 10,
      maxDistinctSendersForDomainRule: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform" },
    });

    expect(result.rulesetPatch.rulesToAdd).toHaveLength(2);
    expect(result.rulesetPatch.rulesToAdd.map((rule: ClassificationRule) => rule.match)).toEqual([
      { fromDomainIncludes: "steampowered.com", folderEquals: folderA },
      { fromDomainIncludes: "steampowered.com", folderEquals: folderB },
    ]);
    const ids = result.rulesetPatch.rulesToAdd.map((rule: ClassificationRule) => rule.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id: string) => id.includes("-in-unknown"))).toBe(false);
    expect(ids.every((id: string) => /^sender-domain-steampowered-com-in-folder-[a-f0-9]{8}$/.test(id))).toBe(true);
  });

  it("scans mailbox governance campaign folders with bounded concurrency", async () => {
    let activeScans = 0;
    let maxActiveScans = 0;
    const scanOrder: string[] = [];
    const byFolder: Record<string, MessageSummary[]> = Object.fromEntries(
      ["Folder A", "Folder B", "Folder C", "Folder D"].map((folder) => [
        folder,
        Array.from({ length: 10 }, (_, index) => ({
          ref: { provider: "fixture" as const, accountAlias: "demo", folder, uid: `${folder}-${index + 1}` },
          from: "Bulk <bulk@example.com>",
          subject: `Bulk ${index + 1}`,
          date: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          snippet: "bulk",
          flags: [],
        })),
      ]),
    );
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("campaign planner should use the window scanner");
        },
        scanMailboxMetadataWindow: async (input) => {
          scanOrder.push(input.folder);
          activeScans += 1;
          maxActiveScans = Math.max(maxActiveScans, activeScans);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeScans -= 1;
          return {
            pagesScanned: 1,
            mailboxSnapshot: { folder: input.folder, exists: byFolder[input.folder]?.length ?? 0, uidValidity: "campaign" },
            messages: byFolder[input.folder] ?? [],
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await (tools as any).planMailboxGovernanceCampaign({
      folders: ["Folder A", "Folder B", "Folder C", "Folder D"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      minMessageCount: 10,
      maxConcurrentFolders: 2,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform" },
    });

    expect(scanOrder).toEqual(["Folder A", "Folder B", "Folder C", "Folder D"]);
    expect(maxActiveScans).toBe(2);
    expect(result.campaign.maxConcurrentFolders).toBe(2);
    expect(result.campaign.foldersScanned).toBe(4);
  });

  it("builds Gmail-like bulk governance previews from sender and content categories", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "1", uidValidity: "999" },
        from: "Microsoft 帐户团队 <account-security-noreply@accountprotection.microsoft.com>",
        subject: "Microsoft 帐户安全代码",
        date: "2023-01-01T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "2", uidValidity: "999" },
        from: "World of Warships <wows_sea@prm.wargaming.net>",
        subject: "高级账号和补给箱——礼物已到位！",
        date: "2023-01-02T00:00:00.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "3", uidValidity: "999" },
        from: "Steam Support <noreply@steampowered.com>",
        subject: "感谢您在 Steam 上的购买！",
        date: "2023-01-03T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "4", uidValidity: "999" },
        from: "World of Warships <wows_sea@prm.wargaming.net>",
        subject: "登录游戏即可领取礼物",
        date: "2023-01-04T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "5", uidValidity: "999" },
        from: "Epic Games <help@acct.epicgames.com>",
        subject: "您的 Epic Games 账号安全代码",
        date: "2023-01-05T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "6", uidValidity: "999" },
        from: "Epic Games <help@email.epicgames.com>",
        subject: "Epic游戏商城协议更新",
        date: "2023-01-06T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "7", uidValidity: "999" },
        from: "no-reply <no-reply@wargaming.net>",
        subject: "您购买了“17,500达布隆”",
        date: "2023-01-07T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
    ];
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        getMailboxSummary: async (folder) => ({ path: folder, exists: messages.length, uidValidity: "999" }),
        getCapabilitySnapshot: async () => ({
          provider: "qqmail",
          accountAlias: "25***@qq.com",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        }),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          const offset = input.offset ?? 0;
          return messages.slice(offset, offset + input.limit);
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.bulkGovernancePreview({
      runId: "run-bulk-governance",
      folder: "INBOX",
      pageSize: 2,
      maxPages: 4,
      maxMessageRefs: 50,
      action: "move",
      target: { folder: "Junk" },
      selectedCategoryIds: ["high_confidence_marketing"],
      order: "oldest",
    });

    expect(scanInputs).toEqual([
      { folder: "INBOX", limit: 2, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 2 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 4 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 6 },
    ]);
    expect(result.preview).toMatchObject({
      provider: "qqmail",
      scannedMessages: 7,
      selectedMessageRefs: 2,
      categoryCounts: {
        high_confidence_marketing: 2,
        receipt_or_purchase: 2,
        review: 1,
        security_or_account: 2,
      },
      mutationsAttempted: 0,
    });
    expect(result.preview.categoryCandidates.high_confidence_marketing?.[0]).toMatchObject({
      domain: "prm.wargaming.net",
      messageCount: 2,
      confidence: "high",
    });
    expect(result.plan.source).toBe("bulk_governance");
    expect(result.plan.messageRefs.map((ref) => ref.uid)).toEqual(["2", "4"]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("recognizes common Chinese account and receipt metadata in bulk governance", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "1", uidValidity: "999" },
        from: "pixiv事务局 <no-reply@pixiv.net>",
        subject: "[pixiv] 新登录通知（登录地点：香港）",
        date: "2026-02-14T08:19:55.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "2", uidValidity: "999" },
        from: "4399 <service_79@4399mail.com>",
        subject: "4399用户找回密码校验",
        date: "2015-03-28T11:58:01.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "3", uidValidity: "999" },
        from: "航旅纵横 <umetrip-cjpz@travelsky.com>",
        subject: "航旅纵横-个人乘机凭证",
        date: "2026-03-03T14:46:28.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "4", uidValidity: "999" },
        from: "Epic Games <help@acct.epicgames.com>",
        subject: "您的 Epic Games 收据 F2411040226457881",
        date: "2024-11-04T02:29:21.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        getMailboxSummary: async (folder) => ({ path: folder, exists: messages.length, uidValidity: "999" }),
        getCapabilitySnapshot: async () => ({
          provider: "qqmail",
          accountAlias: "25***@qq.com",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        }),
        scanMailboxMetadata: async (input) => {
          const offset = input.offset ?? 0;
          return messages.slice(offset, offset + input.limit);
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationSweep({
      folder: "INBOX",
      pageSize: 4,
      maxPages: 1,
      chunkPages: 1,
      order: "oldest",
    });

    expect(result.sweep.categoryCounts).toEqual({
      receipt_or_purchase: 2,
      security_or_account: 2,
    });
  });

  it("splits GitHub notifications into actionable governance subcategories", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "1", uidValidity: "999" },
        from: "raystorm <notifications@github.com>",
        subject: "[owner/repo] PR run failed: Claude Code Review - fix(auth)",
        date: "2026-03-14T01:00:00.000Z",
        snippet: "workflow failed",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "2", uidValidity: "999" },
        from: "sourcery-ai[bot] <notifications@github.com>",
        subject: "Re: [owner/repo] fix(auth): preserve scopes (PR #10)",
        date: "2026-03-14T02:00:00.000Z",
        snippet: "code review comments",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "3", uidValidity: "999" },
        from: "GitHub <notifications@github.com>",
        subject: "[owner/repo] pull request opened: add feature",
        date: "2026-03-14T03:00:00.000Z",
        snippet: "pull request notification",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "4", uidValidity: "999" },
        from: "GitHub <notifications@github.com>",
        subject: "New sign-in to your GitHub account",
        date: "2026-03-14T04:00:00.000Z",
        snippet: "security alert",
        flags: ["\\Seen"],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const map = await tools.classificationMap({
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
    });

    expect(map.map.categoryCounts).toEqual({
      github_account_security: 1,
      github_ci: 1,
      github_code_review: 1,
      github_pr_notification: 1,
    });

    const preview = await tools.bulkGovernancePreview({
      runId: "run-github-code-review-preview",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefs: 50,
      action: "move",
      target: { folder: "GitHub代码审查" },
      selectedCategoryIds: ["github_code_review"],
    });

    expect(preview.preview.selectedMessageRefs).toBe(1);
    expect(preview.preview.categoryCandidates.github_code_review?.[0]).toMatchObject({
      categoryId: "github_code_review",
      domain: "github.com",
      messageCount: 1,
      selectedMessageRefs: 1,
    });
    expect(preview.plan.messageRefs.map((ref) => ref.uid)).toEqual(["2"]);
    expect(preview.plan.target).toEqual({
      folder: "其他文件夹/GitHub代码审查",
      requestedFolder: "GitHub代码审查",
      targetResolution: "qqmail_classification_folder",
    });
  });

  it("builds classification-first mailbox maps without creating operation plans", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "1", uidValidity: "999" },
        from: "Microsoft 帐户团队 <account-security-noreply@accountprotection.microsoft.com>",
        subject: "Microsoft 帐户安全代码",
        date: "2023-01-01T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "2", uidValidity: "999" },
        from: "World of Warships <wows_sea@prm.wargaming.net>",
        subject: "高级账号和补给箱——礼物已到位！",
        date: "2023-01-02T00:00:00.000Z",
        snippet: "size=100",
        flags: ["\\Seen"],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "3", uidValidity: "999" },
        from: "Steam Support <noreply@steampowered.com>",
        subject: "感谢您在 Steam 上的购买！",
        date: "2023-01-03T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "4", uidValidity: "999" },
        from: "World of Warships <wows_sea@prm.wargaming.net>",
        subject: "登录游戏即可领取礼物",
        date: "2023-01-04T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "5", uidValidity: "999" },
        from: "Epic Games <help@acct.epicgames.com>",
        subject: "您的 Epic Games 账号安全代码",
        date: "2023-01-05T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "6", uidValidity: "999" },
        from: "Epic Games <help@email.epicgames.com>",
        subject: "Epic游戏商城协议更新",
        date: "2023-01-06T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "7", uidValidity: "999" },
        from: "no-reply <no-reply@wargaming.net>",
        subject: "您购买了“17,500达布隆”",
        date: "2023-01-07T00:00:00.000Z",
        snippet: "size=100",
        flags: [],
      },
    ];
    const scanInputs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        getMailboxSummary: async (folder) => ({ path: folder, exists: messages.length, uidValidity: "999" }),
        getCapabilitySnapshot: async () => ({
          provider: "qqmail",
          accountAlias: "25***@qq.com",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move"],
          maxRecommendedScanLimit: 50,
        }),
        scanMailboxMetadata: async (input) => {
          scanInputs.push(input);
          const offset = input.offset ?? 0;
          return messages.slice(offset, offset + input.limit);
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationMap({
      folder: "INBOX",
      pageSize: 2,
      maxPages: 4,
      order: "oldest",
    });

    expect(scanInputs).toEqual([
      { folder: "INBOX", limit: 2, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 2 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 4 },
      { folder: "INBOX", limit: 2, order: "oldest", offset: 6 },
    ]);
    expect(result.map).toMatchObject({
      provider: "qqmail",
      scannedMessages: 7,
      categoryCounts: {
        high_confidence_marketing: 2,
        receipt_or_purchase: 2,
        review: 1,
        security_or_account: 2,
      },
      mutationsAttempted: 0,
    });
    expect(result.map.buckets.map((bucket) => ({
      categoryId: bucket.categoryId,
      messageCount: bucket.messageCount,
      recommendedAction: bucket.recommendedAction,
    }))).toEqual([
      { categoryId: "security_or_account", messageCount: 2, recommendedAction: "keep_for_account_history" },
      { categoryId: "receipt_or_purchase", messageCount: 2, recommendedAction: "keep_for_account_history" },
      { categoryId: "high_confidence_marketing", messageCount: 2, recommendedAction: "classify_to_folder" },
      { categoryId: "review", messageCount: 1, recommendedAction: "review" },
    ]);
    expect(result.map.buckets.find((bucket) => bucket.categoryId === "high_confidence_marketing")?.candidates[0]).toMatchObject({
      domain: "prm.wargaming.net",
      messageCount: 2,
      confidence: "high",
    });
    expect("plan" in result).toBe(false);
    expect((result as { plan?: unknown }).plan).toBeUndefined();
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses provider bulk metadata windows for classification maps when available", async () => {
    const scanCalls: unknown[] = [];
    const bulkScanCalls: unknown[] = [];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async (input) => {
          scanCalls.push(input);
          return [];
        },
        scanMailboxMetadataWindow: async (input) => {
          bulkScanCalls.push(input);
          return {
            pagesScanned: 1,
            mailboxSnapshot: { folder: "INBOX", exists: 123, uidValidity: "snapshot-map" },
            messages: [{
              ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
              from: "newsletter@example.com",
              subject: "Weekly digest",
              date: "2026-05-11T00:00:00.000Z",
              snippet: "A low priority newsletter.",
              flags: ["\\Seen"],
            }],
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationMap({
      folder: "INBOX",
      pageSize: 10,
      maxPages: 50,
    });

    expect(scanCalls).toEqual([]);
    expect(bulkScanCalls).toEqual([{ folder: "INBOX", limit: 10, maxPages: 50, order: "oldest", offset: 0 }]);
    expect(result.map.pagesScanned).toBe(1);
    expect(result.map.mailboxSnapshot).toEqual({ folder: "INBOX", exists: 123, uidValidity: "snapshot-map" });
    expect(result.map.categoryCounts).toEqual({ newsletter_or_digest: 1 });
  });

  it("builds progressive classification sweeps without returning message refs", async () => {
    const bulkScanCalls: unknown[] = [];
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Security <security@example.com>",
        subject: "Your verification code",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "account verification",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Newsletter <news@example.com>",
        subject: "Weekly digest",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "weekly newsletter digest",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Promo <promo@example.com>",
        subject: "80% off sale",
        date: "2026-05-13T00:00:00.000Z",
        snippet: "limited time discount",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "4" },
        from: "OpenRouter <hello@openrouter.ai>",
        subject: "API usage report",
        date: "2026-05-14T00:00:00.000Z",
        snippet: "developer platform usage",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "5" },
        from: "Store <store@example.com>",
        subject: "Your receipt",
        date: "2026-05-15T00:00:00.000Z",
        snippet: "purchase receipt",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("not used");
        },
        scanMailboxMetadataWindow: async (input) => {
          bulkScanCalls.push(input);
          const offset = input.offset ?? 0;
          const count = input.limit * input.maxPages;
          return {
            pagesScanned: Math.ceil(messages.slice(offset, offset + count).length / input.limit),
            messages: messages.slice(offset, offset + count),
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationSweep({
      folder: "INBOX",
      pageSize: 2,
      maxPages: 3,
      chunkPages: 1,
      order: "oldest",
    });

    expect(bulkScanCalls).toEqual([
      { folder: "INBOX", limit: 2, maxPages: 1, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 2, maxPages: 1, order: "oldest", offset: 2 },
      { folder: "INBOX", limit: 2, maxPages: 1, order: "oldest", offset: 4 },
    ]);
    expect(result.sweep).toMatchObject({
      scannedMessages: 5,
      pagesScanned: 3,
      complete: false,
      hasMore: true,
      nextScanOffset: 5,
      resumeToken: { offset: 5 },
      categoryCounts: {
        developer_community: 1,
        high_confidence_marketing: 1,
        newsletter_or_digest: 1,
        receipt_or_purchase: 1,
        security_or_account: 1,
      },
      mutationsAttempted: 0,
    });
    expect(result.sweep.chunks).toEqual([
      {
        scanOffset: 0,
        pagesScanned: 1,
        scannedMessages: 2,
        categoryCounts: {
          newsletter_or_digest: 1,
          security_or_account: 1,
        },
      },
      {
        scanOffset: 2,
        pagesScanned: 1,
        scannedMessages: 2,
        categoryCounts: {
          developer_community: 1,
          high_confidence_marketing: 1,
        },
      },
      {
        scanOffset: 4,
        pagesScanned: 1,
        scannedMessages: 1,
        categoryCounts: {
          receipt_or_purchase: 1,
        },
      },
    ]);
    expect(JSON.stringify(result.sweep)).not.toContain("uid");
    expect(JSON.stringify(result.sweep)).not.toContain("sampleSenders");
    expect(JSON.stringify(result.sweep)).not.toContain("sampleSubjectHashes");
    expect(JSON.stringify(result.sweep).length).toBeLessThan(10_000);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("classifies real dogfood sender domains before falling back to review", async () => {
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Bitwarden <no-reply@bitwarden.com>",
        subject: "Your Master Password Hint",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "Account security notification",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "notify-noreply <notify-noreply@google.com>",
        subject: "申诉已获批准",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "Google account appeal result",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Grant Petty <mailout@blackmagic-design.com>",
        subject: "NAB 2024新品资讯！",
        date: "2026-05-13T00:00:00.000Z",
        snippet: "Product news",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "4" },
        from: "community @ Qodo <community@qodo.ai>",
        subject: "What's new in Qodo",
        date: "2026-05-14T00:00:00.000Z",
        snippet: "AI code review platform update",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "5" },
        from: "Nextcloud Provider | TAB.DIGITAL <no-reply@tab.digital>",
        subject: "Your secure cloud is live",
        date: "2026-05-15T00:00:00.000Z",
        snippet: "Developer cloud service",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "6" },
        from: "中国大学生服务外包创新创业大赛 <fwwbds@fwwb.org.cn>",
        subject: "A21赛题不提供任何数据的提醒",
        date: "2026-05-16T00:00:00.000Z",
        snippet: "contest problem notice",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "7" },
        from: "Cloudflare <hello@em1.cloudflare.com>",
        subject: "Boost performance with our newest plan",
        date: "2026-05-17T00:00:00.000Z",
        snippet: "Product campaign",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "8" },
        from: "Security Team <security@example.org>",
        subject: "MFA setup is required",
        date: "2026-05-17T00:00:00.000Z",
        snippet: "Multi-factor authentication reminder",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "9" },
        from: "Baidu <notice@baidu.com>",
        subject: "普通通知",
        date: "2026-05-17T00:00:00.000Z",
        snippet: "generic service notice",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "10" },
        from: "Xiaomi <notice@xiaomi.com>",
        subject: "新品提醒",
        date: "2026-05-17T00:00:00.000Z",
        snippet: "generic product notice",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "11" },
        from: "Friend <friend@example.net>",
        subject: "hello",
        date: "2026-05-17T00:00:00.000Z",
        snippet: "personal mail",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("not used");
        },
        scanMailboxMetadataWindow: async () => ({
          pagesScanned: 1,
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
          messages,
        }),
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationSweep({
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
    });

    expect(result.sweep.categoryCounts).toEqual({
      developer_community: 3,
      high_confidence_marketing: 2,
      review: 3,
      security_or_account: 3,
    });
  });

  it("returns a resume token when a classification sweep reaches the requested window limit", async () => {
    const messages = Array.from({ length: 4 }, (_, index) => ({
      ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: String(index + 1) },
      from: `Newsletter ${index}@example.com`,
      subject: "Weekly digest",
      date: `2026-05-1${index}T00:00:00.000Z`,
      snippet: "weekly newsletter digest",
      flags: [],
    }));
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("not used");
        },
        scanMailboxMetadataWindow: async (input) => {
          const offset = input.offset ?? 0;
          const count = input.limit * input.maxPages;
          return {
            pagesScanned: input.maxPages,
            messages: messages.slice(offset, offset + count),
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationSweep({
      folder: "INBOX",
      pageSize: 2,
      maxPages: 1,
      chunkPages: 1,
      order: "oldest",
    });

    expect(result.sweep).toMatchObject({
      scannedMessages: 2,
      complete: false,
      hasMore: true,
      nextScanOffset: 2,
      resumeToken: { offset: 2 },
      mutationsAttempted: 0,
    });
  });

  it("continues classification sweeps after short non-empty windows", async () => {
    const scanCalls: unknown[] = [];
    const windows = [
      [
        {
          ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
          from: "Newsletter <news@example.com>",
          subject: "Weekly digest",
          date: "2026-05-11T00:00:00.000Z",
          snippet: "weekly newsletter digest",
          flags: [],
        },
      ],
      [
        {
          ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
          from: "Security <security@example.com>",
          subject: "Your verification code",
          date: "2026-05-12T00:00:00.000Z",
          snippet: "account verification",
          flags: [],
        },
      ],
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => {
          throw new Error("not used");
        },
        scanMailboxMetadataWindow: async (input) => {
          scanCalls.push(input);
          const callIndex = scanCalls.length - 1;
          return {
            pagesScanned: 1,
            mailboxSnapshot: {
              folder: "INBOX",
              exists: callIndex === 0 ? 10 : 9,
              uidValidity: "sweep-window",
            },
            messages: windows[callIndex] ?? [],
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationSweep({
      folder: "INBOX",
      pageSize: 10,
      maxPages: 2,
      chunkPages: 1,
      order: "oldest",
    });

    expect(scanCalls).toEqual([
      { folder: "INBOX", limit: 10, maxPages: 1, order: "oldest", offset: 0 },
      { folder: "INBOX", limit: 10, maxPages: 1, order: "oldest", offset: 1 },
    ]);
    expect(result.sweep).toMatchObject({
      scannedMessages: 2,
      pagesScanned: 2,
      complete: false,
      hasMore: true,
      nextScanOffset: 2,
      categoryCounts: {
        newsletter_or_digest: 1,
        security_or_account: 1,
      },
      mutationsAttempted: 0,
    });
    expect(result.sweep.chunks.map((chunk) => chunk.mailboxSnapshot)).toEqual([
      { folder: "INBOX", exists: 10, uidValidity: "sweep-window" },
      { folder: "INBOX", exists: 9, uidValidity: "sweep-window" },
    ]);
  });

  it("keeps recurring service and promo senders out of the generic review bucket", async () => {
    const messages = [
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "1", uidValidity: "999" },
        from: "CSDN <csdn@edmsend.csdn.net>",
        subject: "【蓝桥杯】之考前押题",
        date: "2025-01-01T00:00:00.000Z",
        snippet: "developer learning newsletter",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "2", uidValidity: "999" },
        from: "Hyperskill Crew <hello@hyperskill.org>",
        subject: "Learn Java with new projects",
        date: "2025-01-02T00:00:00.000Z",
        snippet: "course update",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "3", uidValidity: "999" },
        from: "OpenRouter Team <hello@openrouter.ai>",
        subject: "Your OpenRouter usage report",
        date: "2025-01-03T00:00:00.000Z",
        snippet: "developer platform notification",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "4", uidValidity: "999" },
        from: "Windows Insider Program <windowsinsiderprogram@e-mails.microsoft.com>",
        subject: "Windows Insider Preview Build",
        date: "2025-01-04T00:00:00.000Z",
        snippet: "product update newsletter",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "5", uidValidity: "999" },
        from: "NIKKE-OFFICIAL <notice@mail.nikke-official.com>",
        subject: "New event rewards are available",
        date: "2025-01-05T00:00:00.000Z",
        snippet: "limited campaign",
        flags: [],
      },
      {
        ref: { provider: "qqmail" as const, accountAlias: "25***@qq.com", folder: "INBOX", uid: "6", uidValidity: "999" },
        from: "Epic Games <store@mail.epicgames.com>",
        subject: "Spring Sale up to 75% off",
        date: "2025-01-06T00:00:00.000Z",
        snippet: "store promotion",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.classificationMap({
      folder: "INBOX",
      pageSize: 10,
      maxPages: 1,
    });

    expect(result.map.categoryCounts).toEqual({
      developer_community: 3,
      high_confidence_marketing: 2,
      newsletter_or_digest: 1,
    });
    expect(result.map.buckets.map((bucket) => bucket.categoryId)).not.toContain("review");
  });

  it("uses provider bulk metadata windows for Gmail-like governance when available", async () => {
    const scanCalls: unknown[] = [];
    const bulkScanCalls: unknown[] = [];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async (input) => {
          scanCalls.push(input);
          return [];
        },
        scanMailboxMetadataWindow: async (input) => {
          bulkScanCalls.push(input);
          return {
            pagesScanned: 1,
            mailboxSnapshot: { folder: "INBOX", exists: 321, uidValidity: "snapshot-governance" },
            messages: [{
              ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
              from: "newsletter@example.com",
              subject: "Weekly digest",
              date: "2026-05-11T00:00:00.000Z",
              snippet: "A low priority newsletter.",
              flags: ["\\Seen"],
            }],
          };
        },
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.bulkGovernancePreview({
      runId: "run-bulk-window",
      folder: "INBOX",
      pageSize: 10,
      maxPages: 50,
      maxMessageRefs: 100,
      action: "move",
      target: { folder: "Archive" },
      selectedCategoryIds: ["newsletter_or_digest"],
    });

    expect(scanCalls).toEqual([]);
    expect(bulkScanCalls).toEqual([{ folder: "INBOX", limit: 10, maxPages: 50, order: "oldest", offset: 0 }]);
    expect(result.preview.pagesScanned).toBe(1);
    expect(result.preview.mailboxSnapshot).toEqual({ folder: "INBOX", exists: 321, uidValidity: "snapshot-governance" });
    expect(result.preview.selectedMessageRefs).toBe(1);
  });

  it("rejects execute cleanup for unconfirmed preview plans", async () => {
    const provider = FixtureMailProvider.demo();
    const tools = createMailTools({
      provider,
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
      mutationAllowed: false,
      mutationCapable: false,
      mutationOperationallyReady: false,
      mutationRequiresConfirmation: false,
      authConfigured: false,
      providerReady: true,
      metadataSampleLimit: 10,
        statusWarnings: [],
      },
    });
    const plan = await tools.planCleanup({
      runId: "run-execute-preview",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
      selectedGroupIds: ["archive"],
    });

    await expect(tools.executeCleanup({ plan: plan.plan })).rejects.toThrow(/must be confirmed/);
  });

  it("executes confirmed move plans through a mutation-capable provider", async () => {
    const provider = FixtureMailProvider.demo();
    let movedRefs: unknown[] = [];
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
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
          movedRefs = refs;
          expect(targetFolder).toBe("Archive");
          return { moved: refs.length };
        },
      },
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
        mutationAllowed: true,
        mutationCapable: true,
        mutationOperationallyReady: true,
        mutationRequiresConfirmation: true,
        authConfigured: true,
        providerReady: true,
        metadataSampleLimit: 10,
        statusWarnings: [],
      },
    });
    const preview = await tools.planCleanup({
      runId: "run-execute-confirmed",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
      selectedGroupIds: ["archive"],
    });
    const confirmed = confirmOperationPlan(preview.plan, preview.plan.operationPlanId);

    const result = await tools.executeCleanup({ plan: confirmed });

    expect(result.result).toMatchObject({
      operationPlanId: confirmed.operationPlanId,
      status: "executed",
      action: "move",
      attemptedMessages: 1,
      mutationsAttempted: 1,
      moved: 1,
    });
    expect(movedRefs).toEqual([{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" }]);
  });

  it("executes confirmed move plans in source-folder batches with fresh mailbox reconciliation", async () => {
    const provider = FixtureMailProvider.demo();
    const movedRefs: unknown[] = [];
    const counts = new Map([
      ["INBOX", 2],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          movedRefs.push(refs);
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length + 3);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-reconciled",
      provider: "fixture",
      action: "move",
      messageRefs: [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      operationPlanId: plan.operationPlanId,
      status: "executed",
      action: "move",
      attemptedMessages: 2,
      mutationsAttempted: 2,
      moved: 2,
      reconciliationStatus: "target_reconciled_source_unreliable",
      remainingMessages: 0,
      reconciliations: [
        { sourceDelta: 1, targetDelta: 2, reconciliationStatus: "target_reconciled_source_unreliable" },
      ],
      batchAudit: {
        count: 2,
        folders: [
          { folder: "INBOX", count: 2, firstUid: "1", lastUid: "2" },
        ],
      },
    });
    expect(movedRefs).toEqual([
      [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
    ]);
  });

  it("allows move plans when target reconciles but source count changes unexpectedly", async () => {
    const provider = FixtureMailProvider.demo();
    const counts = new Map([
      ["INBOX", 2],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length - 1);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-concurrent-source",
      provider: "fixture",
      action: "move",
      messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      status: "executed",
      moved: 1,
      attemptedMessages: 1,
      mutationsAttempted: 1,
      remainingMessages: 0,
      reconciliationStatus: "target_reconciled_source_unreliable",
      reconciliations: [
        {
          sourceDelta: -2,
          expectedSourceDelta: -1,
          targetDelta: 1,
          expectedTargetDelta: 1,
          targetDeltaReconciled: true,
          sourceDeltaReliable: false,
          sourceDeltaStatus: "concurrent_or_external_change",
          reconciliationStatus: "target_reconciled_source_unreliable",
        },
      ],
      batchAudit: {
        count: 1,
        folders: [
          { folder: "INBOX", count: 1, firstUid: "1", lastUid: "1" },
        ],
      },
    });
  });

  it("allows source count drift after target reconciliation for larger move batches", async () => {
    const provider = FixtureMailProvider.demo();
    const counts = new Map([
      ["INBOX", 20],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length - 1);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-bounded-source-drift",
      provider: "fixture",
      action: "move",
      messageRefs: Array.from({ length: 7 }, (_, index) => ({
        provider: "fixture" as const,
        accountAlias: "demo",
        folder: "INBOX",
        uid: String(index + 1),
      })),
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      status: "executed",
      moved: 7,
      attemptedMessages: 7,
      mutationsAttempted: 7,
      remainingMessages: 0,
      reconciliationStatus: "target_reconciled_source_unreliable",
      reconciliations: [
        {
          sourceDelta: -8,
          expectedSourceDelta: -7,
          targetDelta: 7,
          expectedTargetDelta: 7,
          targetDeltaReconciled: true,
          sourceDeltaReliable: false,
          sourceDeltaStatus: "concurrent_or_external_change",
          reconciliationStatus: "target_reconciled_source_unreliable",
        },
      ],
    });
  });

  it("treats source count drops explained by pre-existing deleted messages as reconciled", async () => {
    const provider = FixtureMailProvider.demo();
    const counts = new Map([
      ["INBOX", 100],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
        }),
        getDeletedMessageCount: async (folder) => (folder === "INBOX" ? 29 : 0),
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
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length - 29);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-deleted-expunge",
      provider: "fixture",
      action: "move",
      messageRefs: Array.from({ length: 34 }, (_, index) => ({
        provider: "fixture" as const,
        accountAlias: "demo",
        folder: "INBOX",
        uid: String(index + 1),
      })),
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      status: "executed",
      moved: 34,
      attemptedMessages: 34,
      mutationsAttempted: 34,
      remainingMessages: 0,
      reconciliationStatus: "matched",
      reconciliations: [
        {
          sourceDelta: -63,
          expectedSourceDelta: -34,
          targetDelta: 34,
          expectedTargetDelta: 34,
          targetDeltaReconciled: true,
          sourceDeletedBefore: 29,
          sourceDeltaReliable: true,
          sourceDeltaStatus: "matched_with_deleted_expunge",
          reconciliationStatus: "matched",
        },
      ],
    });
  });

  it("reports partial provider move counts as partially executed after target reconciliation", async () => {
    const provider = FixtureMailProvider.demo();
    const counts = new Map([
      ["INBOX", 3],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          const actuallyMoved = refs.slice(0, 2);
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - actuallyMoved.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + actuallyMoved.length);
          return { moved: actuallyMoved.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-partial-provider-count",
      provider: "fixture",
      action: "move",
      messageRefs: [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "3" },
      ],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      operationPlanId: plan.operationPlanId,
      status: "executed",
      action: "move",
      attemptedMessages: 3,
      mutationsAttempted: 3,
      moved: 2,
      reconciliationStatus: "matched",
      totalPlanMessages: 3,
      remainingMessages: 0,
      reconciliations: [
        {
          sourceDelta: -2,
          targetDelta: 2,
          expectedSourceDelta: -2,
          expectedTargetDelta: 2,
          reconciliationStatus: "matched",
        },
      ],
    });
  });

  it("infers moved messages from target reconciliation when provider move count is unknown", async () => {
    const provider = FixtureMailProvider.demo();
    const counts = new Map([
      ["INBOX", 2],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: 0, movedCountStatus: "unknown" };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-provider-unknown-count",
      provider: "fixture",
      action: "move",
      messageRefs: [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      operationPlanId: plan.operationPlanId,
      status: "executed",
      action: "move",
      attemptedMessages: 2,
      mutationsAttempted: 2,
      moved: 2,
      reconciliationStatus: "provider_result_unreliable",
      totalPlanMessages: 2,
      remainingMessages: 0,
      reconciliations: [
        {
          sourceDelta: -2,
          targetDelta: 2,
          expectedSourceDelta: undefined,
          expectedTargetDelta: undefined,
          targetDeltaReconciled: true,
          sourceDeltaReliable: true,
          sourceDeltaStatus: "matched",
          reconciliationStatus: "provider_result_unreliable",
        },
      ],
    });
  });

  it("executes only the requested move chunk and reports remaining messages", async () => {
    const provider = FixtureMailProvider.demo();
    const movedRefs: unknown[] = [];
    const counts = new Map([
      ["INBOX", 3],
      ["Archive", 0],
    ]);
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getMailboxSummary: async (folder) => ({
          path: folder,
          exists: counts.get(folder) ?? 0,
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
          movedRefs.push(refs);
          const sourceFolder = refs[0]?.folder ?? "";
          counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - refs.length);
          counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + refs.length);
          return { moved: refs.length };
        },
      },
    });
    const previewPlan = createOperationPlan({
      runId: "run-execute-chunked",
      provider: "fixture",
      action: "move",
      messageRefs: [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "3" },
      ],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan, maxMessages: 2 });

    expect(result.result).toMatchObject({
      operationPlanId: plan.operationPlanId,
      status: "partially_executed",
      action: "move",
      attemptedMessages: 2,
      mutationsAttempted: 2,
      moved: 2,
      reconciliationStatus: "matched",
      totalPlanMessages: 3,
      remainingMessages: 1,
      executionBatch: { requestedMaxMessages: 2, executedMessages: 2 },
      reconciliations: [
        { sourceDelta: -2, targetDelta: 2, reconciliationStatus: "matched" },
      ],
    });
    expect(movedRefs).toEqual([
      [
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
        { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
      ],
    ]);
  });

  it("keeps prototype provider mutation methods when using fresh reconciliation", async () => {
    const fixture = FixtureMailProvider.demo();
    const movedRefs: unknown[] = [];
    const counts = new Map([
      ["INBOX", 1],
      ["Archive", 0],
    ]);
    class PrototypeMoveProvider {
      async listMailboxes() {
        return fixture.listMailboxes();
      }

      async scanMailboxMetadata(input: Parameters<typeof fixture.scanMailboxMetadata>[0]) {
        return fixture.scanMailboxMetadata(input);
      }

      async fetchMessage(input: Parameters<typeof fixture.fetchMessage>[0]) {
        return fixture.fetchMessage(input);
      }

      async getMailboxSummary(folder: string) {
        return {
          path: folder,
          exists: counts.get(folder) ?? 0,
        };
      }

      async getCapabilitySnapshot() {
        return {
          provider: "fixture" as const,
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move" as const],
          maxRecommendedScanLimit: 10,
        };
      }

      async moveMessages(refs: { folder: string }[], targetFolder: string) {
        movedRefs.push(refs);
        expect(refs).toHaveLength(1);
        const sourceFolder = refs[0]?.folder ?? "";
        counts.set(sourceFolder, (counts.get(sourceFolder) ?? 0) - 1);
        counts.set(targetFolder, (counts.get(targetFolder) ?? 0) + 1);
        return { moved: refs.length };
      }
    }
    const tools = createMailTools({ provider: new PrototypeMoveProvider() });
    const previewPlan = createOperationPlan({
      runId: "run-execute-prototype-provider",
      provider: "fixture",
      action: "move",
      messageRefs: [{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }],
      target: { folder: "Archive" },
    });
    const plan = confirmOperationPlan(previewPlan, previewPlan.operationPlanId);

    const result = await tools.executeCleanup({ plan });

    expect(result.result).toMatchObject({
      status: "executed",
      attemptedMessages: 1,
      mutationsAttempted: 1,
      moved: 1,
      reconciliationStatus: "matched",
      reconciliations: [{ sourceDelta: -1, targetDelta: 1, reconciliationStatus: "matched" }],
    });
    expect(movedRefs).toEqual([[{ provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" }]]);
  });

  it("previews creation of missing classification folders using display names", async () => {
    const provider = FixtureMailProvider.demo();
    const tools = createMailTools({ provider });

    const result = await tools.ensureClassificationFolder({
      runId: "run-folder-preview",
      displayName: "开发社区",
    });

    expect(result.folder).toEqual({
      displayName: "开发社区",
      fullPath: "其他文件夹/开发社区",
      exists: false,
      parentPath: "其他文件夹",
    });
    expect(result.plan).toMatchObject({
      runId: "run-folder-preview",
      provider: "fixture",
      action: "create_folder",
      status: "preview",
      target: {
        folder: "其他文件夹/开发社区",
        displayName: "开发社区",
        parentPath: "其他文件夹",
      },
      messageRefs: [],
    });
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses runtime classification parent path for classification folders", async () => {
    const provider = FixtureMailProvider.demo();
    const tools = createMailTools({
      provider,
      runtimeConfig: {
        provider: "qqmail",
        accountAlias: "25***@qq.com",
        configSource: "test",
        mutationAllowed: true,
        mutationCapable: true,
        mutationOperationallyReady: true,
        mutationRequiresConfirmation: true,
        authConfigured: true,
        providerReady: true,
        metadataSampleLimit: 1,
        statusWarnings: [],
        qqmail: {
          email: "25abc@qq.com",
          authCodePresent: true,
          imapHost: "imap.qq.com",
          imapPort: 993,
          classificationParentPath: "User Folders",
        },
      },
    });

    const result = await tools.ensureClassificationFolder({
      runId: "run-folder-strategy",
      displayName: "Group Alpha",
    });

    expect(result.folder).toEqual({
      displayName: "Group Alpha",
      fullPath: "User Folders/Group Alpha",
      exists: false,
      parentPath: "User Folders",
    });
    expect(result.plan?.target).toEqual({
      folder: "User Folders/Group Alpha",
      displayName: "Group Alpha",
      parentPath: "User Folders",
    });
  });

  it("returns existing classification folders without a create plan", async () => {
    const provider = FixtureMailProvider.demo();
    const tools = createMailTools({ provider });

    const result = await tools.ensureClassificationFolder({
      runId: "run-folder-existing",
      displayName: "Archive",
      parentPath: "",
    });

    expect(result.folder).toEqual({
      displayName: "Archive",
      fullPath: "Archive",
      exists: true,
      parentPath: "",
    });
    expect(result.plan).toBeUndefined();
    expect(result.mutationsAttempted).toBe(0);
  });

  it("executes confirmed create-folder plans through a mutation-capable provider", async () => {
    const provider = FixtureMailProvider.demo();
    let createdFolder = "";
    const tools = createMailTools({
      provider: {
        ...provider,
        listMailboxes: provider.listMailboxes.bind(provider),
        scanMailboxMetadata: provider.scanMailboxMetadata.bind(provider),
        fetchMessage: provider.fetchMessage.bind(provider),
        getCapabilitySnapshot: async () => ({
          provider: "fixture",
          accountAlias: "demo",
          supportsListMailboxes: true,
          supportsMetadataScan: true,
          supportsFetchMessage: true,
          supportsMutation: true,
          mutationActions: ["move", "create_folder"],
          maxRecommendedScanLimit: 10,
        }),
        createMailbox: async (folder) => {
          createdFolder = folder;
          return { path: folder, created: true };
        },
      },
      runtimeConfig: {
        provider: "fixture",
        accountAlias: "demo",
        configSource: "test",
        mutationAllowed: true,
        mutationCapable: true,
        mutationOperationallyReady: true,
        mutationRequiresConfirmation: true,
        authConfigured: true,
        providerReady: true,
        metadataSampleLimit: 10,
        statusWarnings: [],
      },
    });
    const preview = await tools.ensureClassificationFolder({
      runId: "run-create-folder-confirmed",
      displayName: "广告营销",
    });
    const confirmed = confirmOperationPlan(preview.plan!, preview.plan!.operationPlanId);

    const result = await tools.executeCleanup({ plan: confirmed });

    expect(result.result).toMatchObject({
      operationPlanId: confirmed.operationPlanId,
      status: "executed",
      action: "create_folder",
      attemptedMessages: 0,
      mutationsAttempted: 1,
      createdFolder: "其他文件夹/广告营销",
    });
    expect(createdFolder).toBe("其他文件夹/广告营销");
  });

  it("marks direct message-ref cleanup plans as client refs and limits their size", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });
    const refs = Array.from({ length: 21 }, (_, index) => ({
      provider: "fixture" as const,
      accountAlias: "demo",
      folder: "INBOX",
      uid: String(index + 1),
    }));

    await expect(tools.planCleanup({
      runId: "run-too-many-client-refs",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      messageRefs: refs,
      selectedGroupIds: [],
    })).rejects.toThrow(/client_refs cleanup plans are limited to 20 message refs/);

    const result = await tools.planCleanup({
      runId: "run-client-refs",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      messageRefs: refs.slice(0, 2),
      selectedGroupIds: [],
    });

    expect(result.plan.source).toBe("client_refs");
    expect(result.plan.messageRefs).toHaveLength(2);
  });

  it("creates preview cleanup plans from a rules file and returns ruleset metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "rules-v2",
      defaultGroupId: "review",
      groups: [
        { id: "archive", label: "Archive" },
        { id: "review", label: "Review" },
      ],
      rules: [{ id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.planCleanup({
      runId: "run-2",
      folder: "INBOX",
      limit: 10,
      action: "move",
      target: { folder: "Archive" },
      rulesFile,
      selectedGroupIds: ["archive"],
    });

    expect(result.ruleset).toMatchObject({
      source: rulesFile,
      version: "rules-v2",
      ruleCount: 1,
    });
    expect(result.plan.status).toBe("preview");
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
    expect(result.mutationsAttempted).toBe(0);
  });

  it("uses a selected ruleset group target folder when previewing cleanup without an explicit target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-target-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "rules-target",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "github", label: "GitHub 通知", target: { folder: "其他文件夹/GitHub通知" } },
      ],
      rules: [{ id: "github-domain", groupId: "github", match: { fromDomainIncludes: "github.com" } }],
    }), "utf8");
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => [{
          ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
          from: "GitHub <notifications@github.com>",
          subject: "Repository notification",
          date: "2026-05-15T00:00:00.000Z",
          snippet: "Issue update",
          flags: [],
        }],
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.previewCleanupBatch({
      runId: "rules-target-folder",
      folder: "INBOX",
      pageSize: 10,
      maxPages: 1,
      maxMessageRefs: 10,
      action: "move",
      rulesFile,
      selectedGroupIds: ["github"],
    });

    expect(result.plan.target).toEqual({ folder: "其他文件夹/GitHub通知" });
    expect(result.preview.selectedGroupTargets).toEqual({
      github: { folder: "其他文件夹/GitHub通知" },
    });
  });

  it("previews ruleset governance by user-defined groups and targets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-ruleset-governance-"));
    const rulesFile = join(dir, "qferry.rules.json");
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
    const messages = [
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "1" },
        from: "Alpha One <one@alpha.example>",
        subject: "Alpha one",
        date: "2026-05-10T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "2" },
        from: "Alpha Two <two@alpha.example>",
        subject: "Alpha two",
        date: "2026-05-11T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "3" },
        from: "Beta <notice@beta.example>",
        subject: "Beta",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
      {
        ref: { provider: "fixture" as const, accountAlias: "demo", folder: "INBOX", uid: "4" },
        from: "Friend <friend@example.net>",
        subject: "Manual review",
        date: "2026-05-13T00:00:00.000Z",
        snippet: "",
        flags: [],
      },
    ];
    const tools = createMailTools({
      provider: {
        listMailboxes: async () => [],
        scanMailboxMetadata: async () => messages,
        scanMailboxMetadataWindow: async () => ({
          pagesScanned: 1,
          mailboxSnapshot: { folder: "INBOX", exists: messages.length },
          messages,
        }),
        fetchMessage: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await tools.rulesetGovernancePreview({
      runId: "ruleset-governance",
      folder: "INBOX",
      pageSize: 50,
      maxPages: 1,
      maxMessageRefsPerGroup: 50,
      action: "move",
      rulesFile,
      selectedGroupIds: ["group_alpha", "group_beta"],
    });

    expect(result.preview.groupCounts).toEqual({
      group_alpha: 2,
      group_beta: 1,
      review: 1,
    });
    expect(result.preview.campaignReport).toEqual({
      scannedMessages: 4,
      plannedMessages: 3,
      unplannedMessages: 1,
      coverageBasis: "scanned_window",
      coverageRatio: 0.75,
      planCount: 2,
      truncatedGroups: [],
      topUnplannedDomains: [
        { domain: "example.net", messageCount: 1 },
      ],
      topUnplannedSenders: [
        {
          sender: "Friend <friend@example.net>",
          domain: "example.net",
          messageCount: 1,
          sampleSubjects: ["Manual review"],
        },
      ],
      nextAction: "review_rules",
    });
    expect(result.preview.groupPlans).toEqual([
      expect.objectContaining({
        groupId: "group_alpha",
        label: "Group Alpha",
        target: { folder: "Folders/Group Alpha" },
        selectedMessageRefs: 2,
        totalMatchedMessages: 2,
      }),
      expect.objectContaining({
        groupId: "group_beta",
        label: "Group Beta",
        target: { folder: "Folders/Group Beta" },
        selectedMessageRefs: 1,
        totalMatchedMessages: 1,
      }),
    ]);
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((plan) => plan.target)).toEqual([
      { folder: "Folders/Group Alpha" },
      { folder: "Folders/Group Beta" },
    ]);
    expect(result.plans.map((plan) => plan.messageRefs.length)).toEqual([2, 1]);
    expect(result.mutationsAttempted).toBe(0);
  });
});
