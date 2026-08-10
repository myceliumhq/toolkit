import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed, embedMany } from "ai";
import type { EmbeddingProvider } from "../index.js";

export interface OpenAICompatibleEmbeddingProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  // Required, not probed: the index needs a fixed vector width before the
  // first embed call. Most OpenAI-compatible embedding models document
  // theirs (e.g. text-embedding-3-small is 1536, nomic-embed-text is 768).
  dimensions: number;
  // Overridable for tests — defaults to the global fetch.
  fetchImpl?: typeof fetch;
}

export function createOpenAICompatibleEmbeddingProvider(
  config: OpenAICompatibleEmbeddingProviderConfig,
): EmbeddingProvider {
  // Best-effort hint for servers that support truncating to a shorter
  // Matryoshka embedding (e.g. OpenAI's own text-embedding-3-*). Ignored by
  // servers that don't recognize it.
  const providerOptions = { openaiCompatible: { dimensions: config.dimensions } };

  const provider = createOpenAICompatible({
    name: "mycelium-openai-compatible",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: config.fetchImpl,
  });
  const model = provider.embeddingModel(config.model);

  return {
    id: "openai-compatible",
    model: config.model,
    dimensions: config.dimensions,

    async embedQuery(text) {
      const { embedding } = await embed({ model, value: text, providerOptions });
      return embedding;
    },

    async embedBatch(texts) {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({ model, values: texts, providerOptions });
      return embeddings;
    },
  };
}
