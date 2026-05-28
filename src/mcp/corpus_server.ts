import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { VectorStore } from "../retrieval/vector_store.js";
import { logger } from "../utils/logger.js";

export function buildCorpusServer(vectorStore: VectorStore): Server {
  const server = new Server(
    { name: "veritas-corpus", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ── Tools ────────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_corpus",
        description:
          "Semantic search over the VeritasAI document corpus. Use this when you need to find specific information from the knowledge base or when initial retrieval may have missed relevant documents.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The search query — be specific for best results",
            },
            top_k: {
              type: "number",
              description: "Number of results to return (default 5, max 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_document",
        description:
          "Retrieve the full content of a specific document from the corpus by its ID (e.g. doc-001). Use when you already know which document you need.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "Document ID in the format doc-NNN (e.g. doc-012)",
            },
          },
          required: ["id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "search_corpus") {
      const query = args?.query as string;
      const topK = Math.min((args?.top_k as number) ?? 5, 10);

      logger.debug({ query, topK }, "MCP search_corpus called");

      const results = await vectorStore.query(query, topK);
      const payload = results.map((r) => ({
        id: r.id,
        title: r.title,
        score: r.score,
        content: r.content.slice(0, 500),
        source: r.source,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }

    if (name === "get_document") {
      const id = args?.id as string;

      logger.debug({ id }, "MCP get_document called");

      // Search by document ID — ChromaDB doesn't have direct ID lookup in our wrapper,
      // so fetch a broad set and find the exact match
      const results = await vectorStore.query(id, 25);
      const doc = results.find((r) => r.id === id);

      if (!doc) {
        return {
          content: [{ type: "text" as const, text: `Document "${id}" not found in corpus.` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { id: doc.id, title: doc.title, source: doc.source, content: doc.content },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown MCP tool: ${name}`);
  });

  // ── Resources ────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Return a static list — ChromaDB doesn't have a "list all" API in our wrapper,
    // so we surface the known doc-001…doc-025 range
    const ids = Array.from({ length: 25 }, (_, i) => `doc-${String(i + 1).padStart(3, "0")}`);
    return {
      resources: ids.map((id) => ({
        uri: `corpus://${id}`,
        name: id,
        description: `VeritasAI corpus document ${id}`,
        mimeType: "text/plain",
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const id = request.params.uri.replace("corpus://", "");
    const results = await vectorStore.query(id, 25);
    const doc = results.find((r) => r.id === id);

    if (!doc) {
      throw new Error(`Document "${id}" not found in corpus`);
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: `[${doc.id}] ${doc.title}\n\n${doc.content}`,
        },
      ],
    };
  });

  return server;
}
