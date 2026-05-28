import { complete } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

const REWRITE_SYSTEM = `You are a query rewriting assistant for semantic document retrieval.
Your task: transform the user's conversational question into a precise retrieval query that will surface relevant technical documents.
Rules:
- Preserve the original intent fully
- Make the query self-contained (no pronouns like "they", "it", "this")
- Expand abbreviations when helpful
- Output ONLY the rewritten query text, no explanation, no quotes`;

export async function rewriteQuery(
  originalQuery: string,
  conversationContext?: string
): Promise<string> {
  const userMessage = conversationContext
    ? `Conversation context (for reference only):\n${conversationContext}\n\nCurrent question to rewrite:\n${originalQuery}`
    : `Question to rewrite:\n${originalQuery}`;

  try {
    const result = await complete({
      model: config.MODEL_CHEAP,
      system: REWRITE_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
      temperature: 0.1,
      maxTokens: 200,
    });

    const rewritten = result.content.trim();

    if (!rewritten || rewritten.length < 5) {
      logger.warn({ originalQuery }, "Query rewrite produced empty result, using original");
      return originalQuery;
    }

    logger.debug({ original: originalQuery, rewritten }, "Query rewritten");
    return rewritten;
  } catch (err) {
    logger.warn({ err, originalQuery }, "Query rewrite failed, using original");
    return originalQuery;
  }
}
