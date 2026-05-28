import { rewriteQuery } from "./query_rewriter.js";
import { VectorStore, type RetrievedChunk } from "./vector_store.js";
import { rerank, detectContradictions } from "./reranker.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { StreamEvent } from "../schemas/output.js";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  rewrittenQuery: string;
  confidence: number;
  contradictions: string[];
  belowThreshold: boolean;
}

export type StreamEmitter = (event: StreamEvent) => void;

export async function runRetrievalPipeline(
  originalQuery: string,
  vectorStore: VectorStore,
  emit: StreamEmitter,
  conversationContext?: string
): Promise<RetrievalResult> {
  // Step 1: Query rewriting
  emit({ type: "retrieval", message: "Rewriting query for semantic retrieval..." });
  const rewrittenQuery = await rewriteQuery(originalQuery, conversationContext);
  emit({
    type: "retrieval",
    message: `Query rewritten: "${rewrittenQuery}"`,
    data: { original: originalQuery, rewritten: rewrittenQuery },
  });

  // Step 2: Vector search
  emit({ type: "retrieval", message: "Searching document corpus..." });
  const candidates = await vectorStore.query(rewrittenQuery, config.RETRIEVAL_TOP_K);

  if (candidates.length === 0) {
    logger.warn({ query: rewrittenQuery }, "Vector search returned no results");
    emit({ type: "retrieval", message: "No matching documents found in corpus." });
    return {
      chunks: [],
      rewrittenQuery,
      confidence: 0,
      contradictions: [],
      belowThreshold: true,
    };
  }

  emit({
    type: "retrieval",
    message: `Retrieved ${candidates.length} candidate chunks (top score: ${candidates[0].score.toFixed(3)})`,
  });

  // Step 3: Reranking
  emit({ type: "retrieval", message: "Reranking candidates..." });
  const reranked = await rerank(rewrittenQuery, candidates, config.RERANK_TOP_K);

  // Step 4: Confidence scoring
  const confidence = computeConfidence(reranked);

  // Step 5: Contradiction detection
  const contradictions = detectContradictions(reranked);
  if (contradictions.length > 0) {
    emit({
      type: "retrieval",
      message: `Found ${contradictions.length} contradicting source(s) — will surface explicitly`,
      data: { contradictions },
    });
  }

  const belowThreshold = confidence < config.RETRIEVAL_CONFIDENCE_THRESHOLD;
  if (belowThreshold) {
    emit({
      type: "retrieval",
      message: `Low retrieval confidence (${confidence.toFixed(3)} < ${config.RETRIEVAL_CONFIDENCE_THRESHOLD}) — will return uncertainty`,
    });
  } else {
    emit({
      type: "retrieval",
      message: `Retrieval complete. Confidence: ${confidence.toFixed(3)}. Using top ${reranked.length} chunks.`,
    });
  }

  logger.info({ confidence, chunks: reranked.length, contradictions: contradictions.length }, "Retrieval pipeline complete");

  return { chunks: reranked, rewrittenQuery, confidence, contradictions, belowThreshold };
}

function computeConfidence(chunks: RetrievedChunk[]): number {
  if (chunks.length === 0) return 0;
  // Weighted average, giving more weight to top results
  const weights = chunks.map((_, i) => 1 / (i + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = chunks.reduce((sum, chunk, i) => sum + chunk.score * weights[i], 0);
  return weightedSum / totalWeight;
}
