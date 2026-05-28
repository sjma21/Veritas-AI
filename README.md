# VeritasAI

A production-style multi-turn AI agent system with retrieval-augmented generation, tool use, conversational memory, streaming, citation verification, and an evaluation framework.

---

## Architecture

```
src/
├── agents/          orchestrator.ts          ReAct agent loop (max 5 iterations)
├── tools/           web_search, calculator,  Tool registry + execution
│                    summarise_doc
├── retrieval/       corpus.ts                25-document corpus (2 contradictory docs)
│                    vector_store.ts          ChromaDB wrapper
│                    query_rewriter.ts        Cheap-model query rewriting
│                    reranker.ts              LLM cross-encoder reranking
│                    pipeline.ts              Full retrieval pipeline
├── memory/          memory_manager.ts        Retrieval-based conversational memory
├── prompts/         templates.ts             System prompt + context builders
├── critic/          critic.ts                Citation + evidence verification layer
├── schemas/         output.ts                Zod schemas for all I/O
├── streaming/       sse.ts                   SSE token streaming
├── evaluation/      dataset.ts               15-question golden dataset (3 tiers)
│                    runner.ts                CLI evaluation runner → CSV
├── cache/           redis_client.ts          Redis singleton
│                    cache_manager.ts         TTL cache wrapper
├── utils/           logger.ts, retry.ts,     Shared utilities
│                    llm_client.ts,
│                    token_counter.ts
├── api/
│   ├── routes/      chat.ts, eval.ts,        Express route handlers
│   │                health.ts
│   └── middleware/  rate_limiter.ts
├── config/          index.ts                 Env-validated config
└── index.ts                                  Entry point
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- Docker + Docker Compose
- OpenRouter API key → [openrouter.ai](https://openrouter.ai)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY
```

### 3. Start infrastructure

```bash
docker compose up redis chromadb -d
```

### 4. Seed the document corpus

```bash
pnpm seed
```

This indexes 25 documents into ChromaDB, including two intentionally contradictory documents about Redis memory limits (doc-012 and doc-013).

### 5. Start the server

```bash
pnpm dev          # development (hot reload)
pnpm start        # production (after pnpm build)
```

Server starts on `http://localhost:3000`.

---

## API

### `POST /chat`

Stream or non-stream conversational queries.

```bash
# Streaming (SSE)
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What does the corpus say about Redis memory limits?", "stream": true}'

# Non-streaming JSON
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the ReAct agent pattern.", "stream": false, "session_id": "550e8400-e29b-41d4-a716-446655440000"}'
```

**Request body:**
| Field | Type | Description |
|---|---|---|
| `message` | string | User's question (max 4000 chars) |
| `session_id` | UUID (optional) | Session for memory continuity |
| `stream` | boolean (default: true) | SSE streaming or JSON response |

**Response (non-stream):**
```json
{
  "session_id": "uuid",
  "output": {
    "answer": "...",
    "citations": ["doc-012", "doc-013"],
    "confidence": 0.82,
    "follow_up_questions": ["...", "..."]
  },
  "meta": {
    "iterations": 1,
    "input_tokens": 1240,
    "output_tokens": 380,
    "estimated_cost_usd": 0.0018
  }
}
```

**SSE stream events:**
```
data: {"type":"retrieval","message":"Rewriting query..."}
data: {"type":"retrieval","message":"Retrieved 10 candidate chunks..."}
data: {"type":"tool_call","tool":"calculator","input":{"expression":"2^16"}}
data: {"type":"tool_result","tool":"calculator","output":"{\"result\":\"65536\"}"}
data: {"type":"critic","message":"Critic PASSED","passed":true}
data: {"type":"token","content":"Based on the"}
data: {"type":"final","output":{...}}
data: [DONE]
```

### `POST /eval/run`

Run the evaluation suite.

```bash
curl -X POST http://localhost:3000/eval/run \
  -H "Content-Type: application/json" \
  -d '{}'

# Run only tier 1 questions
curl -X POST http://localhost:3000/eval/run \
  -H "Content-Type: application/json" \
  -d '{"tier": 1}'
```

### `GET /health`

```bash
curl http://localhost:3000/health
```

---

## CLI Evaluation Runner

Runs all 15 evaluation questions and writes results to `eval_results.csv`:

```bash
pnpm eval
```

**Evaluation tiers:**
- **Tier 1 (5 questions):** Corpus-only — target ≥4/5
- **Tier 2 (5 questions):** Requires tool use (calculator/web_search) — target ≥3/5
- **Tier 3 (5 questions):** Retrieval + tools + memory — target ≥2/5
- **Schema validity:** Target ≥85%

**CSV columns:** `question, expected_tier, pass, citation_quality, schema_valid, latency_ms, input_tokens, output_tokens, estimated_cost_usd, answer_preview, error`

---

## Docker (Full Stack)

```bash
docker compose up --build
```

Services: `app` (port 3000), `redis` (port 6379), `chromadb` (port 8000).

After startup, seed the corpus:
```bash
docker compose exec app node dist/retrieval/corpus.js seed
```

---

## Key Design Decisions

### Cost-Aware Model Routing
- **`MODEL_CHEAP`** (default: `openai/gpt-4o-mini`): query rewriting, critic checks, reranking, memory summaries
- **`MODEL_STRONG`** (default: `openai/gpt-4o`): final synthesis

Target cost per query: ≤$0.10.

### Retrieval Pipeline
```
user query → rewrite (cheap model) → embed → ChromaDB vector search (top-10)
           → LLM rerank (cheap model, top-5) → confidence score → contradiction detection
```

If confidence < `RETRIEVAL_CONFIDENCE_THRESHOLD` (default 0.45) and no results, returns explicit "I don't know" instead of hallucinating.

### Contradictions
Documents doc-012 and doc-013 contain conflicting information about Redis memory limits (512MB default vs. no fixed limit). The system detects and surfaces this contradiction explicitly.

### Critic Layer
Every response goes through a two-phase critic:
1. **Local check:** All cited document IDs must exist in retrieved chunks
2. **LLM check:** Evidence must support claims; confidence must be calibrated

On failure: citations are removed, confidence is capped at 0.5, or the answer is revised.

### Memory System
- Exchanges are embedded and stored in ChromaDB (separate collection)
- Top-3 relevant past exchanges retrieved per query
- Injected: below system prompt, above retrieved document chunks
- Stored async after response delivery

### web_search Failure Handling
20% of web_search calls return empty results (simulated). The system injects a system message forbidding fabrication and continues with corpus-only evidence.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | required | OpenRouter API key |
| `MODEL_CHEAP` | `openai/gpt-4o-mini` | Model for cheap tasks |
| `MODEL_STRONG` | `openai/gpt-4o` | Model for final synthesis |
| `MODEL_EMBED` | `openai/text-embedding-3-small` | Embedding model |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `CHROMA_URL` | `http://localhost:8000` | ChromaDB URL |
| `RETRIEVAL_CONFIDENCE_THRESHOLD` | `0.45` | Below this → "I don't know" |
| `RETRIEVAL_TOP_K` | `10` | Vector search candidates |
| `RERANK_TOP_K` | `5` | Final chunks after reranking |
| `AGENT_MAX_ITERATIONS` | `5` | Max ReAct loop iterations |
| `TOOL_OUTPUT_MAX_TOKENS` | `500` | Tool output truncation limit |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `60` | Chat rate limit (prod only) |
| `PORT` | `3000` | HTTP server port |
