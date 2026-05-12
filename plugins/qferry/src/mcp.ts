import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createQFerryMcpServer } from "../../../apps/chatgpt-app/src/mcp-server.js";

const server = createQFerryMcpServer();
await server.connect(new StdioServerTransport());
