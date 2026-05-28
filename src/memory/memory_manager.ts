import { v4 as uuidv4 } from "uuid";
import { VectorStore } from "../retrieval/vector_store.js";
import { logger } from "../utils/logger.js";
import { traceable } from "../observability/langsmith.js";

export interface MemoryEntry {
  id: string;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  timestamp: number;
  text: string; // combined for embedding
}

export class MemoryManager {
  constructor(private vectorStore: VectorStore) {
    this.storeExchange = traceable(this.storeExchange.bind(this), {
      name: "memory.store_exchange",
      run_type: "chain",
      metadata: { layer: "memory" },
    });
    this.retrieveRelevant = traceable(this.retrieveRelevant.bind(this), {
      name: "memory.retrieve_relevant",
      run_type: "retriever",
      metadata: { layer: "memory" },
    });
  }

  /**
   * Persist a conversation exchange as a memory entry.
   * Called AFTER the final response is delivered.
   */
  async storeExchange(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    const id = `mem-${sessionId}-${uuidv4()}`;
    const timestamp = Date.now();

    // Combine user + assistant for semantic embedding
    const text = `User: ${userMessage}\nAssistant: ${assistantResponse.slice(0, 500)}`;

    try {
      await this.vectorStore.addMemory(id, text, {
        sessionId,
        userMessage: userMessage.slice(0, 200),
        assistantResponse: assistantResponse.slice(0, 500),
        timestamp,
      });

      logger.debug({ id, sessionId }, "Memory stored");
    } catch (err) {
      logger.warn({ err, sessionId }, "Failed to store memory");
    }
  }

  /**
   * Retrieve top-k relevant past exchanges for the current query.
   * Filters to the same session if sessionId provided.
   */
  async retrieveRelevant(
    query: string,
    sessionId?: string,
    topK = 3
  ): Promise<MemoryEntry[]> {
    try {
      const results = await this.vectorStore.queryMemory(query, topK * 2);

      const filtered = sessionId
        ? results.filter((r) => r.metadata.sessionId === sessionId)
        : results;

      return filtered.slice(0, topK).map((r) => ({
        id: r.id,
        sessionId: String(r.metadata.sessionId ?? ""),
        userMessage: String(r.metadata.userMessage ?? ""),
        assistantResponse: String(r.metadata.assistantResponse ?? ""),
        timestamp: Number(r.metadata.timestamp ?? 0),
        text: r.text,
      }));
    } catch (err) {
      logger.warn({ err }, "Memory retrieval failed");
      return [];
    }
  }

  formatMemoriesForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "";

    const formatted = memories
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(
        (m) =>
          `[Past exchange]\nUser: ${m.userMessage}\nAssistant: ${m.assistantResponse}`
      )
      .join("\n\n");

    return `## Relevant conversation history\n${formatted}`;
  }
}
