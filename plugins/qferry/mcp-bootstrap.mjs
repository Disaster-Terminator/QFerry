#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.join(pluginDir, "dist", "mcp.cjs");
const defaultStateRoot = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), "qferry")
  : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "qferry");
const stateRoot = process.env.QFERRY_STATE_DIR?.trim() || defaultStateRoot;
const runCwd = path.join(stateRoot, "mcp-cwd");

mkdirSync(runCwd, { recursive: true });
process.chdir(runCwd);

process.argv[1] = runtimePath;
await import(pathToFileURL(runtimePath).href);
