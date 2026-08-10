import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createMcpServer } from "./bridge.js";
import type { BridgeableTool } from "./index.js";

function echoTool(): BridgeableTool<{ text: string }> {
  return {
    name: "echo",
    description: "Echoes the given text back",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    async execute(toolCallId, params) {
      return {
        content: [{ type: "text", text: `${toolCallId}:${params.text}` }],
        details: { echoed: params.text },
      };
    },
  };
}

function annotatedTool(): BridgeableTool<{ query: string }> {
  return {
    name: "search",
    description: "Searches without mutating anything",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: params.query }],
        details: { searched: params.query },
      };
    },
  };
}

function throwingTool(): BridgeableTool {
  return {
    name: "boom",
    description: "Always throws",
    parameters: { type: "object", properties: {} },
    async execute() {
      throw new Error("boom failed");
    },
  };
}

async function connectedClient(tools: BridgeableTool[]) {
  const server = createMcpServer(tools, { name: "test-server", version: "0.0.0" });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("createMcpServer (real MCP protocol round-trip)", () => {
  test("tools/list exposes name, description, and inputSchema unmodified", async () => {
    const client = await connectedClient([echoTool()]);
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("echo");
    expect(tools[0]?.description).toBe("Echoes the given text back");
    expect(tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });
  });

  test("tools/list carries annotations only for tools that declare them", async () => {
    const client = await connectedClient([annotatedTool(), echoTool()]);
    const { tools } = await client.listTools();

    const search = tools.find((t) => t.name === "search");
    expect(search?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });

    const echo = tools.find((t) => t.name === "echo");
    expect(echo?.annotations).toBeUndefined();
    expect(echo && "annotations" in echo).toBe(false);
  });

  test("tools/call invokes execute() and returns its content", async () => {
    const client = await connectedClient([echoTool()]);
    const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text.endsWith(":hi")).toBe(true);
  });

  test("calling an unknown tool returns isError, not a protocol failure", async () => {
    const client = await connectedClient([echoTool()]);
    const result = await client.callTool({ name: "does-not-exist", arguments: {} });
    expect(result.isError).toBe(true);
  });

  test("a tool that throws is reported as isError, not an uncaught rejection", async () => {
    const client = await connectedClient([throwingTool()]);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("boom failed");
  });
});
