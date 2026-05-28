# VeritasAI

A production-style multi-turn AI agent system with RAG, ReAct tool use, conversational memory, SSE streaming, citation verification, semantic caching, MCP integration, LangSmith observability, input/output guardrails, and image ingestion.

---

## Architecture

```
src/
├── agents/          orchestrator.ts          ReAct loop (max 5 iterations)
├── tools/           web_search (Tavily)       Tool registry + execution
│                    calculator, summarise_doc
├── retrieval/       corpus.ts                25-document corpus (2 contradictory docs)
│                    vector_store.ts          ChromaDB v2 wrapper
│                    query_rewriter.ts        LLM query expansion
│                    reranker.ts              LLM cross-encoder reranking
│                    pipeline.ts              Full retrieval pipeline
├── memory/          memory_manager.ts        Retrieval-based conversational memory
├── critic/          critic.ts                Two-phase citation + evidence verifier
├── guardrails/      pii_redactor.ts          Regex PII detection + redaction
│                    injection_detector.ts    Two-stage prompt injection detection
│                    content_moderator.ts     LLM-based content moderation
│                    index.ts                 Input + output guardrail pipeline
├── cache/           redis_client.ts          Redis conversation history (TTL)
│                    semantic_cache.ts        Near-duplicate query cache (ChromaDB)
├── mcp/             corpus_server.ts         MCP server exposing corpus as tools
│                    index.ts                 In-process MCP client (InMemoryTransport)
│                    standalone.ts            Stdio MCP server for Claude Desktop
├── ingestion/       vision_extractor.ts      Claude vision → text extraction
├── observability/   langsmith.ts             LangSmith tracing setup
├── evaluation/      dataset.ts               15-question golden dataset (3 tiers)
│                    runner.ts                Eval runner → CSV + eval_meta.json
├── schemas/         output.ts                Zod schemas for all I/O
├── streaming/       sse.ts                   SSE token streaming helpers
├── prompts/         templates.ts             System prompt + context builders
├── api/
│   ├── routes/      chat.ts, eval.ts         Express route handlers
│   │                health.ts, upload.ts
│   └── middleware/  rate_limiter.ts
├── config/          index.ts                 Zod-validated env config
└── index.ts                                  Entry point
```

---

## Quick Start

### Prerequisites

- Node.js 22
- pnpm (`npm install -g pnpm`)
- Docker + Docker Compose
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- OpenRouter API key ([openrouter.ai](https://openrouter.ai)) — embeddings only
- Tavily API key ([tavily.com](https://tavily.com)) — web search

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, OPENROUTER_API_KEY, TAVILY_API_KEY
```

### 3. Start infrastructure

```bash
docker compose up redis chromadb -d
```

### 4. Seed the document corpus

```bash
pnpm seed
```

Indexes 25 documents into ChromaDB, including two intentionally contradictory documents (doc-012 vs doc-013) about Redis memory limits.

### 5. Start the server + CLI

```bash
pnpm dev          # terminal 1 — hot-reload server
pnpm chat         # terminal 2 — interactive CLI
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `/exit` | Quit |
| `/session` | Show current session ID |
| `/clear` | Clear screen |
| `/upload <path>` | Upload an image — extracts text via Claude vision and indexes it |

---

## API

### `POST /chat`

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the Redis memory limits?", "stream": true}'
```

**SSE stream events:**
```
{"type":"cache_hit","similarity":0.97}            ← semantic cache hit
{"type":"guardrail","check":"pii","action":"redacted","detail":"Redacted: email"}
{"type":"retrieval","message":"Rewriting query..."}
{"type":"tool_call","tool":"web_search","input":{...}}
{"type":"tool_result","tool":"web_search","output":"{...}"}
{"type":"critic","message":"Critic PASSED","passed":true}
{"type":"token","content":"Based on the"}
{"type":"final","output":{...}}
data: [DONE]
```

### `POST /upload`

Upload an image — text is extracted via Claude vision and indexed in the corpus.

```bash
curl -X POST http://localhost:3000/upload \
  -F "image=@/path/to/diagram.png"
```

Supported formats: JPEG, PNG, GIF, WebP (max 10MB).

### `GET /health`

```bash
curl http://localhost:3000/health
```

### `npm run mcp`

Starts a standalone MCP server on stdio for Claude Desktop integration.

```json
{
  "mcpServers": {
    "veritas-corpus": {
      "command": "node",
      "args": ["/path/to/VeritasAI/dist/mcp/standalone.js"],
      "env": { "CHROMA_URL": "http://localhost:8000" }
    }
  }
}
```

---

## Models

| Task | Model | Why |
|------|-------|-----|
| Query rewrite, rerank, critic, memory | `claude-haiku-4-5-20251001` | Cheap structured tasks |
| Final synthesis + ReAct tool use | `claude-haiku-4-5-20251001` | Reasoning + tool calls |
| Embeddings | `text-embedding-3-small` via OpenRouter | Anthropic has no embeddings API |

---

## Evaluation

```bash
pnpm eval        # all 15 questions → eval_results.csv
pnpm eval:ci     # Tier 1+2 only (used in CI, skips non-deterministic web search)
```

**Tiers:**
- **Tier 1 (5q):** Corpus-only questions — gate: ≥4/5
- **Tier 2 (5q):** Requires tool use (calculator/web_search) — gate: ≥3/5
- **Tier 3 (5q):** Retrieval + tools + memory — gate: ≥2/5
- **Schema validity:** Gate: ≥85%

Generate a Markdown report from last run:
```bash
node scripts/eval_summary.mjs
```

---

## CI / Quality Gate

Every PR to `main` triggers `.github/workflows/eval-ci.yml`:

1. Starts ChromaDB + Redis as Docker services
2. Seeds corpus
3. Runs `pnpm eval:ci` (Tier 1+2, ~10 questions)
4. Fails the PR if any threshold is not met
5. Posts a quality report table to the GitHub Actions Step Summary
6. Uploads `eval_results.csv` + `eval_meta.json` as artifacts (30 days)

**Required GitHub Secrets:** `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`

---

## Guardrails

Applied on every `/chat` request — input before the orchestrator, output before streaming.

| Check | Layer | Method | On trigger |
|-------|-------|--------|------------|
| PII redaction | input + output | Regex (email, phone, SSN, card, IP, API keys) | Redact → continue |
| Injection detection | input | Regex + LLM scorer | Block if score ≥ 0.7 |
| Content moderation | input + output | LLM classifier | Block input / replace output |

Toggle per-check with `GUARDRAILS_PII_ENABLED`, `GUARDRAILS_INJECTION_ENABLED`, `GUARDRAILS_CONTENT_ENABLED`.

---

## Semantic Cache

Near-identical queries skip the full pipeline:

- **Lookup:** embed query → cosine search → return cached `AgentOutput` if similarity ≥ `SEMANTIC_CACHE_THRESHOLD` (0.92) and within TTL
- **Store:** cached after successful response with confidence ≥ `SEMANTIC_CACHE_MIN_CONFIDENCE` (0.35)
- CLI shows: `⚡ Semantic cache hit (97.3% match — full pipeline skipped)`

---

## LangSmith Tracing

Set `LANGSMITH_API_KEY` + `LANGSMITH_TRACING=true` to see per-layer traces:

```
agent.run
  ├── semantic_cache.lookup
  ├── memory.retrieve_relevant
  ├── retrieval.pipeline
  │     ├── retrieval.query_rewrite → llm.complete
  │     ├── vector_store.query      → llm.embed
  │     └── retrieval.rerank        → llm.complete ×5
  ├── llm.complete  (ReAct synthesis)
  ├── tool.web_search / tool.calculator / mcp.call_tool
  ├── critic.verify → llm.complete
  └── memory.store_exchange
```

---

## Key Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | All LLM completions |
| `OPENROUTER_API_KEY` | required | Embeddings only |
| `TAVILY_API_KEY` | required | Real web search |
| `MODEL_CHEAP` | `claude-haiku-4-5-20251001` | Cheap tasks |
| `MODEL_STRONG` | `claude-haiku-4-5-20251001` | Synthesis + tools |
| `RETRIEVAL_CONFIDENCE_THRESHOLD` | `0.45` | Below this → "I don't know" |
| `SEMANTIC_CACHE_THRESHOLD` | `0.92` | Similarity gate for cache hit |
| `GUARDRAILS_INJECTION_THRESHOLD` | `0.7` | Injection block threshold |
| `EVAL_TIER_FILTER` | (all) | e.g. `1,2` to run only those tiers |
| `LANGSMITH_API_KEY` | optional | Enable tracing |
