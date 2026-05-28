import { complete } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { RetrievedChunk } from "./vector_store.js";
import { traceable } from "../observability/langsmith.js";

const RERANK_SYSTEM = `You are a relevance scoring assistant. Given a query and a document chunk, output a single number from 0.0 to 1.0 representing how relevant the document is to answering the query. 0=not relevant, 1=highly relevant. Output ONLY the number, nothing else.`;

/**
 * LLM-based reranker. Scores each candidate against the query and reorders.
 * Falls back to original bi-encoder scores on failure.
 */
async function _rerank(
  query: string,
  chunks: RetrievedChunk[],
  topK = config.RERANK_TOP_K
): Promise<RetrievedChunk[]> {
  if (chunks.length <= topK) return chunks;

  try {
    const scoringPromises = chunks.map(async (chunk): Promise<[RetrievedChunk, number]> => {
      try {
        const result = await complete({
          model: config.MODEL_CHEAP,
          system: RERANK_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Query: ${query}\n\nDocument: ${chunk.title}\n${chunk.content.slice(0, 400)}`,
            },
          ],
          temperature: 0,
          maxTokens: 10,
        });

        const score = parseFloat(result.content.trim());
        return [chunk, isNaN(score) ? chunk.score : score];
      } catch {
        return [chunk, chunk.score];
      }
    });

    const scored = await Promise.all(scoringPromises);
    scored.sort((a, b) => b[1] - a[1]);

    const reranked = scored.slice(0, topK).map(([chunk, score]) => ({ ...chunk, score }));
    logger.debug({ query, inputChunks: chunks.length, outputChunks: reranked.length }, "Reranking complete");
    return reranked;
  } catch (err) {
    logger.warn({ err }, "Reranking failed, using original order");
    return chunks.slice(0, topK);
  }
}

export const rerank = traceable(_rerank, {
  name: "retrieval.rerank",
  run_type: "chain",
  metadata: { layer: "retrieval" },
});

export function detectContradictions(chunks: RetrievedChunk[]): string[] {
  const contradictionPairs: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const a = chunks[i];
      const b = chunks[j];

      const aContradicts = a.metadata.contradicts as string | undefined;
      const bContradicts = b.metadata.contradicts as string | undefined;

      if (aContradicts === b.id || bContradicts === a.id) {
        contradictionPairs.push(
          `⚠️ CONTRADICTION DETECTED: "${a.title}" (${a.id}) and "${b.title}" (${b.id}) contain conflicting information on this topic.`
        );
      }
    }
  }

  return contradictionPairs;
}
