export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type AgentToolUpdateCallback<TDetails = unknown> = (update: {
  content?: (TextContent | ImageContent)[];
  details?: Partial<TDetails>;
}) => void;

// Mirrors MCP's ToolAnnotations. Every field is a hint about the tool's
// behaviour, not a guarantee — clients must not rely on them for safety.
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// A minimal tool shape this bridge needs -- no dependency on any
// particular agent-tool convention. `parameters` is already JSON Schema
// (true of TypeBox output). A host's own richer tool type (name, label,
// description, parameters, execute(toolCallId, params, signal?)) is
// structurally compatible as long as `execute`'s signature matches, so
// real tool factories can be passed in unmodified.
export interface BridgeableTool<TParams = unknown, TDetails = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ): Promise<{ content: (TextContent | ImageContent)[]; details: TDetails }>;
}

export { createMcpServer, type ServerInfo } from "./bridge.js";
export {
  type HttpServerHandle,
  type ServeHttpAuth,
  type ServeHttpOptions,
  serveHttp,
  serveStdio,
} from "./serve.js";
