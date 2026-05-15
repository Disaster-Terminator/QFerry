import type { MessageRef } from "../operation-plan.js";
import type { ProviderCapabilitySnapshot } from "./types.js";
import { QqReadOnlyProvider, type QqReadOnlyClient, type QqReadOnlyProviderInput } from "./qq-readonly-provider.js";

export class QqMutableProvider extends QqReadOnlyProvider {
  constructor(input: QqReadOnlyProviderInput) {
    super(input);
  }

  override async getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot> {
    const capability = await super.getCapabilitySnapshot();
    return {
      ...capability,
      supportsMutation: true,
      mutationActions: ["move", "create_folder"],
      supportsCreateMailbox: true,
    };
  }

  async createMailbox(folder: string): Promise<{ path: string; created: boolean }> {
    const target = folder.trim();
    if (!target) {
      throw new Error("Create mailbox target folder is empty");
    }

    return this.withClient("create_mailbox", async (client) => {
      if (!client.mailboxCreate) {
        throw new Error("QQ IMAP client does not expose mailboxCreate");
      }
      const result = await client.mailboxCreate(target);
      if (result === false) {
        throw new Error(`QQ IMAP create mailbox failed: ${target}`);
      }
      const resultObject = typeof result === "object" && result !== null ? result : undefined;
      return {
        path: resultObject?.path ?? target,
        created: resultObject?.created ?? true,
      };
    });
  }

  async moveMessages(refs: MessageRef[], targetFolder: string): Promise<{ moved: number }> {
    if (refs.length === 0) {
      return { moved: 0 };
    }
    if (!targetFolder.trim()) {
      throw new Error("Move target folder is empty");
    }

    return this.withClient("move_messages", async (client) => {
      if (!client.messageCopy || !client.messageDelete) {
        throw new Error("QQ IMAP client does not expose safe copy/delete move primitives");
      }
      if (!hasCapability(client, "UIDPLUS")) {
        throw new Error("QQ IMAP move requires UIDPLUS for exact UID EXPUNGE");
      }

      let moved = 0;
      for (const [folder, folderRefs] of groupRefsByFolder(refs)) {
        const mailbox = await client.mailboxOpen(folder, { readOnly: false });
        if (mailbox.readOnly) {
          throw new Error(`Mailbox is read-only: ${folder}`);
        }
        assertUidValidity(folderRefs, mailbox.uidValidity);

        const uids = folderRefs.map((ref) => parseUid(ref.uid));
        const copyResult = await client.messageCopy(uids, targetFolder, { uid: true });
        if (copyResult === false) {
          throw new Error(`QQ IMAP copy failed for folder: ${folder}`);
        }
        const deleteResult = await client.messageDelete(uids, { uid: true });
        if (deleteResult === false || deleteResult === undefined) {
          throw new Error(`QQ IMAP exact UID expunge failed for folder: ${folder}`);
        }
        moved += copyResult.uidMap?.size ?? uids.length;
      }
      return { moved };
    });
  }
}

function hasCapability(client: QqReadOnlyClient, capability: string): boolean {
  const capabilities = client.capabilities;
  if (!capabilities) return false;
  return capabilities.has(capability);
}

function groupRefsByFolder(refs: MessageRef[]): Map<string, MessageRef[]> {
  const groups = new Map<string, MessageRef[]>();
  for (const ref of refs) {
    if (ref.provider !== "qqmail") {
      throw new Error(`QQ provider cannot move ${ref.provider} message refs`);
    }
    const group = groups.get(ref.folder) ?? [];
    group.push(ref);
    groups.set(ref.folder, group);
  }
  return groups;
}

function assertUidValidity(refs: MessageRef[], openedUidValidity: bigint | number | string | undefined): void {
  const missing = refs.find((ref) => ref.uidValidity === undefined);
  if (missing) {
    throw new Error(`QQ message ref requires UIDVALIDITY: ${missing.folder}/${missing.uid}`);
  }
  if (openedUidValidity === undefined) return;
  const actual = String(openedUidValidity);
  const mismatched = refs.find((ref) => ref.uidValidity !== undefined && ref.uidValidity !== actual);
  if (mismatched) {
    throw new Error(`UIDVALIDITY mismatch for ${mismatched.folder}: expected ${mismatched.uidValidity}, got ${actual}`);
  }
}

function parseUid(uid: string): number {
  const value = Number(uid);
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== uid) {
    throw new Error(`Invalid QQ message UID: ${uid}`);
  }
  return value;
}
