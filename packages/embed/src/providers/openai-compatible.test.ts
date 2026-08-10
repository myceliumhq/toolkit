import { describe, expect, test } from "vitest";
import { createOpenAICompatibleEmbeddingProvider } from "./openai-compatible.js";

function fakeEmbeddingsFetch(embeddingsByInput: (input: string) => number[]) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(
      JSON.stringify({
        object: "list",
        model: body.model,
        data: inputs.map((input, index) => ({
          object: "embedding",
          index,
          embedding: embeddingsByInput(input),
        })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("createOpenAICompatibleEmbeddingProvider", () => {
  test("embedQuery posts to /embeddings and returns the parsed vector", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test",
      model: "text-embedding-test",
      dimensions: 3,
      fetchImpl: fakeEmbeddingsFetch(() => [0.1, 0.2, 0.3]),
    });

    const embedding = await provider.embedQuery("hello");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test("embedBatch returns one vector per input, in order", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1",
      model: "text-embedding-test",
      dimensions: 2,
      fetchImpl: fakeEmbeddingsFetch((input) => [input.length, 0]),
    });

    const embeddings = await provider.embedBatch(["a", "bb", "ccc"]);
    expect(embeddings).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  test("embedBatch short-circuits on an empty input list", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1",
      model: "text-embedding-test",
      dimensions: 2,
      fetchImpl: fakeEmbeddingsFetch(() => {
        throw new Error("should not be called");
      }),
    });

    expect(await provider.embedBatch([])).toEqual([]);
  });

  test("exposes id/model/dimensions from config", () => {
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1",
      model: "text-embedding-test",
      dimensions: 1536,
    });

    expect(provider.id).toBe("openai-compatible");
    expect(provider.model).toBe("text-embedding-test");
    expect(provider.dimensions).toBe(1536);
  });
});
