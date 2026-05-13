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

  it("can scan oldest metadata after an offset", async () => {
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

    await provider.scanMailboxMetadata({ folder: "INBOX", limit: 5, order: "oldest", offset: 10 });

    expect(fetchCalls).toEqual([
      {
        range: "11:15",
        query: { envelope: true, flags: true, internalDate: true, size: true, uid: true },
        options: { uid: false },
      },
    ]);
  });

  it("scans QQ metadata windows through one IMAP connection", async () => {
    const fetchCalls: unknown[] = [];
    let connectCalls = 0;
    const client = {
      connect: async () => {
        connectCalls += 1;
      },
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async () => ({ exists: 5, uidValidity: 999n }),
      fetch: (range: unknown, query: unknown, options: unknown) => {
        fetchCalls.push({ range, query, options });
        const uids = range === "1:2" ? [1, 2] : range === "3:4" ? [3, 4] : [5];
        return asyncMessages(uids.map((uid) => ({
          uid,
          flags: new Set(),
          size: 512,
          internalDate: new Date("2026-05-01T00:00:00.000Z"),
          envelope: {
            from: [{ name: "Sender", address: `${uid}@example.com` }],
            subject: `Message ${uid}`,
            date: new Date("2026-05-01T00:00:00.000Z"),
          },
        })));
      },
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
      maxRecommendedScanLimit: 2,
    });

    const result = await provider.scanMailboxMetadataWindow({
      folder: "INBOX",
      limit: 2,
      maxPages: 3,
      order: "oldest",
      offset: 0,
    });

    expect(connectCalls).toBe(1);
    expect(fetchCalls.map((call) => (call as { range: unknown }).range)).toEqual(["1:2", "3:4", "5:5"]);
    expect(result.pagesScanned).toBe(3);
    expect(result.messages.map((message) => message.ref.uid)).toEqual(["1", "2", "3", "4", "5"]);
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

  it("fetches a QQ message by UID instead of bounded rescanning", async () => {
    const fetchCalls: unknown[] = [];
    const client = {
      connect: async () => undefined,
      logout: async () => undefined,
      list: async () => [],
      mailboxOpen: async () => ({ exists: 3000, uidValidity: 999n }),
      fetch: (range: unknown, query: unknown, options: unknown) => {
        fetchCalls.push({ range, query, options });
        return asyncMessages([{
          uid: 2048,
          flags: new Set(["\\Seen"]),
          size: 512,
          internalDate: new Date("2026-05-01T00:00:00.000Z"),
          envelope: {
            from: [{ name: "Promo", address: "promo@example.com" }],
            subject: "Old promotion",
            date: new Date("2026-05-01T00:00:00.000Z"),
          },
        }]);
      },
    };
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => client,
      maxRecommendedScanLimit: 1,
    });

    const message = await provider.fetchMessage({
      provider: "qqmail",
      accountAlias: "masked@qq.com",
      folder: "INBOX",
      uid: "2048",
      uidValidity: "999",
    });

    expect(fetchCalls).toEqual([{
      range: "2048",
      query: { envelope: true, flags: true, internalDate: true, size: true, uid: true },
      options: { uid: true },
    }]);
    expect(message).toMatchObject({
      ref: {
        provider: "qqmail",
        accountAlias: "masked@qq.com",
        folder: "INBOX",
        uid: "2048",
        uidValidity: "999",
      },
      from: "Promo <promo@example.com>",
      subject: "Old promotion",
      bodyText: "",
    });
  });

  it("rejects QQ fetch refs without UIDVALIDITY", async () => {
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async () => ({ exists: 1, uidValidity: 999n }),
        fetch: () => asyncMessages([]),
      }),
    });

    await expect(provider.fetchMessage({
      provider: "qqmail",
      accountAlias: "masked@qq.com",
      folder: "INBOX",
      uid: "2048",
    })).rejects.toThrow(/requires UIDVALIDITY/);
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

  it("waits between sequential QQ IMAP connections to avoid rapid reconnects", async () => {
    const sleeps: number[] = [];
    let connectCount = 0;
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      connectionCooldownMs: 250,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      clientFactory: () => ({
        connect: async () => {
          connectCount += 1;
        },
        logout: async () => undefined,
        list: async () => [{ path: "INBOX", delimiter: "/", flags: new Set<string>() }],
        mailboxOpen: async () => ({ exists: 1, uidValidity: 1n }),
        fetch: () => asyncMessages([]),
      }),
    });

    await provider.listMailboxes();
    await provider.getMailboxSummary("INBOX");

    expect(connectCount).toBe(2);
    expect(sleeps).toEqual([250]);
  });

  it("retries transient QQ IMAP connection failures once", async () => {
    const sleeps: number[] = [];
    let connectAttempts = 0;
    let clientCount = 0;
    const provider = new QqReadOnlyProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      connectRetryDelayMs: 500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      clientFactory: () => {
        clientCount += 1;
        const clientNumber = clientCount;
        return {
          connect: async () => {
            connectAttempts += 1;
            if (clientNumber === 1) {
              throw new Error("Failed to establish connection in required time");
            }
          },
          logout: async () => undefined,
          list: async () => [{ path: "INBOX", delimiter: "/", flags: new Set<string>() }],
          mailboxOpen: async () => ({ exists: 1, uidValidity: 1n }),
          fetch: () => asyncMessages([]),
        };
      },
    });

    await expect(provider.listMailboxes()).resolves.toEqual([
      { path: "INBOX", delimiter: "/", flags: [] },
    ]);
    expect(connectAttempts).toBe(2);
    expect(clientCount).toBe(2);
    expect(sleeps).toEqual([500]);
  });
});
