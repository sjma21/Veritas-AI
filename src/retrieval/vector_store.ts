import { ChromaClient, Collection } from "chromadb";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { embed } from "../utils/llm_client.js";
import type { CorpusDocument } from "./corpus.js";

export interface RetrievedChunk {
  id: string;
  content: string;
  source: string;
  title: string;
  score: number;
  metadata: Record<string, unknown>;
}

export class VectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private memCollection: Collection | null = null;

  constructor() {
    this.client = new ChromaClient({ path: config.CHROMA_URL });
  }

  async initialize(): Promise<void> {
    try {
      this.collection = await this.client.getOrCreateCollection({
        name: config.CHROMA_COLLECTION,
        metadata: { "hnsw:space": "cosine" },
      });

      this.memCollection = await this.client.getOrCreateCollection({
        name: config.CHROMA_MEMORY_COLLECTION,
        metadata: { "hnsw:space": "cosine" },
      });

      logger.info(
        { corpus: config.CHROMA_COLLECTION, memory: config.CHROMA_MEMORY_COLLECTION },
        "ChromaDB collections ready"
      );
    } catch (err) {
      logger.error({ err }, "Failed to initialize ChromaDB");
      throw err;
    }
  }

  async indexCorpus(docs: CorpusDocument[]): Promise<void> {
    if (!this.collection) throw new Error("VectorStore not initialized");

    const batchSize = 10;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const texts = batch.map((d) => `${d.title}\n\n${d.content}`);
      const embeddings = await embed(texts);

      await this.collection.upsert({
        ids: batch.map((d) => d.id),
        embeddings,
        documents: texts,
        metadatas: batch.map((d) => ({
          ...d.metadata,
          title: d.title,
          source: d.source,
        })),
      });

      logger.info({ batch: i / batchSize + 1, docs: batch.length }, "Indexed document batch");
    }
  }

  async query(queryText: string, topK = config.RETRIEVAL_TOP_K): Promise<RetrievedChunk[]> {
    if (!this.collection) throw new Error("VectorStore not initialized");

    const [queryEmbedding] = await embed([queryText]);

    const results = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: ["documents", "metadatas", "distances"] as any,
    });

    const ids = results.ids[0] ?? [];
    const documents = results.documents[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];
    const distances = results.distances?.[0] ?? [];

    return ids.map((id, i) => {
      const distance = distances[i] ?? 1;
      // Cosine distance → similarity score (0–1)
      const score = 1 - distance;
      const meta = (metadatas[i] ?? {}) as Record<string, unknown>;

      return {
        id,
        content: documents[i] ?? "",
        source: String(meta.source ?? ""),
        title: String(meta.title ?? ""),
        score,
        metadata: meta,
      };
    });
  }

  // Memory store operations
  async addMemory(
    id: string,
    text: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (!this.memCollection) throw new Error("VectorStore not initialized");
    const [embedding] = await embed([text]);
    // Flatten metadata values to ChromaDB-compatible primitives
    const safeMetadata: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        safeMetadata[k] = v;
      } else {
        safeMetadata[k] = String(v);
      }
    }
    await this.memCollection.upsert({
      ids: [id],
      embeddings: [embedding],
      documents: [text],
      metadatas: [safeMetadata],
    });
  }

  async queryMemory(
    queryText: string,
    topK = 3
  ): Promise<Array<{ id: string; text: string; metadata: Record<string, unknown> }>> {
    if (!this.memCollection) throw new Error("VectorStore not initialized");

    const [queryEmbedding] = await embed([queryText]);

    const results = await this.memCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: ["documents", "metadatas"] as any,
    });

    const ids = results.ids[0] ?? [];
    const documents = results.documents[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];

    return ids.map((id, i) => ({
      id,
      text: documents[i] ?? "",
      metadata: (metadatas[i] ?? {}) as Record<string, unknown>,
    }));
  }
}
