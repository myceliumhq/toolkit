import type { EmbeddingProvider } from "../index.js";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSIONS = 384;

export interface LocalEmbeddingProviderConfig {
  model?: string;
  dimensions?: number;
}

// Runs entirely in-process via @huggingface/transformers (ONNX), no network
// calls after the model is cached. Opt-in only — callers decide when to use
// this, it's never picked automatically. See AGENTS.md for why.
export function createLocalEmbeddingProvider(
  config: LocalEmbeddingProviderConfig = {},
): EmbeddingProvider {
  const model = config.model ?? DEFAULT_MODEL;
  const dimensions = config.dimensions ?? (config.model ? undefined : DEFAULT_DIMENSIONS);
  if (dimensions === undefined) {
    throw new Error(
      `@myceliumhq/embed: local provider needs an explicit "dimensions" when overriding the default model (got model="${model}")`,
    );
  }

  let extractorPromise: Promise<(texts: string[]) => Promise<number[][]>> | undefined;

  async function getExtractor(): Promise<(texts: string[]) => Promise<number[][]>> {
    if (!extractorPromise) {
      extractorPromise = (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        const extractor = await pipeline("feature-extraction", model);
        return async (texts: string[]) => {
          const output = await extractor(texts, { pooling: "mean", normalize: true });
          return output.tolist();
        };
      })();
    }
    return extractorPromise;
  }

  return {
    id: "local",
    model,
    dimensions,

    async embedQuery(text) {
      const extract = await getExtractor();
      const [embedding] = await extract([text]);
      if (!embedding) throw new Error("@myceliumhq/embed: local provider returned no embedding");
      return embedding;
    },

    async embedBatch(texts) {
      if (texts.length === 0) return [];
      const extract = await getExtractor();
      return extract(texts);
    },
  };
}
