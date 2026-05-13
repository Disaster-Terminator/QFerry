import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GovernanceRunLedger } from "../src/governance-ledger.js";

describe("governance run ledger", () => {
  it("records auditable batch lifecycle events as jsonl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ledger-"));
    const ledger = new GovernanceRunLedger(join(dir, "governance.jsonl"));

    await ledger.record({
      runId: "governance-run-1",
      batchId: "batch-0001",
      status: "previewed",
      folder: "INBOX",
      scanOffset: 0,
      pageSize: 50,
      maxPages: 2,
      resumeToken: {
        folder: "INBOX",
        offset: 100,
        lastProcessedUid: "100",
        batchConfig: { pageSize: 50, maxPages: 2 },
      },
      scannedMessages: 100,
      candidateCount: 7,
      selectedMessageRefs: 0,
      mutationsAttempted: 0,
      completedRefsCount: 0,
      errorCount: 0,
      tracePath: "logs/runs/run.jsonl",
      summaryPath: "artifacts/e2e/run/summary.md",
    });

    const lines = (await readFile(join(dir, "governance.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      event: "governance_batch_recorded",
      runId: "governance-run-1",
      batchId: "batch-0001",
      status: "previewed",
      mutationsAttempted: 0,
      resumeToken: {
        folder: "INBOX",
        offset: 100,
        lastProcessedUid: "100",
        batchConfig: { pageSize: 50, maxPages: 2 },
      },
      completedRefsCount: 0,
      errorCount: 0,
    });
  });
});
