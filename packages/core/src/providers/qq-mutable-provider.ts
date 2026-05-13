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
      mutationActions: ["move"],
    };
  }

  async moveMessages(refs: MessageRef[], targetFolder: string): Promise<{ moved: number }> {
    if (refs.length === 0) {
      return { moved: 0 };
    }
    if (!targetFolder.trim()) {
      throw new Error("Move target folder is empty");
    }

    return this.withClient(async (client) => {
      if (!client.messageMove) {
        throw new Error("QQ IMAP client does not expose messageMove");
      }

      let moved = 0;
      for (const [folder, folderRefs] of groupRefsByFolder(refs)) {
        const mailbox = await client.mailboxOpen(folder, { readOnly: false });
        if (mailbox.readOnly) {
          throw new Error(`Mailbox is read-only: ${folder}`);
        }
        assertUidValidity(folderRefs, mailbox.uidValidity);

        const uids = folderRefs.map((ref) => parseUid(ref.uid));
        const result = await client.messageMove(uids, targetFolder, { uid: true });
        if (result === false) {
          throw new Error(`QQ IMAP move failed for folder: ${folder}`);
        }
        moved += result.uidMap?.size ?? uids.length;
      }
      return { moved };
    });
  }
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
