import type { MessageRef } from "../operation-plan.js";
import type { MoveMessagesReconciliation, MoveMessagesResult, ProviderCapabilitySnapshot } from "./types.js";
import { QqReadOnlyProvider, type QqReadOnlyClient, type QqReadOnlyProviderInput } from "./qq-readonly-provider.js";

const MOVE_RECONCILE_ATTEMPTS = 6;
const MOVE_RECONCILE_DELAY_MS = 500;

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
      const reconciliations: MoveMessagesReconciliation[] = [];
      for (const [folder, folderRefs] of groupRefsByFolder(refs)) {
        if (folder === targetFolder) {
          throw new Error(`Move target folder must differ from source folder: ${folder}`);
        }
        for (const ref of folderRefs) {
          const targetBefore = await getMailboxExists(client, targetFolder, true);
          const mailbox = await client.mailboxOpen(folder, { readOnly: false });
          if (mailbox.readOnly) {
            throw new Error(`Mailbox is read-only: ${folder}`);
          }
          assertUidValidity([ref], mailbox.uidValidity);

          const uid = parseUid(ref.uid);
          const result = await client.messageMove([uid], targetFolder, { uid: true });
          if (result === false) {
            throw new Error(`QQ IMAP move failed for folder: ${folder}`);
          }
          const resultCount = result.uidMap?.size;
          if (resultCount !== undefined && resultCount !== 1) {
            throw new Error(`QQ IMAP move count mismatch for folder ${folder}: expected 1, got ${resultCount}`);
          }
          const reconciliation = await waitForReconciliation({
            client,
            sourceFolder: folder,
            targetFolder,
            sourceBefore: mailbox.exists,
            targetBefore,
            expectedSourceDelta: -1,
            expectedTargetDelta: 1,
            sleep: (ms) => this.sleepFor(ms),
          });
          reconciliations.push(reconciliation);
          moved += 1;
        }
      }
      return { moved, reconciliations };
    });
  }
}

async function getMailboxExists(client: QqReadOnlyClient, folder: string, readOnly: boolean): Promise<number> {
  return (await client.mailboxOpen(folder, { readOnly })).exists;
}

async function waitForReconciliation(input: {
  client: QqReadOnlyClient;
  sourceFolder: string;
  targetFolder: string;
  sourceBefore: number;
  targetBefore: number;
  expectedSourceDelta: number;
  expectedTargetDelta: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<MoveMessagesReconciliation> {
  let latest: MoveMessagesReconciliation | undefined;
  for (let attempt = 0; attempt < MOVE_RECONCILE_ATTEMPTS; attempt += 1) {
    const sourceAfter = await getMailboxExists(input.client, input.sourceFolder, true);
    const targetAfter = await getMailboxExists(input.client, input.targetFolder, true);
    latest = {
      sourceFolder: input.sourceFolder,
      targetFolder: input.targetFolder,
      sourceBefore: input.sourceBefore,
      sourceAfter,
      sourceDelta: sourceAfter - input.sourceBefore,
      targetBefore: input.targetBefore,
      targetAfter,
      targetDelta: targetAfter - input.targetBefore,
      expectedSourceDelta: input.expectedSourceDelta,
      expectedTargetDelta: input.expectedTargetDelta,
    };
    if (isReconciled(latest)) {
      return latest;
    }
    if (attempt < MOVE_RECONCILE_ATTEMPTS - 1) {
      await input.sleep(MOVE_RECONCILE_DELAY_MS);
    }
  }
  if (!latest) {
    throw new Error("QQ IMAP move reconciliation did not run");
  }
  assertReconciled(latest);
  return latest;
}

function isReconciled(reconciliation: MoveMessagesReconciliation): boolean {
  return reconciliation.sourceDelta === reconciliation.expectedSourceDelta
    && reconciliation.targetDelta === reconciliation.expectedTargetDelta;
}

function assertReconciled(reconciliation: MoveMessagesReconciliation): void {
  if (!isReconciled(reconciliation)) {
    throw new Error(
      `QQ IMAP move reconciliation failed: source ${reconciliation.sourceFolder} delta ${reconciliation.sourceDelta}`
      + ` expected ${reconciliation.expectedSourceDelta}; target ${reconciliation.targetFolder} delta ${reconciliation.targetDelta}`
      + ` expected ${reconciliation.expectedTargetDelta}`,
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
