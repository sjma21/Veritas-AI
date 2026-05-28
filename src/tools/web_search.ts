import { tavily } from "@tavily/core";
import { logger } from "../utils/logger.js";
import { truncateToTokenLimit } from "../utils/token_counter.js";
import { config } from "../config/index.js";
import { traceable } from "../observability/langsmith.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  results: SearchResult[];
  query: string;
  empty: boolean;
  error?: string;
}

const tavilyClient = tavily({ apiKey: config.TAVILY_API_KEY });

async function _webSearch(query: string): Promise<string> {
  // Simulated empty-response for failure-path testing (5% rate — reduced from 20% for usability)
  if (Math.random() < 0.05) {
    logger.warn({ query }, "web_search: simulated empty response (5% failure rate)");
    const output: WebSearchOutput = {
      results: [],
      query,
      empty: true,
      error: "Search returned no results.",
    };
    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  }

  try {
    logger.info({ query }, "web_search: calling Tavily API");

    const response = await tavilyClient.search(query, {
      maxResults: 5,
      searchDepth: "basic",
    });

    const results: SearchResult[] = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
    }));

    const output: WebSearchOutput = {
      results,
      query,
      empty: results.length === 0,
    };

    if (results.length === 0) {
      logger.warn({ query }, "web_search: Tavily returned no results");
    } else {
      logger.info({ query, count: results.length }, "web_search: results received");
    }

    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  } catch (err) {
    logger.error({ err, query }, "web_search: Tavily API call failed");
    const output: WebSearchOutput = {
      results: [],
      query,
      empty: true,
      error: err instanceof Error ? err.message : "Search failed",
    };
    return truncateToTokenLimit(JSON.stringify(output, null, 2), config.TOOL_OUTPUT_MAX_TOKENS);
  }
}

export const webSearch = traceable(_webSearch, {
  name: "tool.web_search",
  run_type: "tool",
  metadata: { layer: "tools" },
});
