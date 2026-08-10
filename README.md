# toolkit

Shared runtime packages behind [myceliumhq](https://github.com/myceliumhq)'s agent-facing CLIs.

| Package | What it is |
|---|---|
| [`@myceliumhq/toolkit`](./packages/toolkit) | Exit codes, JSON/table output, env config loading, Commander.js wiring, doctor-check runner |
| [`@myceliumhq/embed`](./packages/embed) | Embedding client for any OpenAI-compatible endpoint, with an opt-in local CPU fallback |
| [`@myceliumhq/index`](./packages/index) | Local-first semantic index: sqlite-vec vector store, incremental sync, hybrid lexical/semantic search |
| [`@myceliumhq/mcp`](./packages/mcp) | Bridges agent-tool factories onto a standalone MCP server, over stdio and Streamable HTTP |

These are the building blocks [`tri`](https://github.com/myceliumhq/tri), [`ppl`](https://github.com/myceliumhq/ppl), and [`semanticd`](https://github.com/myceliumhq/semanticd) are built on. Each is independently usable outside that context too.

## Develop

```bash
pnpm install
pnpm run build
pnpm run test
```
