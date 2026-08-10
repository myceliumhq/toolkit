import { describe, expect, test } from "vitest";
import { createLocalEmbeddingProvider } from "./local.js";

describe("createLocalEmbeddingProvider", () => {
  test("defaults to all-MiniLM-L6-v2 at 384 dimensions", () => {
    const provider = createLocalEmbeddingProvider();
    expect(provider.id).toBe("local");
    expect(provider.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(provider.dimensions).toBe(384);
  });

  test("accepts an explicit model + dimensions pair", () => {
    const provider = createLocalEmbeddingProvider({
      model: "Xenova/bge-small-en-v1.5",
      dimensions: 512,
    });
    expect(provider.model).toBe("Xenova/bge-small-en-v1.5");
    expect(provider.dimensions).toBe(512);
  });

  test("throws synchronously when a custom model is given without dimensions", () => {
    expect(() => createLocalEmbeddingProvider({ model: "Xenova/bge-small-en-v1.5" })).toThrow(
      /explicit "dimensions"/,
    );
  });
});
