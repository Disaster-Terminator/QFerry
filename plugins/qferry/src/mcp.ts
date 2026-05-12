import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createQFerryMcpServer } from "../../../apps/chatgpt-app/src/mcp-server.js";

async function main(): Promise<void> {
  const server = createQFerryMcpServer();
  await server.connect(new StdioServerTransport());
}

void main();
