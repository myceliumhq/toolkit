import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeableTool } from "./index.js";

export interface ServerInfo {
  name: string;
  version: string;
}

// NOTE: bridge output is the official high-level `McpServer`, *not* the
// low-level `Server` this package used to hand-wire with setRequestHandler.
// The tools themselves are still registered at the protocol layer (via the
// McpServer's underlying Server) rather than through McpServer.registerTool:
// that high-level API is built around Zod schemas and re-serializes the
// inputSchema it's given (adding `$schema`, normalizing types, etc.), which
// would corrupt the arbitrary TypeBox JSON Schema that BridgeableTool carries
// and that this package exists to pass through unchanged. Protocol-level
// registration keeps `parameters` and `annotations` byte-for-byte identical
// to what the tool factory declared, at the cost of not exercising McpServer's
// regex/validation sugar (which is unnecessary here — tools already carry
// JSON Schema).
export function createMcpServer(tools: BridgeableTool[], serverInfo: ServerInfo): McpServer {
  const server = new McpServer(serverInfo, { capabilities: { tools: {} } });
  const core = server.server;

  core.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as { type: "object"; [key: string]: unknown },
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  }));

  core.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.execute(randomUUID(), request.params.arguments ?? {});
      return { content: result.content };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}
