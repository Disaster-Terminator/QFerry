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

  it("can scan oldest bounded metadata", async () => {
    const fetchCalls: unknown[] = [];
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async () => ({ exists: 3000, uidValidity: 777n }),
      fetch: (range: unknown, query: unknown, options: unknown) => {
        fetchCalls.push({ range, query, options });
        return asyncMessages([]);
      },
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
      maxRecommendedScanLimit: 10,
    });

    await provider.scanMailboxMetadata({ folder: "INBOX", limit: 5, order: "oldest" });

    expect(fetchCalls).toEqual([
      {
        range: "1:5",
        query: { envelope: true, flags: true, internalDate: true, size: true, uid: true },
        options: { uid: false },
      },
    ]);
  });

  it("summarizes a QQ mailbox with read-only open", async () => {
    const opened: unknown[] = [];
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async (path: string, options: unknown) => {
        opened.push({ path, options });
        return { exists: 3127, uidValidity: 888n };
      },
      fetch: () => asyncMessages([]),
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
    });

    await expect(provider.getMailboxSummary("INBOX")).resolves.toEqual({
      path: "INBOX",
      exists: 3127,
      uidValidity: "888",
    });
    expect(opened).toEqual([{ path: "INBOX", options: { readOnly: true } }]);
  });

  it("wraps QQ IMAP command failures with operation context", async () => {
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async () => {
        throw new Error("Command failed");
      },
      fetch: () => asyncMessages([]),
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
    });

    await expect(provider.getMailboxSummary("INBOX")).rejects.toMatchObject({
      name: "QqProviderError",
      provider: "qqmail",
      operation: "get_mailbox_summary",
      stage: "command",
      originalMessage: "Command failed",
    });
    await expect(provider.getMailboxSummary("INBOX")).rejects.toThrow(
      /QQ IMAP get_mailbox_summary failed during command/,
    );
  });

  it("serializes concurrent QQ IMAP operations through one provider", async () => {
    let activeConnections = 0;
    let maxActiveConnections = 0;
    const clientFactory = () => ({
      connect: async () => {
        activeConnections += 1;
        maxActiveConnections = Math.max(maxActiveConnections, activeConnections);
      },
      logout: async () => {
        activeConnections -= 1;
      },
      list: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [{ path: "INBOX", delimiter: "/", flags: new Set<string>() }];
      },
      mailboxOpen: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { exists: 1, uidValidity: 1n };
      },
      fetch: () => asyncMessages([]),
    });
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory,
    });

    await Promise.all([
      provider.listMailboxes(),
      provider.getMailboxSummary("INBOX"),
    ]);

    expect(maxActiveConnections).toBe(1);
  });
});
