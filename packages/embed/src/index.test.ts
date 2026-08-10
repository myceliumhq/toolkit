import { describe, expect, test } from "vitest";
import { createEmbeddingProvider } from "./index.js";

describe("createEmbeddingProvider", () => {
  test("dispatches to the openai-compatible provider", () => {
    const provider = createEmbeddingProvider({
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "text-embedding-test",
      dimensions: 8,
    });
    expect(provider.id).toBe("openai-compatible");
  });

  test("dispatches to the local provider", () => {
    const provider = createEmbeddingProvider({ provider: "local" });
    expect(provider.id).toBe("local");
  });
});
