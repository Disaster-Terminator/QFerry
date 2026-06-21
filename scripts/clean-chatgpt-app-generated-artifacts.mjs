import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const relativePaths = [
  "apps/chatgpt-app/src/mcp-server.d.ts",
  "apps/chatgpt-app/src/mcp-server.js",
  "apps/chatgpt-app/src/mcp-server.js.map",
  "apps/chatgpt-app/test/fixture-mcp-e2e.test.d.ts",
  "apps/chatgpt-app/test/fixture-mcp-e2e.test.js",
  "apps/chatgpt-app/test/fixture-mcp-e2e.test.js.map",
  "apps/chatgpt-app/test/mcp-server.test.d.ts",
  "apps/chatgpt-app/test/mcp-server.test.js",
  "apps/chatgpt-app/test/mcp-server.test.js.map",
  "apps/chatgpt-app/test/sensitive-widget-harness.test.d.ts",
  "apps/chatgpt-app/test/sensitive-widget-harness.test.js",
  "apps/chatgpt-app/test/sensitive-widget-harness.test.js.map",
];

await Promise.all(
  relativePaths.map((relativePath) =>
    rm(join(root.pathname, relativePath), { force: true }),
  ),
);
