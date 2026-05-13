import { describe, expect, it } from "vitest";

import { classifyMessages } from "../src/classification.js";
import type { MessageSummary } from "../src/providers/types.js";

const baseMessage: MessageSummary = {
  ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
  from: "security@example.com",
  subject: "Security alert",
  date: "2026-05-12T00:00:00.000Z",
  snippet: "A security notification that should be reviewed.",
  flags: [],
};

describe("classification", () => {
  it("assigns messages to the first matching local group and explains the match", () => {
    const results = classifyMessages({
      messages: [baseMessage],
      defaultGroupId: "review",
      rules: [
        {
          id: "security-sender",
          groupId: "important",
          match: { fromIncludes: "security@" },
        },
      ],
    });

    expect(results).toEqual([
      {
        messageRef: baseMessage.ref,
        groupId: "important",
        matchedRuleId: "security-sender",
        explanation: "from includes security@",
      },
    ]);
  });

  it("can match subject, snippet, folder, and flags without reading bodies", () => {
    const results = classifyMessages({
      messages: [
        {
          ...baseMessage,
          ref: { ...baseMessage.ref, uid: "2" },
          from: "newsletter@example.com",
          subject: "Weekly digest",
          snippet: "Low priority reading",
          flags: ["\\Seen"],
        },
      ],
      defaultGroupId: "review",
      rules: [
        {
          id: "newsletter",
          groupId: "bulk",
          match: {
            subjectIncludes: "digest",
            snippetIncludes: "priority",
            folderEquals: "INBOX",
            hasFlag: "\\Seen",
          },
        },
      ],
    });

    expect(results[0]?.groupId).toBe("bulk");
    expect(results[0]?.explanation).toBe("subject includes digest; snippet includes priority; folder equals INBOX; has flag \\Seen");
    expect(JSON.stringify(results)).not.toContain("body");
  });

  it("can match a sender domain without matching the display name", () => {
    const results = classifyMessages({
      messages: [{
        ...baseMessage,
        from: "Epic Games <store@mail.epicgames.com>",
        subject: "Spring sale",
      }],
      defaultGroupId: "review",
      rules: [
        {
          id: "epic-domain",
          groupId: "bulk",
          match: { fromDomainIncludes: "epicgames.com" },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      groupId: "bulk",
      matchedRuleId: "epic-domain",
      explanation: "from domain includes epicgames.com",
    });
  });

  it("uses the default group when no rule matches", () => {
    const results = classifyMessages({
      messages: [baseMessage],
      defaultGroupId: "review",
      rules: [
        {
          id: "billing",
          groupId: "finance",
          match: { fromIncludes: "billing@" },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      messageRef: baseMessage.ref,
      groupId: "review",
      matchedRuleId: undefined,
      explanation: "no rule matched",
    });
  });
});
