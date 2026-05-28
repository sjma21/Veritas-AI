/**
 * Standalone MCP server entry point — stdio transport for Claude Desktop.
 *
 * Add to Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "veritas-corpus": {
 *       "command": "node",
 *       "args": ["/path/to/VeritasAI/dist/mcp/standalone.js"],
 *       "env": { "CHROMA_URL": "http://localhost:8000" }
 *     }
 *   }
 * }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildCorpusServer } from "./corpus_server.js";
import { VectorStore } from "../retrieval/vector_store.js";

async function main(): Promise<void> {
  const vectorStore = new VectorStore();
  await vectorStore.initialize();

  const server = buildCorpusServer(vectorStore);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the MCP stdio protocol on stdout
  process.stderr.write("VeritasAI MCP corpus server running (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal error: ${err}\n`);
  process.exit(1);
});
