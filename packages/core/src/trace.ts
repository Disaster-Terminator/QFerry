import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export type TraceEvent = Record<string, unknown>;

export function redactSecret(value: string | undefined | null): string {
  if (!value) {
    return "<missing>";
  }
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `<redacted len=${value.length} sha256_8=${digest}>`;
}

export function createRunId(prefix: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const suffix = randomBytes(4).toString("hex");
  return `${prefix}-${timestamp}-${suffix}`;
}

export class JsonlTraceWriter {
  constructor(private readonly path: string) {}

  async write(event: TraceEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }
}
