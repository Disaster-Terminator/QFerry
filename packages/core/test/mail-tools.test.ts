import { describe, expect, it } from "vitest";

import { createMailTools } from "../src/tools/mail-tools.js";
import { FixtureMailProvider } from "../src/providers/fixture-provider.js";

describe("mail tools", () => {
  it("lists mailboxes through the provider", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.listMailboxes();

    expect(result.mailboxes.map((mailbox) => mailbox.path)).toEqual(["INBOX", "Archive"]);
  });

  it("searches bounded metadata without returning message bodies", async () => {
    const tools = createMailTools({ provider: FixtureMailProvider.demo() });

    const result = await tools.search({ folder: "INBOX", limit: 10, query: "digest" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.subject).toBe("Weekly digest");
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
});
