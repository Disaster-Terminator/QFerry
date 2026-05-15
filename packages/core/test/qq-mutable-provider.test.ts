import { describe, expect, it } from "vitest";

import { QqMutableProvider } from "../src/providers/qq-mutable-provider.js";

describe("QQ mutable provider", () => {
  it("reports move and create-folder mutation capability", async () => {
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      sleep: async () => undefined,
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async () => ({ exists: 0 }),
        fetch: async function* () {},
        messageMove: async () => ({ uidMap: new Map() }),
        mailboxCreate: async () => ({ path: "其他文件夹/开发社区", created: true }),
      }),
    });

    await expect(provider.getCapabilitySnapshot()).resolves.toMatchObject({
      provider: "qqmail",
      supportsMutation: true,
      mutationActions: ["move", "create_folder"],
      supportsCreateMailbox: true,
    });
  });

  it("creates QQ classification folders through IMAP CREATE", async () => {
    const created: unknown[] = [];
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      sleep: async () => undefined,
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async () => ({ exists: 0 }),
        fetch: async function* () {},
        messageMove: async () => ({ uidMap: new Map() }),
        mailboxCreate: async (path: string) => {
          created.push(path);
          return { path, created: true };
        },
      }),
    });

    await expect(provider.createMailbox("其他文件夹/开发社区")).resolves.toEqual({
      path: "其他文件夹/开发社区",
      created: true,
    });
    expect(created).toEqual(["其他文件夹/开发社区"]);
  });

  it("moves QQ message refs in one UID batch after opening the source mailbox writable", async () => {
    const opened: unknown[] = [];
    const moved: unknown[] = [];
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async (path: string, options: unknown) => {
          opened.push({ path, options });
          return { exists: 2, uidValidity: 888n };
        },
        fetch: async function* () {},
        messageMove: async (range: unknown, destination: string, options: unknown) => {
          moved.push({ range, destination, options });
          return { uidMap: new Map((Array.isArray(range) ? range : [1]).map((uid) => [uid as number, 1000 + (uid as number)])) };
        },
      }),
    });

    await expect(provider.moveMessages([
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "1", uidValidity: "888" },
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "2", uidValidity: "888" },
    ], "垃圾箱")).resolves.toEqual({ moved: 2 });

    expect(opened).toEqual([
      { path: "INBOX", options: { readOnly: false } },
    ]);
    expect(moved).toEqual([
      { range: [1, 2], destination: "垃圾箱", options: { uid: true } },
    ]);
  });

  it("rejects stale refs when UIDVALIDITY no longer matches the opened mailbox", async () => {
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async () => ({ exists: 1, uidValidity: 999n }),
        fetch: async function* () {},
        messageMove: async () => ({ uidMap: new Map() }),
      }),
    });

    await expect(provider.moveMessages([
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "1", uidValidity: "888" },
    ], "垃圾箱")).rejects.toThrow(/UIDVALIDITY mismatch/);
  });

  it("rejects QQ move refs without UIDVALIDITY", async () => {
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async () => ({ exists: 1, uidValidity: 999n }),
        fetch: async function* () {},
        messageMove: async () => ({ uidMap: new Map() }),
      }),
    });

    await expect(provider.moveMessages([
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "1" },
    ], "垃圾箱")).rejects.toThrow(/requires UIDVALIDITY/);
  });
});
