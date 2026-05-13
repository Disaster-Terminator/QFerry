import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createMailTools } from "../src/tools/mail-tools.js";
import { FixtureMailProvider } from "../src/providers/fixture-provider.js";
import { confirmOperationPlan } from "../src/operation-plan.js";

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
    expect(result.plan.status).toBe("preview");
    expect(result.plan.messageRefs).toEqual([
      { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
    ]);
    expect(result.mutationsAttempted).toBe(0);
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
});
