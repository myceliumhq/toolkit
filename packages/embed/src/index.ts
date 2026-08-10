import {
  createLocalEmbeddingProvider,
  type LocalEmbeddingProviderConfig,
} from "./providers/local.js";
import {
  createOpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingProviderConfig,
} from "./providers/openai-compatible.js";

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// "local" is opt-in only — see AGENTS.md for why.
export type EmbeddingProviderConfig =
  | ({ provider: "openai-compatible" } & OpenAICompatibleEmbeddingProviderConfig)
  | ({ provider: "local" } & LocalEmbeddingProviderConfig);

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "openai-compatible":
      return createOpenAICompatibleEmbeddingProvider(config);
    case "local":
      return createLocalEmbeddingProvider(config);
  }
}

export type { LocalEmbeddingProviderConfig, OpenAICompatibleEmbeddingProviderConfig };
export { createLocalEmbeddingProvider, createOpenAICompatibleEmbeddingProvider };
