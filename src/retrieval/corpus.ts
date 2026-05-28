/**
 * Corpus of 25 documents for the retrieval pipeline.
 * Documents 12 and 13 intentionally contradict each other (Redis memory limits).
 */

export interface CorpusDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
}

export const CORPUS: CorpusDocument[] = [
  {
    id: "doc-001",
    title: "Introduction to Vector Databases",
    source: "internal/vector-db-intro.md",
    content: `Vector databases store high-dimensional embeddings and support approximate nearest-neighbour (ANN) search. They are the backbone of modern semantic search and RAG (Retrieval-Augmented Generation) systems. Popular options include ChromaDB, Pinecone, Weaviate, Qdrant, and pgvector. Each document is converted to a dense embedding vector, typically 768–3072 dimensions, before being indexed. Cosine similarity is the most common distance metric. ChromaDB is easy to self-host and supports persistent storage, making it suitable for development and mid-scale production workloads.`,
    metadata: { category: "infrastructure", tier: 1 },
  },
  {
    id: "doc-002",
    title: "Redis as a Caching Layer",
    source: "internal/redis-caching.md",
    content: `Redis is an in-memory key-value store widely used for caching, session storage, and pub/sub messaging. In AI agent systems it serves as a fast cache for embedding results, API responses, and conversation state. Redis supports TTL-based expiry, which is useful for invalidating stale LLM responses. When used as a session store, session data is serialised as JSON and stored under a key such as session:<session_id>. Redis pipelines and Lua scripts can reduce round-trips. The recommended eviction policy for caching workloads is allkeys-lru.`,
    metadata: { category: "infrastructure", tier: 1 },
  },
  {
    id: "doc-003",
    title: "OpenRouter API Overview",
    source: "internal/openrouter-overview.md",
    content: `OpenRouter is a unified API gateway that provides access to 200+ LLM models from providers like OpenAI, Anthropic, Google, Mistral, and open-source models via a single OpenAI-compatible endpoint. Requests are billed per token at the underlying provider's rate plus a small routing fee. The base URL is https://openrouter.ai/api/v1 and authentication uses Bearer tokens. Model IDs follow the format provider/model-name, e.g. openai/gpt-4o-mini, anthropic/claude-3-haiku. OpenRouter supports streaming via Server-Sent Events (SSE) with the stream: true parameter.`,
    metadata: { category: "api", tier: 1 },
  },
  {
    id: "doc-004",
    title: "ReAct Agent Pattern",
    source: "internal/react-pattern.md",
    content: `The ReAct (Reason + Act) pattern interleaves reasoning traces with action calls in a loop. At each step the agent produces a Thought (internal reasoning), selects an Action (tool call), receives an Observation (tool result), then decides whether to continue or produce a final answer. This loop runs until a termination condition is met or a maximum iteration limit is reached. ReAct improves factual accuracy by grounding reasoning in external observations rather than relying purely on parametric knowledge. Iteration limits (e.g. 5) prevent infinite loops and control cost.`,
    metadata: { category: "agents", tier: 1 },
  },
  {
    id: "doc-005",
    title: "Retrieval-Augmented Generation (RAG)",
    source: "internal/rag-fundamentals.md",
    content: `RAG combines a retriever and a generator. The retriever fetches relevant document chunks from a vector store given a query embedding. The generator (LLM) conditions its response on the retrieved context. RAG reduces hallucination by grounding answers in source documents. The quality of retrieval directly caps answer quality — if the retriever misses the relevant chunk, the generator cannot produce a correct answer. Common improvements: query rewriting, hybrid search (dense + sparse BM25), cross-encoder reranking, and contextual compression of long chunks.`,
    metadata: { category: "rag", tier: 1 },
  },
  {
    id: "doc-006",
    title: "Embedding Models Comparison",
    source: "internal/embedding-models.md",
    content: `text-embedding-3-small from OpenAI produces 1536-dimensional embeddings at very low cost ($0.02/1M tokens) and outperforms older ada-002 embeddings on MTEB benchmarks. text-embedding-3-large (3072 dims) achieves higher accuracy at 5x the cost. For most RAG applications, text-embedding-3-small offers the best cost/quality tradeoff. Cohere embed-v3 and voyage-large-2 are strong alternatives. Always embed both queries and documents with the same model. Normalise vectors to unit length before cosine similarity.`,
    metadata: { category: "embeddings", tier: 1 },
  },
  {
    id: "doc-007",
    title: "Cross-Encoder Reranking",
    source: "internal/reranking.md",
    content: `After bi-encoder retrieval returns the top-k candidates, a cross-encoder reranker scores each (query, document) pair jointly, enabling much more accurate relevance ranking. Cross-encoders are slower but more accurate because they see the full query-document interaction rather than independent embeddings. A common setup retrieves top-20 with a bi-encoder, then reranks to top-5 with a cross-encoder. Cohere Rerank API offers hosted cross-encoder reranking. For self-hosted options, ms-marco-MiniLM-L-6-v2 is efficient. Reranking dramatically improves precision for complex or ambiguous queries.`,
    metadata: { category: "rag", tier: 1 },
  },
  {
    id: "doc-008",
    title: "Streaming LLM Responses with SSE",
    source: "internal/streaming-sse.md",
    content: `Server-Sent Events (SSE) is the standard protocol for streaming LLM tokens to browser clients. The server sends a text/event-stream content-type header and writes data: <json>\n\n frames for each token chunk. The client uses EventSource API or fetch with ReadableStream. In Express, res.write() pushes chunks without closing the connection. Each chunk carries a delta.content field. A final data: [DONE]\n\n frame signals completion. SSE is unidirectional and simpler than WebSockets for token streaming. Always set Cache-Control: no-cache and Connection: keep-alive on SSE responses.`,
    metadata: { category: "streaming", tier: 1 },
  },
  {
    id: "doc-009",
    title: "Zod Schema Validation in TypeScript",
    source: "internal/zod-validation.md",
    content: `Zod is a TypeScript-first schema validation library. Schemas describe the shape and constraints of data and can parse (throw on failure) or safeParse (return a result object). z.object(), z.string(), z.number(), z.array() cover most cases. Discriminated unions with z.discriminatedUnion() are efficient for event types. Zod infers TypeScript types via z.infer<typeof schema>. In LLM output validation, always use safeParse and retry generation once on failure before logging and falling back to a default. Zod transforms (.transform()) can post-process parsed values.`,
    metadata: { category: "validation", tier: 1 },
  },
  {
    id: "doc-010",
    title: "Conversational Memory Architecture",
    source: "internal/memory-architecture.md",
    content: `Conversational memory in agent systems can be episodic (verbatim exchange history) or semantic (embedded summaries). A retrieval-based memory stores each exchange as an embedded vector and retrieves the top-k most relevant past exchanges for a new query. This avoids unbounded context growth. Memory injection order matters: memories should appear below the system prompt and above retrieved document chunks so the model sees them in priority order. Each memory entry records: user message, assistant response, timestamp, and session ID. Periodic summarisation of old memories reduces storage cost.`,
    metadata: { category: "memory", tier: 1 },
  },
  {
    id: "doc-011",
    title: "Prompt Engineering for Citation Generation",
    source: "internal/citation-prompting.md",
    content: `To generate verifiable citations, instruct the model to quote source IDs directly from the provided context chunks. The system prompt should say: "Only cite sources provided in the context. Use the exact document ID as the citation key." Citation verification in a critic pass involves checking that each cited ID exists in the retrieval results and that the quoted text is supported by that document's content. Never invent document IDs. If evidence is insufficient, instruct the model to state uncertainty rather than fabricate a citation. Structured output schemas enforce citation as an array of string IDs.`,
    metadata: { category: "prompting", tier: 1 },
  },
  {
    id: "doc-012",
    title: "Redis Memory Limits — Standard Configuration",
    source: "internal/redis-memory-standard.md",
    content: `[INTENTIONAL CONTRADICTION — Document A] Redis can store up to 512 MB of data per instance by default under standard configuration. For production deployments handling large conversation histories, a maxmemory limit of 512 MB is recommended with the allkeys-lru eviction policy. When memory usage approaches the limit, Redis evicts the least-recently-used keys to make room. For AI agent workloads storing conversation state and embedding caches, 512 MB is typically sufficient for up to 50,000 concurrent sessions. Operators should monitor memory usage with the INFO memory command.`,
    metadata: { category: "infrastructure", tier: 1, contradiction: true, contradicts: "doc-013" },
  },
  {
    id: "doc-013",
    title: "Redis Memory Limits — High-Throughput Configuration",
    source: "internal/redis-memory-highperf.md",
    content: `[INTENTIONAL CONTRADICTION — Document B] Redis has no fixed default memory limit — it will consume all available system RAM unless explicitly constrained by the maxmemory directive. A common production recommendation is to set maxmemory to 75% of system RAM to leave headroom for the OS. For AI agent workloads, allocating 2–8 GB per Redis instance is typical, far exceeding the misconception that 512 MB is a default cap. The 512 MB figure refers only to certain cloud-hosted Redis tiers (e.g. Redis Cloud free tier) and does not apply to self-hosted instances. Operators should use MEMORY USAGE <key> to profile actual per-key consumption.`,
    metadata: { category: "infrastructure", tier: 1, contradiction: true, contradicts: "doc-012" },
  },
  {
    id: "doc-014",
    title: "TypeScript Strict Mode Best Practices",
    source: "internal/typescript-strict.md",
    content: `Enabling strict mode in tsconfig.json turns on strictNullChecks, strictFunctionTypes, strictPropertyInitialization, and noImplicitAny. These catches a large class of runtime bugs at compile time. Use unknown instead of any for external data — always narrow with a type guard or Zod parse before use. Optional chaining (?.) and nullish coalescing (??) are idiomatic for handling potentially-null values. Discriminated unions provide exhaustive switch coverage. The satisfies operator (TS 4.9+) validates a value against a type without widening it. Enable exactOptionalPropertyTypes for strictest optional handling.`,
    metadata: { category: "typescript", tier: 1 },
  },
  {
    id: "doc-015",
    title: "Token Budgeting in LLM Applications",
    source: "internal/token-budgeting.md",
    content: `Context windows are finite. A production agent must track token usage across system prompt, retrieved chunks, memory, tool outputs, and the running conversation. A simple heuristic: system (500 tokens) + memories (300) + docs (1500) + history (700) + tool outputs (500) = 3500 tokens leaving 500+ for generation in a 4096-token context. For longer contexts (128k), reserve 20% for generation. Tool outputs exceeding 500 tokens should be summarised before inclusion. Implement a sliding window over conversation history, keeping only the most recent turns. Log input/output tokens per call to track costs.`,
    metadata: { category: "llm-ops", tier: 2 },
  },
  {
    id: "doc-016",
    title: "Calculator Tool Implementation",
    source: "internal/calculator-tool.md",
    content: `A safe calculator tool for AI agents should evaluate mathematical expressions without eval(). Use a dedicated math parsing library such as mathjs, which supports arithmetic, algebra, trigonometry, and unit conversions. Sanitise input to reject non-mathematical strings. Return results as numbers with units where applicable. Example: calculator("2^10 + sqrt(144)") → 1036. Error handling should catch parse errors and return a descriptive message rather than crashing. Keep the tool stateless — never maintain intermediate results between calls. Log all calculator invocations for debugging.`,
    metadata: { category: "tools", tier: 2 },
  },
  {
    id: "doc-017",
    title: "Web Search Tool Design Patterns",
    source: "internal/web-search-tool.md",
    content: `Web search tools for agents should return structured results: title, URL, and a snippet per result. Limit results to the top 3–5 to control token usage. Implement timeout handling (10s default) and graceful degradation when the search API is unavailable. For robustness, agents should check whether search returned results and fall back to corpus-only answers when search fails rather than hallucinating. Rate limiting and caching prevent repeated identical searches. In testing and evaluation environments, simulated 20% empty-response rates expose whether the agent handles search failures safely.`,
    metadata: { category: "tools", tier: 2 },
  },
  {
    id: "doc-018",
    title: "Document Summarisation Tool",
    source: "internal/summarise-tool.md",
    content: `A summarise_doc tool fetches a URL and returns a concise summary. It should: (1) fetch the HTML/text content with a timeout, (2) strip markup, (3) truncate to a reasonable length (e.g. 8000 chars), (4) call a cheap LLM to produce a 3–5 sentence summary, (5) return the summary with a word count. For agent systems, the tool should gracefully handle 404s, network timeouts, and non-text content types. Token limit: output summaries to ≤ 300 tokens. Always include the source URL in the returned summary so the critic can verify the citation.`,
    metadata: { category: "tools", tier: 2 },
  },
  {
    id: "doc-019",
    title: "Critic Layer in LLM Pipelines",
    source: "internal/critic-layer.md",
    content: `A critic layer is a second LLM pass that evaluates the primary response before it is returned to the user. The critic checks: (1) factual grounding — does every claim trace to a cited source? (2) citation validity — does each citation ID exist in the context? (3) confidence calibration — is the stated confidence consistent with the evidence strength? (4) contradiction surfacing — are conflicting sources acknowledged? The critic outputs a structured verdict: {passed: boolean, issues: string[], revised_answer?: string}. If the critic fails, the system can either revise the answer, lower the confidence score, or return an explicit uncertainty statement.`,
    metadata: { category: "quality", tier: 2 },
  },
  {
    id: "doc-020",
    title: "Rate Limiting in Express APIs",
    source: "internal/rate-limiting.md",
    content: `Rate limiting protects AI API endpoints from abuse and controls cost. The rate-limiter-flexible library supports Redis-backed distributed rate limiting. A typical configuration: 60 requests/minute per IP, sliding window. On limit exceeded, return 429 with a Retry-After header. For authenticated endpoints, rate limit per user rather than IP. Implement separate rate limits for expensive endpoints (e.g. /chat: 10 req/min, /eval: 2 req/min). Use the X-RateLimit-Remaining and X-RateLimit-Reset headers for client-side feedback. In development, disable rate limiting or set very high limits.`,
    metadata: { category: "api", tier: 2 },
  },
  {
    id: "doc-021",
    title: "Evaluation Frameworks for RAG Systems",
    source: "internal/rag-evaluation.md",
    content: `RAG evaluation covers retrieval quality (recall, precision, MRR) and generation quality (faithfulness, answer relevance, context precision). Golden datasets consist of question-answer pairs with known expected sources. Automated metrics: RAGAS scores (faithfulness, answer relevance, context recall). A tiered evaluation approach tests corpus-only questions, tool-required questions, and complex multi-step questions separately. Track schema validity, citation quality (0=none, 1=present, 2=accurate), latency, and token cost per query. Minimum passing thresholds ensure regressions are caught: Tier 1 ≥ 80%, Tier 2 ≥ 60%, Tier 3 ≥ 40%.`,
    metadata: { category: "evaluation", tier: 2 },
  },
  {
    id: "doc-022",
    title: "Docker Compose for AI Development Stacks",
    source: "internal/docker-compose-ai.md",
    content: `A minimal AI agent development stack with Docker Compose includes: the application container, Redis for caching/memory, and a vector database (ChromaDB or pgvector). Use named volumes for persistence. Health checks ensure dependent services start before the app. A .env file passes secrets via environment variables — never bake API keys into images. Use multi-stage builds for the application to keep production images small. The vector DB container should expose its HTTP port (ChromaDB: 8000, pgvector via PostgREST: 3000). Bridge networking allows service discovery by service name.`,
    metadata: { category: "infrastructure", tier: 2 },
  },
  {
    id: "doc-023",
    title: "Query Rewriting for Semantic Retrieval",
    source: "internal/query-rewriting.md",
    content: `Query rewriting improves retrieval recall by transforming a conversational user query into a more precise, self-contained retrieval query. Techniques: (1) HyDE (Hypothetical Document Embedding) — generate a hypothetical answer, embed it, and retrieve against that. (2) Multi-query — generate 3 variations of the query and take the union of results. (3) Step-back prompting — ask a broader question first, then narrow. For most cases, a simple rewrite prompt — "Rewrite this query for semantic search over a technical document corpus, preserving intent" — with a cheap model (gpt-4o-mini) adds negligible latency and cost while improving recall.`,
    metadata: { category: "rag", tier: 2 },
  },
  {
    id: "doc-024",
    title: "Structured JSON Output from LLMs",
    source: "internal/structured-output.md",
    content: `Reliable structured output from LLMs can be achieved via: (1) response_format: { type: 'json_object' } (OpenAI) — instructs the model to output valid JSON. (2) Function calling / tool use — define a schema and force the model to call the function. (3) Prompt engineering alone — least reliable, requires explicit JSON examples. Always validate LLM JSON output with Zod safeParse. Retry once on validation failure with an error message injected into the conversation. Log all schema failures with the raw output for debugging. Never pass unvalidated LLM output downstream.`,
    metadata: { category: "prompting", tier: 2 },
  },
  {
    id: "doc-025",
    title: "Session Management in Multi-Turn Agents",
    source: "internal/session-management.md",
    content: `Multi-turn agent systems require session management to track conversation state across requests. Sessions are identified by a UUID stored client-side (cookie or header). Server-side, session data includes: conversation history, user preferences, and accumulated tool evidence. In Redis, sessions expire after a configurable TTL (e.g. 1 hour of inactivity). For stateless deployments, all session state should be stored externally (Redis) rather than in process memory. The maximum conversation history to include in context is determined by token budgeting — typically the last 6–10 turns. Older turns can be summarised rather than dropped.`,
    metadata: { category: "agents", tier: 3 },
  },
];

// Seed script
if (process.argv[2] === "seed") {
  import("./vector_store.js").then(async ({ VectorStore }) => {
    const vs = new VectorStore();
    await vs.initialize();
    await vs.indexCorpus(CORPUS);
    console.log(`Seeded ${CORPUS.length} documents`);
    process.exit(0);
  });
}
