import { ChromaClient, type Collection } from "chromadb";
import { embed } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { traceable } from "../observability/langsmith.js";
import type { AgentOutput } from "../schemas/output.js";

export interface CacheHitResult {
  output: AgentOutput;
  similarity: number;
}

export class SemanticCache {
  private collection: Collection | null = null;

  constructor(private chromaClient: ChromaClient) {
    this.lookup = traceable(this.lookup.bind(this), {
      name: "semantic_cache.lookup",
      run_type: "retriever",
      metadata: { layer: "cache" },
      processOutputs: (out: Record<string, unknown> | null) => ({
        hit: out !== null,
        similarity: (out as CacheHitResult | null)?.similarity ?? 0,
      }),
    });
    this.store = traceable(this.store.bind(this), {
      name: "semantic_cache.store",
      run_type: "chain",
      metadata: { layer: "cache" },
    });
  }

  async initialize(): Promise<void> {
    try {
      this.collection = await this.chromaClient.getOrCreateCollection({
        name: config.SEMANTIC_CACHE_COLLECTION,
        metadata: { "hnsw:space": "cosine" },
      });
      logger.info({ collection: config.SEMANTIC_CACHE_COLLECTION }, "Semantic cache ready");
    } catch (err) {
      logger.error({ err }, "Failed to initialize semantic cache");
      throw err;
    }
  }

  /**
   * Look up a cached response for a near-identical query.
   * Returns null on miss, expired entry, or below-threshold similarity.
   */
  async lookup(query: string): Promise<CacheHitResult | null> {
    if (!this.collection || !config.SEMANTIC_CACHE_ENABLED) return null;

    try {
      const [embedding] = await embed([query]);

      const results = await this.collection.query({
        queryEmbeddings: [embedding],
        nResults: 1,
        include: ["metadatas", "distances"] as any,
      });

      const distance = results.distances?.[0]?.[0];
      const meta = results.metadatas?.[0]?.[0] as Record<string, unknown> | undefined;

      if (distance == null || meta == null) return null;

      const similarity = 1 - distance;

      if (similarity < config.SEMANTIC_CACHE_THRESHOLD) {
        logger.debug({ similarity, threshold: config.SEMANTIC_CACHE_THRESHOLD, query }, "Cache miss");
        return null;
      }

      // TTL check
      const storedAt = meta.timestamp_ms as number;
      const ttlMs = config.SEMANTIC_CACHE_TTL_SECONDS * 1000;
      if (Date.now() - storedAt > ttlMs) {
        logger.debug({ storedAt, query }, "Cache entry expired");
        return null;
      }

      const output = JSON.parse(meta.output_json as string) as AgentOutput;
      logger.info({ similarity: similarity.toFixed(4), query: query.slice(0, 60) }, "Semantic cache HIT");

      return { output, similarity };
    } catch (err) {
      logger.warn({ err }, "Semantic cache lookup failed — proceeding without cache");
      return null;
    }
  }

  /**
   * Store a verified response in the semantic cache.
   * Called after the critic passes so only good answers get cached.
   */
  async store(query: string, output: AgentOutput): Promise<void> {
    if (!this.collection || !config.SEMANTIC_CACHE_ENABLED) return;

    try {
      const [embedding] = await embed([query]);

      // Use a content-hash-like ID so re-asked identical queries overwrite the old entry
      const id = `scache-${Buffer.from(query.slice(0, 128)).toString("base64url")}`;

      await this.collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [query],
        metadatas: [
          {
            query: query.slice(0, 500),
            output_json: JSON.stringify(output),
            timestamp_ms: Date.now(),
            confidence: output.confidence,
          },
        ],
      });

      logger.debug({ query: query.slice(0, 60) }, "Semantic cache stored");
    } catch (err) {
      logger.warn({ err }, "Semantic cache store failed — response not cached");
    }
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.collection) return { count: 0 };
    try {
      const count = await this.collection.count();
      return { count };
    } catch {
      return { count: 0 };
    }
  }
}
