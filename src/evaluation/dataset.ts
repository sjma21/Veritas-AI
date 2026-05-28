export interface EvalQuestion {
  id: string;
  question: string;
  tier: 1 | 2 | 3;
  expectedCitationIds: string[];
  passCriteria: string;
  requiresTool?: string;
}

export const EVAL_DATASET: EvalQuestion[] = [
  // ── Tier 1: Corpus-only questions ─────────────────────────────────────────
  {
    id: "t1-001",
    tier: 1,
    question: "What is ChromaDB and why is it suitable for RAG systems?",
    expectedCitationIds: ["doc-001"],
    passCriteria: "Mentions vector embeddings, ANN search, cosine similarity, and self-hosting",
  },
  {
    id: "t1-002",
    tier: 1,
    question: "Explain the ReAct agent pattern and its iteration limit.",
    expectedCitationIds: ["doc-004"],
    passCriteria: "Mentions Reason+Act, Thought/Action/Observation loop, and iteration limit",
  },
  {
    id: "t1-003",
    tier: 1,
    question: "How does cross-encoder reranking improve retrieval precision?",
    expectedCitationIds: ["doc-007"],
    passCriteria: "Mentions joint query-document scoring, bi-encoder → cross-encoder pipeline",
  },
  {
    id: "t1-004",
    tier: 1,
    question: "What are the Redis memory limits according to the documents?",
    expectedCitationIds: ["doc-012", "doc-013"],
    passCriteria: "MUST surface the contradiction between doc-012 (512MB default) and doc-013 (no fixed limit)",
  },
  {
    id: "t1-005",
    tier: 1,
    question: "How should conversational memory be injected into the prompt context?",
    expectedCitationIds: ["doc-010"],
    passCriteria: "Mentions injection order: below system prompt, above retrieved chunks",
  },

  // ── Tier 2: Tool-usage questions ─────────────────────────────────────────
  {
    id: "t2-001",
    tier: 2,
    question: "What is 2 to the power of 16, and how does token budgeting relate to that number?",
    expectedCitationIds: ["doc-015"],
    passCriteria: "Uses calculator tool for 2^16=65536, relates to token context windows",
    requiresTool: "calculator",
  },
  {
    id: "t2-002",
    tier: 2,
    question: "Search for recent information about OpenRouter and summarise what you find.",
    expectedCitationIds: [],
    passCriteria: "Uses web_search, handles empty results gracefully without fabricating, or returns real results",
    requiresTool: "web_search",
  },
  {
    id: "t2-003",
    tier: 2,
    question: "Calculate the estimated cost of 1 million tokens with GPT-4o-mini and compare it to GPT-4o.",
    expectedCitationIds: ["doc-003"],
    passCriteria: "Uses calculator, references pricing, produces numeric comparison",
    requiresTool: "calculator",
  },
  {
    id: "t2-004",
    tier: 2,
    question: "Search for information about Zod validation and summarise key points from the results.",
    expectedCitationIds: ["doc-009"],
    passCriteria: "Uses web_search tool and/or summarise_doc, combines with corpus knowledge",
    requiresTool: "web_search",
  },
  {
    id: "t2-005",
    tier: 2,
    question: "If a Redis instance has 4 GB of RAM and we follow the 75% memory rule, what is the maxmemory setting in MB?",
    expectedCitationIds: ["doc-013"],
    passCriteria: "Uses calculator: 4096 * 0.75 = 3072 MB, cites doc-013 for the 75% rule",
    requiresTool: "calculator",
  },

  // ── Tier 3: Retrieval + tools + memory ────────────────────────────────────
  {
    id: "t3-001",
    tier: 3,
    question: "Given what you know about RAG and retrieval pipelines, search for any new developments and synthesise a complete architecture recommendation.",
    expectedCitationIds: ["doc-005", "doc-007", "doc-023"],
    passCriteria: "Uses both corpus (RAG docs) and web search, synthesises coherent recommendation",
    requiresTool: "web_search",
  },
  {
    id: "t3-002",
    tier: 3,
    question: "How does the token budgeting system work, and if I have a context window of 128k tokens with 20% reserved for generation, how many tokens are available for context?",
    expectedCitationIds: ["doc-015"],
    passCriteria: "Uses calculator (128000 * 0.8 = 102400), references token budgeting doc",
    requiresTool: "calculator",
  },
  {
    id: "t3-003",
    tier: 3,
    question: "What does the corpus say about evaluation frameworks, and are there any contradictions between documents about performance targets?",
    expectedCitationIds: ["doc-021"],
    passCriteria: "Finds evaluation doc, checks for contradictions, produces structured answer",
  },
  {
    id: "t3-004",
    tier: 3,
    question: "Combining the Redis caching docs and the session management doc, design a session storage strategy for an AI agent with 10,000 concurrent users. Use the calculator to estimate memory needs.",
    expectedCitationIds: ["doc-002", "doc-012", "doc-013", "doc-025"],
    passCriteria: "Surfaces Redis contradiction, uses calculator, references session management, provides concrete recommendation",
    requiresTool: "calculator",
  },
  {
    id: "t3-005",
    tier: 3,
    question: "What is the best embedding model to use according to the documents, and search for any newer models released since the documentation was written?",
    expectedCitationIds: ["doc-006"],
    passCriteria: "Cites embedding model doc, uses web search, combines findings coherently",
    requiresTool: "web_search",
  },
];
