import { describe, expect, it } from "vitest";

import { QqMutableProvider } from "../src/providers/qq-mutable-provider.js";

describe("QQ mutable provider", () => {
  it("reports move and create-folder mutation capability", async () => {
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
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

  it("moves QQ message refs one UID at a time and reconciles each mailbox delta", async () => {
    const opened: unknown[] = [];
    const moved: unknown[] = [];
    const mailboxExists = new Map([
      ["垃圾箱", [10, 11, 11, 12]],
      ["INBOX", [2, 1, 1, 0]],
    ]);
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async (path: string, options: unknown) => {
          opened.push({ path, options });
          const values = mailboxExists.get(path) ?? [0];
          const exists = values.shift() ?? 0;
          mailboxExists.set(path, values);
          return { exists, uidValidity: path === "INBOX" ? 888n : 999n };
        },
        fetch: async function* () {},
        messageMove: async (range: unknown, destination: string, options: unknown) => {
          moved.push({ range, destination, options });
          return { uidMap: new Map([[Array.isArray(range) ? range[0] as number : 1, 1001]]) };
        },
      }),
    });

    await expect(provider.moveMessages([
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "1", uidValidity: "888" },
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "2", uidValidity: "888" },
    ], "垃圾箱")).resolves.toMatchObject({
      moved: 2,
      reconciliations: [
        { sourceDelta: -1, targetDelta: 1, expectedSourceDelta: -1, expectedTargetDelta: 1 },
        { sourceDelta: -1, targetDelta: 1, expectedSourceDelta: -1, expectedTargetDelta: 1 },
      ],
    });

    expect(opened).toEqual([
      { path: "垃圾箱", options: { readOnly: true } },
      { path: "INBOX", options: { readOnly: false } },
      { path: "INBOX", options: { readOnly: true } },
      { path: "垃圾箱", options: { readOnly: true } },
      { path: "垃圾箱", options: { readOnly: true } },
      { path: "INBOX", options: { readOnly: false } },
      { path: "INBOX", options: { readOnly: true } },
      { path: "垃圾箱", options: { readOnly: true } },
    ]);
    expect(moved).toEqual([
      { range: [1], destination: "垃圾箱", options: { uid: true } },
      { range: [2], destination: "垃圾箱", options: { uid: true } },
    ]);
  });

  it("rejects moves when a single UID move does not reconcile", async () => {
    const mailboxExists = new Map([
      ["垃圾箱", [10, 11]],
      ["INBOX", [2, -1]],
    ]);
    const provider = new QqMutableProvider({
      accountAlias: "masked@qq.com",
      auth: { user: "user@qq.com", pass: "secret" },
      clientFactory: () => ({
        connect: async () => undefined,
        logout: async () => undefined,
        list: async () => [],
        mailboxOpen: async (path: string) => {
          const values = mailboxExists.get(path) ?? [0];
          const exists = values.shift() ?? 0;
          mailboxExists.set(path, values);
          return { exists, uidValidity: path === "INBOX" ? 888n : 999n };
        },
        fetch: async function* () {},
        messageMove: async () => ({ uidMap: new Map([[1, 1001]]) }),
      }),
    });

    await expect(provider.moveMessages([
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "1", uidValidity: "888" },
      { provider: "qqmail", accountAlias: "masked@qq.com", folder: "INBOX", uid: "2", uidValidity: "888" },
    ], "垃圾箱")).rejects.toThrow(/reconciliation failed/);
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
