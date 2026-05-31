import type { MessageRef } from "../operation-plan.js";
import type { MoveMessagesResult, ProviderCapabilitySnapshot } from "./types.js";
import { QqReadOnlyProvider, type QqReadOnlyProviderInput } from "./qq-readonly-provider.js";

export class QqMutableProvider extends QqReadOnlyProvider {
  constructor(input: QqReadOnlyProviderInput) {
    super(input);
  }

  override async getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot> {
    const capability = await super.getCapabilitySnapshot();
    const moveSafety = await this.withClient("capability_snapshot", async (client) => readMoveSafety(client.capabilities));
    const mutationActions = moveSafety.safeForMove ? ["move", "create_folder"] : ["create_folder"];
    return {
      ...capability,
      supportsMutation: true,
      mutationActions,
      supportsCreateMailbox: true,
      imapCapabilities: moveSafety.capabilities,
      supportsNativeMove: moveSafety.supportsNativeMove,
      supportsUidExpunge: moveSafety.supportsUidExpunge,
      ...(moveSafety.warning ? { moveSafetyWarning: moveSafety.warning } : {}),
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

  async moveMessages(refs: MessageRef[], targetFolder: string): Promise<MoveMessagesResult> {
    if (refs.length === 0) {
      return { moved: 0, reconciliations: [] };
    }
    if (!targetFolder.trim()) {
      throw new Error("Move target folder is empty");
    }

    return this.withClient("move_messages", async (client) => {
      if (!client.messageMove) {
        throw new Error("QQ IMAP client does not expose messageMove");
      }

      let moved = 0;
      let movedCountStatus: MoveMessagesResult["movedCountStatus"] = "exact";
      for (const [folder, folderRefs] of groupRefsByFolder(refs)) {
        if (folder === targetFolder) {
          throw new Error(`Move target folder must differ from source folder: ${folder}`);
        }
        const mailbox = await client.mailboxOpen(folder, { readOnly: false });
        if (mailbox.readOnly) {
          throw new Error(`Mailbox is read-only: ${folder}`);
        }
        assertSafeMoveCapabilities(client.capabilities);
        assertUidValidity(folderRefs, mailbox.uidValidity);

        const uids = folderRefs.map((ref) => parseUid(ref.uid));
        const result = await client.messageMove(uids, targetFolder, { uid: true });
        if (result === false) {
          movedCountStatus = "unknown";
          continue;
        }
        const resultCount = result.uidMap?.size;
        moved += resultCount ?? folderRefs.length;
      }
      return movedCountStatus === "unknown"
        ? { moved, movedCountStatus }
        : { moved };
    });
  }
}

function readMoveSafety(capabilities: Map<string, unknown> | undefined): {
  capabilities: string[];
  safeForMove: boolean;
  supportsNativeMove: boolean;
  supportsUidExpunge: boolean;
  warning?: string;
} {
  const names = capabilities ? [...capabilities.keys()].map((capability) => capability.toUpperCase()).sort() : [];
  const supportsNativeMove = names.includes("MOVE");
  const supportsUidExpunge = names.includes("UIDPLUS");
  const safeForMove = supportsNativeMove || supportsUidExpunge;
  return {
    capabilities: names,
    safeForMove,
    supportsNativeMove,
    supportsUidExpunge,
    ...(safeForMove
      ? {}
      : {
        warning: "QQ IMAP server did not advertise MOVE or UIDPLUS; ImapFlow move fallback would use mailbox-wide EXPUNGE.",
      }),
  };
}

function assertSafeMoveCapabilities(capabilities: Map<string, unknown> | undefined): void {
  const moveSafety = readMoveSafety(capabilities);
  if (!moveSafety.safeForMove) {
    throw new Error(
      "QQ IMAP unsafe MOVE fallback blocked: server does not advertise MOVE or UIDPLUS, "
      + "so COPY+EXPUNGE could remove unrelated messages already flagged as deleted.",
    );
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
