import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { JsonlTraceWriter, createRunId, redactSecret } from "../src/trace.js";

describe("trace utilities", () => {
  it("redacts secrets without returning the raw value", () => {
    const redacted = redactSecret("qq-mail-auth-code");

    expect(redacted).not.toContain("qq-mail-auth-code");
    expect(redacted).toContain("len=17");
  });

  it("creates run ids with a caller prefix", () => {
    const runId = createRunId("fixture");

    expect(runId).toMatch(/^fixture-\d{8}T\d{6}Z-[a-f0-9]{8}$/);
  });

  it("appends JSONL events and creates parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "qferry-trace-"));
    const tracePath = join(root, "logs", "runs", "run.jsonl");
    const writer = new JsonlTraceWriter(tracePath);

    await writer.write({ event: "started", runId: "run-1" });
    await writer.write({ event: "finished", ok: true, runId: "run-1" });

    const lines = (await readFile(tracePath, "utf8")).trim().split("\n");

    expect(JSON.parse(lines[0])).toMatchObject({ event: "started", runId: "run-1" });
    expect(JSON.parse(lines[1])).toMatchObject({ event: "finished", ok: true });
  });
});
