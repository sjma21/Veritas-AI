import type { AnthropicTool } from "../utils/llm_client.js";
import { webSearch } from "./web_search.js";
import { calculator } from "./calculator.js";
import { summariseDoc } from "./summarise_doc.js";
import { logger } from "../utils/logger.js";

export type ToolName = "web_search" | "calculator" | "summarise_doc";

export const TOOL_DEFINITIONS: AnthropicTool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information. May return empty results (~20% of the time).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "calculator",
    description:
      "Evaluate a mathematical expression safely. Supports arithmetic, algebra, trig, and unit conversions.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The math expression to evaluate, e.g. '2^10 + sqrt(144)'",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "summarise_doc",
    description: "Fetch and summarise a document at a given URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL of the document to summarise" },
      },
      required: ["url"],
    },
  },
];

export async function executeTool(name: string, args: Record<string, string>): Promise<string> {
  logger.info({ tool: name, args }, "Executing tool");

  try {
    switch (name as ToolName) {
      case "web_search":    return await webSearch(args.query ?? "");
      case "calculator":    return await calculator(args.expression ?? "");
      case "summarise_doc": return await summariseDoc(args.url ?? "");
      default:              return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    logger.error({ err, tool: name }, "Tool execution failed");
    return JSON.stringify({
      error: `Tool "${name}" failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}
