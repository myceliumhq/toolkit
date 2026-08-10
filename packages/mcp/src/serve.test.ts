import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, test } from "vitest";
import { createMcpServer } from "./bridge.js";
import type { BridgeableTool } from "./index.js";
import { type ServeHttpAuth, serveHttp } from "./serve.js";

function echoTool(): BridgeableTool<{ text: string }> {
  return {
    name: "echo",
    description: "Echoes text back",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: params.text }], details: {} };
    },
  };
}

// STATELESS Streamable HTTP (2026-07-28 spec revision): there is no protocol-level
// session, so each HTTP request is self-contained and gets a fresh McpServer +
// stateless transport. serveHttp takes a factory that returns a fresh server per
// request (the SDK throws if a stateless transport is reused across requests).
function makeServer() {
  return createMcpServer([echoTool()], { name: "http-test-server", version: "0.0.0" });
}

async function connectClient(port: number): Promise<Client> {
  const client = new Client({ name: "http-test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await client.connect(transport);
  return client;
}

const handles: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

describe("serveHttp (stateless Streamable HTTP round-trip)", () => {
  test("a real HTTP client can list and call tools over the wire", async () => {
    // port 0 -> OS-assigned free port, read back from the returned handle.
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const client = await connectClient(handle.port);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    const result = await client.callTool({ name: "echo", arguments: { text: "over the wire" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("over the wire");

    await client.close();
  });

  test("a request to a path other than the configured one gets a 404", async () => {
    const handle = await serveHttp(makeServer, { port: 0, path: "/custom-mcp" });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/wrong-path`);
    expect(response.status).toBe(404);
  });

  test("an authenticated client can list and call tools over the wire", async () => {
    const handle = await serveHttp(makeServer, { port: 0, auth: { bearerToken: "s3cr3t" } });
    handles.push(handle);

    const client = new Client({ name: "http-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle.port}/mcp`),
      { requestInit: { headers: { authorization: "Bearer s3cr3t" } } },
    );
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    const result = await client.callTool({ name: "echo", arguments: { text: "authed" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("authed");

    await client.close();
  });

  async function statusAt(
    handle: { port: number },
    headers?: Record<string, string>,
  ): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "http-test-client", version: "0.0.0" },
        },
      }),
    });
    return response.status;
  }

  test("bearer auth rejects missing and wrong tokens with 401", async () => {
    const handle = await serveHttp(makeServer, { port: 0, auth: { bearerToken: "s3cr3t" } });
    handles.push(handle);

    expect(await statusAt(handle)).toBe(401);
    expect(await statusAt(handle, { authorization: "Bearer wrong" })).toBe(401);
    // A valid token passes the gate and reaches a successful initialize (200).
    expect(await statusAt(handle, { authorization: "Bearer s3cr3t" })).toBe(200);
  });

  test("basic auth rejects missing and wrong credentials with 401", async () => {
    const handle = await serveHttp(makeServer, {
      port: 0,
      auth: { basic: { username: "user", password: "pass" } },
    });
    handles.push(handle);

    expect(await statusAt(handle)).toBe(401);
    const ok = Buffer.from("user:pass").toString("base64");
    expect(await statusAt(handle, { authorization: `Basic ${ok}` })).toBe(200);
    // Wrong password (and a wrong username) must still be rejected.
    const wrongPass = Buffer.from("user:nope").toString("base64");
    const wrongUser = Buffer.from("nobody:pass").toString("base64");
    expect(await statusAt(handle, { authorization: `Basic ${wrongPass}` })).toBe(401);
    expect(await statusAt(handle, { authorization: `Basic ${wrongUser}` })).toBe(401);
    // A non-Basic scheme is rejected even with correct credentials embedded.
    expect(
      await statusAt(handle, {
        authorization: `Digest ${Buffer.from("user:pass").toString("base64")}`,
      }),
    ).toBe(401);
    // Credentials that aren't valid base64 are rejected, not treated as a match.
    expect(await statusAt(handle, { authorization: "Basic !!!notbase64!!!" })).toBe(401);
  });

  test("malformed auth configuration is rejected at startup", async () => {
    await expect(serveHttp(makeServer, { port: 0, auth: {} })).rejects.toThrow();
    await expect(serveHttp(makeServer, { port: 0, auth: { bearerToken: "" } })).rejects.toThrow();
    await expect(
      serveHttp(makeServer, { port: 0, auth: { basic: { username: "", password: "" } } }),
    ).rejects.toThrow();
    await expect(
      serveHttp(makeServer, { port: 0, auth: { basic: { username: "u", password: "" } } }),
    ).rejects.toThrow();
    // A mistyped (non-string) token must fail at startup too — not crash the
    // request handler on a real request later.
    await expect(
      serveHttp(makeServer, {
        port: 0,
        auth: { bearerToken: 123 } as unknown as ServeHttpAuth,
      }),
    ).rejects.toThrow();
    await expect(
      serveHttp(makeServer, {
        port: 0,
        auth: { basic: { username: 42, password: "x" } } as unknown as ServeHttpAuth,
      }),
    ).rejects.toThrow();
    // RFC 7617: a username containing ":" is rejected at startup.
    await expect(
      serveHttp(makeServer, { port: 0, auth: { basic: { username: "a:b", password: "c" } } }),
    ).rejects.toThrow();
    // A null auth object must not silently disable the gate.
    await expect(
      serveHttp(makeServer, { port: 0, auth: null as unknown as ServeHttpAuth }),
    ).rejects.toThrow();
    await expect(
      serveHttp(makeServer, {
        port: 0,
        auth: { basic: null } as unknown as ServeHttpAuth,
      }),
    ).rejects.toThrow();
    // An empty allowedHosts/allowedOrigins entry or a non-array is rejected.
    await expect(serveHttp(makeServer, { port: 0, allowedHosts: [""] })).rejects.toThrow();
    await expect(
      serveHttp(makeServer, {
        port: 0,
        allowedOrigins: "https://x.example" as unknown as string[],
      }),
    ).rejects.toThrow();
  });

  test("a server defaults to the loopback interface, with or without auth", async () => {
    const plain = await serveHttp(makeServer, { port: 0 });
    const authed = await serveHttp(makeServer, { port: 0, auth: { bearerToken: "s3cr3t" } });
    handles.push(plain, authed);

    // The bound address is deterministic — no dependence on external interfaces.
    expect(plain.host).toBe("127.0.0.1");
    expect(authed.host).toBe("127.0.0.1");
  });

  test("an explicit host binds the listener to exactly that interface", async () => {
    const handle = await serveHttp(makeServer, { port: 0, host: "127.0.0.1" });
    handles.push(handle);

    expect(handle.host).toBe("127.0.0.1");
    const ok = await fetch(`http://127.0.0.1:${handle.port}/mcp`);
    expect(ok.status).not.toBe(404);
  });

  test("the default loopback server rejects non-loopback Host headers (DNS-rebinding protection)", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    // A loopback Host header is accepted (not a 400 host rejection).
    expect(await rawStatusAt(handle.port, `127.0.0.1:${handle.port}`)).not.toBe(400);
    // A DNS-rebinding attacker domain resolving to the host is rejected.
    expect(await rawStatusAt(handle.port, "evil.example")).toBe(400);
  });

  test("allowedHosts overrides the default DNS-rebinding allowlist", async () => {
    const handle = await serveHttp(makeServer, { port: 0, allowedHosts: ["mcp.example.com"] });
    handles.push(handle);

    expect(await rawStatusAt(handle.port, "mcp.example.com")).not.toBe(400);
    expect(await rawStatusAt(handle.port, "127.0.0.1:1")).toBe(400);
  });

  test("DNS-rebinding protection holds for explicit-host and authenticated servers", async () => {
    const explicit = await serveHttp(makeServer, { port: 0, host: "127.0.0.1" });
    const authed = await serveHttp(makeServer, { port: 0, auth: { bearerToken: "s3cr3t" } });
    handles.push(explicit, authed);

    for (const handle of [explicit, authed]) {
      // Pass valid credentials for the authed server so the auth gate passes and
      // the request actually reaches the Host check.
      const authHeader = handle === authed ? "Bearer s3cr3t" : undefined;
      // A foreign Host is still rejected even though host/auth is configured.
      expect(await rawStatusAt(handle.port, "evil.example", authHeader)).toBe(400);
      expect(await rawStatusAt(handle.port, `127.0.0.1:${handle.port}`, authHeader)).not.toBe(400);
    }
  });

  test("an empty allowedHosts rejects every Host (fail-closed)", async () => {
    const handle = await serveHttp(makeServer, { port: 0, allowedHosts: [] });
    handles.push(handle);

    expect(await rawStatusAt(handle.port, "127.0.0.1:1")).toBe(400);
    expect(await rawStatusAt(handle.port, "localhost")).toBe(400);
    expect(await rawStatusAt(handle.port, "mcp.example.com")).toBe(400);
  });

  test("allowedHosts matching is case-insensitive", async () => {
    const handle = await serveHttp(makeServer, { port: 0, allowedHosts: ["MCP.Example.com"] });
    handles.push(handle);

    expect(await rawStatusAt(handle.port, "mcp.example.com")).not.toBe(400);
    expect(await rawStatusAt(handle.port, "other.example")).toBe(400);
  });

  test("allowedOrigins validates browser Origin headers and leaves non-browser requests alone", async () => {
    const handle = await serveHttp(makeServer, {
      port: 0,
      allowedOrigins: ["https://app.example"],
    });
    handles.push(handle);

    // A matching origin passes; a different origin is rejected.
    expect(await rawStatusAt(handle.port, "127.0.0.1", undefined, "https://app.example")).not.toBe(
      400,
    );
    expect(await rawStatusAt(handle.port, "127.0.0.1", undefined, "https://evil.example")).toBe(
      400,
    );
    // Requests without an Origin header (non-browser, e.g. via a proxy) are unaffected.
    expect(await rawStatusAt(handle.port, "127.0.0.1")).not.toBe(400);
  });

  test("an empty allowedOrigins rejects every browser request (fail-closed)", async () => {
    const handle = await serveHttp(makeServer, { port: 0, allowedOrigins: [] });
    handles.push(handle);

    expect(await rawStatusAt(handle.port, "127.0.0.1", undefined, "https://app.example")).toBe(400);
    // Non-browser (no Origin) requests still work.
    expect(await rawStatusAt(handle.port, "127.0.0.1")).not.toBe(400);
  });

  test("a bind failure (port already in use) rejects serveHttp instead of hanging", async () => {
    const first = await serveHttp(makeServer, { port: 0 });
    handles.push(first);

    await expect(serveHttp(makeServer, { port: first.port })).rejects.toThrow();
  });
});

describe("serveHttp stateless multi-client / reconnect", () => {
  test("two independent clients can connect and call tools (no shared server state)", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    // Client A — its own initialize + tools/list on independent requests.
    const clientA = await connectClient(handle.port);
    expect((await clientA.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);

    // Client B — fully independent, no session to collide with A.
    const clientB = await connectClient(handle.port);
    expect((await clientB.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);

    const a = await clientA.callTool({ name: "echo", arguments: { text: "from A" } });
    const b = await clientB.callTool({ name: "echo", arguments: { text: "from B" } });
    expect((a.content as Array<{ type: string; text: string }>)[0]?.text).toBe("from A");
    expect((b.content as Array<{ type: string; text: string }>)[0]?.text).toBe("from B");

    await clientA.close();
    await clientB.close();
  });

  test("a client can reconnect after a previous client closed (stateless has no session state)", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const client = await connectClient(handle.port);
    const r1 = await client.callTool({ name: "echo", arguments: { text: "first" } });
    expect((r1.content as Array<{ type: string; text: string }>)[0]?.text).toBe("first");
    await client.close();

    // A fresh client on the same endpoint works immediately — each request is
    // independent, so there is no stale session slot to wait on.
    const client2 = await connectClient(handle.port);
    const r2 = await client2.callTool({ name: "echo", arguments: { text: "second" } });
    expect((r2.content as Array<{ type: string; text: string }>)[0]?.text).toBe("second");
    await client2.close();
  });

  test("interleaved clients on the same endpoint don't interfere", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const clientA = await connectClient(handle.port);
    const clientB = await connectClient(handle.port);

    // Fire calls from both at once; each must round-trip its own payload.
    const [ra, rb] = await Promise.all([
      clientA.callTool({ name: "echo", arguments: { text: "AAA" } }),
      clientB.callTool({ name: "echo", arguments: { text: "BBB" } }),
    ]);
    expect((ra.content as Array<{ type: string; text: string }>)[0]?.text).toBe("AAA");
    expect((rb.content as Array<{ type: string; text: string }>)[0]?.text).toBe("BBB");

    await clientA.close();
    await clientB.close();
  });

  test("a non-POST method is rejected with 405 (stateless is POST-only)", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    // GET and DELETE carry no meaning without a session/SSE stream in stateless mode.
    expect(await fetch(`http://127.0.0.1:${handle.port}/mcp`)).toHaveProperty("status", 405);
    const del = await fetch(`http://127.0.0.1:${handle.port}/mcp`, { method: "DELETE" });
    expect(del.status).toBe(405);
  });

  test("a malformed request body is handled without wedging the endpoint", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const bad = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "this is not json",
    });
    // Unparseable JSON — the stateless transport answers 400 (Parse error), not
    // a session-cap 503 (there is no session cap anymore).
    expect(bad.status).toBe(400);

    // The endpoint still serves a real client right after.
    const client = await connectClient(handle.port);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);
    await client.close();
  });
});

describe("serveHttp stateless spec invariants", () => {
  test("responses carry no Mcp-Session-Id header (no server session state)", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "http-test-client", version: "0.0.0" },
        },
      }),
    });
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  test("a client-sent Mcp-Session-Id is ignored, not treated as a session (no 404)", async () => {
    // The exact opposite of the old stateful 404 test: in stateless mode there is
    // no session registry, so a bogus session-id is simply absent state and must
    // not be rejected — the request is served normally.
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const client = new Client({ name: "http-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle.port}/mcp`),
      { requestInit: { headers: { "mcp-session-id": "bogus-session" } } },
    );
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    const result = await client.callTool({
      name: "echo",
      arguments: { text: "no session needed" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("no session needed");

    await client.close();
  });

  test("405 responses advertise the allowed methods via the Allow header", async () => {
    const handle = await serveHttp(makeServer, { port: 0 });
    handles.push(handle);

    const get = await fetch(`http://127.0.0.1:${handle.port}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const del = await fetch(`http://127.0.0.1:${handle.port}/mcp`, { method: "DELETE" });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("POST");
  });
});

// Send a request with an arbitrary Host/Origin header (http.request allows
// overriding these, unlike fetch which forbids Host).
function rawStatusAt(
  port: number,
  hostHeader: string,
  authorization?: string,
  origin?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: hostHeader };
    if (authorization !== undefined) headers.authorization = authorization;
    if (origin !== undefined) headers.origin = origin;
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/mcp", method: "GET", headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
