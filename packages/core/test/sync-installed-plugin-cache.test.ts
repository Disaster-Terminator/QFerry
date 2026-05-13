import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve("../..");
const scriptPath = path.join(repoRoot, "scripts/sync-installed-plugin-cache.mjs");

describe("sync-installed-plugin-cache script", () => {
  it("dry-runs only installed QFerry cache targets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "qferry-cache-sync-test-"));
    try {
      const sourceDir = path.join(tempDir, "source", "qferry");
      const cacheRoot = path.join(tempDir, "cache");
      createPlugin(sourceDir, { marker: "new-qferry" });
      createPlugin(path.join(cacheRoot, "qferry-local", "qferry", "0.0.0"), { marker: "old-qferry" });
      createPlugin(path.join(cacheRoot, "other-local", "other-plugin", "0.1.0"), {
        name: "other-plugin",
        marker: "old-other",
      });

      const result = spawnSync(process.execPath, [scriptPath, "--source-dir", sourceDir, "--cache-root", cacheRoot], {
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({ ok: true, dryRun: true, pluginName: "qferry" });
      expect(output.targets).toHaveLength(1);
      expect(output.targets[0].targets).toEqual([
        {
          marketplace: "qferry-local",
          plugin: "qferry",
          version: "0.0.0",
          path: path.join(cacheRoot, "qferry-local", "qferry", "0.0.0"),
        },
      ]);
      expect(readFileSync(path.join(cacheRoot, "qferry-local", "qferry", "0.0.0", "marker.txt"), "utf8")).toBe("old-qferry\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("replaces only the requested installed plugin cache target when applied", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "qferry-cache-sync-apply-test-"));
    try {
      const sourceDir = path.join(tempDir, "source", "qferry");
      const cacheRoot = path.join(tempDir, "cache");
      createPlugin(sourceDir, { marker: "new-qferry" });
      createPlugin(path.join(cacheRoot, "qferry-local", "qferry", "0.0.0"), { marker: "old-qferry" });
      createPlugin(path.join(cacheRoot, "qferry-local", "qferry", "old"), { marker: "old-version" });

      const result = spawnSync(
        process.execPath,
        [scriptPath, "--source-dir", sourceDir, "--cache-root", cacheRoot, "--version", "0.0.0", "--apply"],
        { encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({ ok: true, dryRun: false, pluginName: "qferry" });
      expect(await readFile(path.join(cacheRoot, "qferry-local", "qferry", "0.0.0", "marker.txt"), "utf8")).toBe("new-qferry\n");
      expect(await readFile(path.join(cacheRoot, "qferry-local", "qferry", "old", "marker.txt"), "utf8")).toBe("old-version\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function createPlugin(dir: string, options: { name?: string; marker: string }): void {
  const name = options.name ?? "qferry";
  mkdirSync(path.join(dir, ".codex-plugin"), { recursive: true });
  writeFileSync(
    path.join(dir, ".codex-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.0.0",
        description: `${name} test plugin`,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(dir, "mcp-bootstrap.mjs"), "#!/usr/bin/env node\n");
  writeFileSync(path.join(dir, "marker.txt"), `${options.marker}\n`);
}
