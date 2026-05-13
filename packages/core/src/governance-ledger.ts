import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export type GovernanceBatchStatus =
  | "previewed"
  | "rules_drafted"
  | "rules_applied"
  | "confirmed"
  | "executed"
  | "failed"
  | "skipped";

export interface GovernanceResumeToken {
  folder: string;
  offset: number;
  uidNext?: string;
  lastProcessedUid?: string;
  batchConfig: {
    pageSize: number;
    maxPages: number;
  };
}

export interface GovernanceBatchError {
  code: string;
  message: string;
  messageUid?: string;
}

export interface GovernanceBatchLedgerRecord {
  runId: string;
  parentRunId?: string;
  batchId: string;
  status: GovernanceBatchStatus;
  folder: string;
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  resumeToken: GovernanceResumeToken;
  scannedMessages: number;
  candidateCount: number;
  selectedMessageRefs: number;
  mutationsAttempted: number;
  completedRefsCount: number;
  errorCount: number;
  totalEstimatedCount?: number;
  operationPlanId?: string;
  error?: GovernanceBatchError;
  tracePath: string;
  summaryPath: string;
  rulesToAdd?: number;
  skippedDuplicateRules?: number;
  note?: string;
}

export class GovernanceRunLedger {
  constructor(private readonly path: string) {}

  async record(record: GovernanceBatchLedgerRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify({
      event: "governance_batch_recorded",
      timestamp: new Date().toISOString(),
      ...record,
    })}\n`, "utf8");
  }
}
