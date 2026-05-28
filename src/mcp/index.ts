import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCorpusServer } from "./corpus_server.js";
import { VectorStore } from "../retrieval/vector_store.js";
import { logger } from "../utils/logger.js";
import type { AnthropicTool } from "../utils/llm_client.js";
import { traceable } from "../observability/langsmith.js";

export interface McpToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface McpClient {
  callTool(call: McpToolCall): Promise<string>;
  getToolDefinitions(): AnthropicTool[];
  close(): Promise<void>;
}

/**
 * Creates an in-process MCP client connected to the corpus server.
 * Uses InMemoryTransport — no subprocess, no network, full type safety.
 */
export async function createInProcessMcpClient(vectorStore: VectorStore): Promise<McpClient> {
  const server = buildCorpusServer(vectorStore);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "veritas-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { tools } = await client.listTools();

  logger.info(
    { tools: tools.map((t) => t.name) },
    "MCP client connected — corpus tools available"
  );

  // Convert MCP tool definitions → Anthropic tool format
  const anthropicTools: AnthropicTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as AnthropicTool["input_schema"],
  }));

  const _callTool = traceable(
    async ({ name, input }: McpToolCall): Promise<string> => {
      logger.debug({ name, input }, "MCP tool call");
      const result = await client.callTool({ name, arguments: input });

      const texts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");

      if (result.isError) {
        return JSON.stringify({ error: texts });
      }

      return texts;
    },
    { name: "mcp.call_tool", run_type: "tool", metadata: { layer: "mcp" } }
  );

  return {
    async callTool(call: McpToolCall): Promise<string> {
      return _callTool(call);
    },

    getToolDefinitions(): AnthropicTool[] {
      return anthropicTools;
    },

    async close(): Promise<void> {
      await client.close();
      logger.debug("MCP client closed");
    },
  };
}
