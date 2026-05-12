import { describe, expect, it } from "vitest";

import { QqReadOnlyProvider } from "../src/providers/qq-readonly-provider.js";

function asyncMessages(messages: Array<{
  uid: number;
  flags?: Set<string>;
  size?: number;
  internalDate?: Date | string;
  envelope?: {
    from?: Array<{ name?: string; address?: string }>;
    subject?: string;
    date?: Date;
  };
}>) {
  return (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();
}

describe("QQ read-only provider", () => {
  it("lists mailboxes and reports mutation-disabled capability", async () => {
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [
        { path: "INBOX", delimiter: "/", flags: new Set(["\\Inbox"]) },
      ],
      mailboxOpen: async () => ({ exists: 0 }),
      fetch: () => asyncMessages([]),
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
    });

    await expect(provider.listMailboxes()).resolves.toEqual([
      { path: "INBOX", delimiter: "/", flags: ["\\Inbox"] },
    ]);
    await expect(provider.getCapabilitySnapshot()).resolves.toMatchObject({
      provider: "qqmail",
      accountAlias: "masked@qq.com",
      supportsMutation: false,
      maxRecommendedScanLimit: 10,
    });
  });

  it("scans bounded metadata without body text", async () => {
    const fetchCalls: unknown[] = [];
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async () => ({ exists: 3, uidValidity: 777n }),
      fetch: (range: unknown, query: unknown, options: unknown) => {
        fetchCalls.push({ range, query, options });
        return asyncMessages([
          {
            uid: 41,
            flags: new Set(["\\Seen"]),
            size: 1000,
            internalDate: new Date("2026-05-12T00:00:00.000Z"),
            envelope: {
              from: [{ name: "Security", address: "security@example.com" }],
              subject: "Security alert",
              date: new Date("2026-05-12T00:00:00.000Z"),
            },
          },
        ]);
      },
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
    });

    const messages = await provider.scanMailboxMetadata({ folder: "INBOX", limit: 1 });

    expect(fetchCalls).toEqual([
      {
        range: "3:3",
        query: { envelope: true, flags: true, internalDate: true, size: true, uid: true },
        options: { uid: false },
      },
    ]);
    expect(messages).toEqual([
      {
        ref: {
          provider: "qqmail",
          accountAlias: "masked@qq.com",
          folder: "INBOX",
          uid: "41",
          uidValidity: "777",
        },
        from: "Security <security@example.com>",
        subject: "Security alert",
        date: "2026-05-12T00:00:00.000Z",
        snippet: "size=1000",
        flags: ["\\Seen"],
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain("bodyText");
  });
});
