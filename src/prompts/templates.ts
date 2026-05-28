import type { RetrievedChunk } from "../retrieval/vector_store.js";

export function buildSystemPrompt(): string {
  return `You are VeritasAI, a precise and honest research assistant. You answer questions based on provided document context.

Rules:
1. Only cite sources that appear in the provided context. Use the exact document ID (e.g., doc-001) as citation keys.
2. If documents contradict each other, explicitly surface the contradiction and present both perspectives.
3. If you are uncertain or evidence is weak, say "I don't know" or state your uncertainty explicitly — never fabricate.
4. Always output a valid JSON response matching the required schema.
5. Follow-up questions should be specific and answerable from the corpus.
6. Confidence (0–1): 0.9+ for well-supported answers, 0.5–0.8 for partial evidence, 0.3 for uncertain.

Output format (JSON):
{
  "answer": "Your detailed answer here",
  "citations": ["doc-001", "doc-005"],
  "confidence": 0.85,
  "follow_up_questions": ["Question 1?", "Question 2?"]
}`;
}

export function buildContextBlock(
  chunks: RetrievedChunk[],
  contradictions: string[]
): string {
  if (chunks.length === 0) return "";

  const docBlocks = chunks
    .map(
      (c) =>
        `[${c.id}] ${c.title} (source: ${c.source}, relevance: ${c.score.toFixed(3)})\n${c.content}`
    )
    .join("\n\n---\n\n");

  const contradictionBlock =
    contradictions.length > 0
      ? `\n\n## ⚠️ CONTRADICTIONS FOUND\n${contradictions.join("\n")}\nYou MUST acknowledge these contradictions in your answer.\n`
      : "";

  return `## Retrieved Documents\n\n${docBlocks}${contradictionBlock}`;
}

export function buildUncertaintyResponse(): string {
  return JSON.stringify({
    answer:
      "I don't know. The available documents do not contain sufficient information to answer this question confidently. Please refine your query or consult additional sources.",
    citations: [],
    confidence: 0.1,
    follow_up_questions: [
      "Could you provide more context about what aspect you are asking about?",
      "Are there specific documents or sources you would like me to reference?",
    ],
  });
}

export function buildAgentSynthesisPrompt(
  userMessage: string,
  contextBlock: string,
  memoryBlock: string,
  toolEvidence: string
): string {
  const parts: string[] = [];

  if (memoryBlock) parts.push(memoryBlock);
  if (contextBlock) parts.push(contextBlock);
  if (toolEvidence) parts.push(`## Tool Evidence\n${toolEvidence}`);
  parts.push(`## User Question\n${userMessage}`);
  parts.push(
    `\nRespond with ONLY valid JSON matching the schema: { answer, citations, confidence, follow_up_questions }`
  );

  return parts.join("\n\n");
}
