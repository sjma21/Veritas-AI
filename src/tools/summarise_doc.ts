import { complete } from "../utils/llm_client.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { truncateToTokenLimit } from "../utils/token_counter.js";
import { traceable } from "../observability/langsmith.js";

const SUMMARISE_SYSTEM = `Summarise the provided text in 3–5 concise sentences. Focus on the key facts relevant to technical questions. Be precise and factual. Do not add information not present in the text.`;

async function _summariseDoc(url: string): Promise<string> {
  logger.debug({ url }, "summarise_doc tool invoked");

  // Simulated fetch — in production use node-fetch or axios with real content
  const simulatedContent = `This is a simulated document from ${url}. In production this would fetch real HTML content, strip markup, and truncate to a reasonable length before summarisation. The document at this URL would contain relevant technical information that supplements the agent's knowledge base. Key topics might include system architecture, API documentation, configuration guides, or best practice recommendations.`;

  try {
    const result = await complete({
      model: config.MODEL_CHEAP,
      system: SUMMARISE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `URL: ${url}\n\nContent:\n${simulatedContent.slice(0, 2000)}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 300,
    });

    const output = {
      url,
      summary: result.content.trim(),
      word_count: result.content.trim().split(/\s+/).length,
    };

    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  } catch (err) {
    logger.warn({ err, url }, "summarise_doc failed");
    const output = {
      url,
      error: err instanceof Error ? err.message : "Summarisation failed",
      summary: null,
    };
    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  }
}

export const summariseDoc = traceable(_summariseDoc, {
  name: "tool.summarise_doc",
  run_type: "tool",
  metadata: { layer: "tools" },
});
