import * as readline from "readline";
import { v4 as uuidv4 } from "uuid";

// ── ANSI colour helpers ───────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

const paint = (color: string, text: string) => `${color}${text}${c.reset}`;

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

// ── Parse SSE stream from fetch response ─────────────────────────────────────
async function* readSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        try {
          yield JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
}

// ── Render a single stream event to stdout ────────────────────────────────────
function renderEvent(event: Record<string, unknown>, inTokenStream: boolean): boolean {
  switch (event.type as string) {
    case "cache_hit": {
      const pct = ((event.similarity as number) * 100).toFixed(1);
      process.stdout.write(
        `\n  ${paint(c.bold + c.magenta, "⚡ Semantic cache hit")}  ${paint(c.dim, `(${pct}% match — full pipeline skipped)`)}\n\n`
      );
      return false;
    }

    case "retrieval":
      process.stdout.write(paint(c.dim, `  ↳ ${event.message}\n`));
      return false;

    case "tool_call": {
      const input = JSON.stringify(event.input ?? {});
      process.stdout.write(
        `\n  ${paint(c.yellow, "⚙")}  ${paint(c.bold + c.yellow, `[tool] ${event.tool}`)}  ${paint(c.dim, input)}\n`
      );
      return false;
    }

    case "tool_result": {
      const out = (event.output as string).slice(0, 120);
      const truncated = (event.output as string).length > 120 ? "…" : "";
      process.stdout.write(paint(c.dim, `     └─ result: ${out}${truncated}\n`));
      return false;
    }

    case "critic": {
      const icon = (event.passed as boolean) ? paint(c.green, "✔") : paint(c.yellow, "⚠");
      process.stdout.write(`\n  ${icon}  ${paint(c.dim, `[critic] ${event.message}`)}\n\n`);
      return false;
    }

    case "token":
      if (!inTokenStream) {
        process.stdout.write(paint(c.bold + c.white, "  VeritasAI: "));
      }
      process.stdout.write(event.content as string);
      return true;

    case "final": {
      const output = event.output as {
        citations: string[];
        confidence: number;
        follow_up_questions: string[];
      };

      process.stdout.write("\n");

      if (output.citations?.length) {
        process.stdout.write(paint(c.dim, `\n  Sources: ${output.citations.join(", ")}\n`));
      }

      const conf = output.confidence ?? 0;
      const filled = Math.round(conf * 10);
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const confColor = conf >= 0.7 ? c.green : conf >= 0.4 ? c.yellow : c.red;
      process.stdout.write(
        paint(c.dim, "  Confidence: ") + paint(confColor, `${bar} ${(conf * 100).toFixed(0)}%`) + "\n"
      );

      if (output.follow_up_questions?.length) {
        process.stdout.write(paint(c.dim, "\n  Suggested follow-ups:\n"));
        output.follow_up_questions.forEach((q, i) => {
          process.stdout.write(paint(c.dim, `    ${i + 1}. ${q}\n`));
        });
      }

      return false;
    }

    case "error":
      process.stdout.write(`\n${paint(c.red, `  ✖  ${event.message}`)}\n`);
      return false;

    default:
      return inTokenStream;
  }
}

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner(): void {
  console.log();
  console.log(paint(c.bold + c.cyan, "  ╔══════════════════════════════════╗"));
  console.log(paint(c.bold + c.cyan, "  ║         V E R I T A S  A I       ║"));
  console.log(paint(c.bold + c.cyan, "  ╚══════════════════════════════════╝"));
  console.log(paint(c.dim, `  Server: ${SERVER_URL}`));
  console.log(paint(c.dim, "  Commands: /exit  /session  /clear\n"));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Verify server is reachable
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(
      paint(c.red, `\n  ✖  Cannot reach server at ${SERVER_URL}`) +
      paint(c.dim, "\n     Run the server first:  npm run dev\n")
    );
    process.exit(1);
  }

  printBanner();

  const sessionId = uuidv4();
  console.log(paint(c.dim, `  Session: ${sessionId}\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: paint(c.bold + c.blue, "  You: "),
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === "/exit" || input === "/quit") {
      console.log(paint(c.dim, "\n  Goodbye.\n"));
      process.exit(0);
    }
    if (input === "/session") {
      console.log(paint(c.dim, `  Session ID: ${sessionId}\n`));
      rl.prompt();
      return;
    }
    if (input === "/clear") {
      process.stdout.write("\x1b[2J\x1b[H");
      printBanner();
      rl.prompt();
      return;
    }

    console.log();

    try {
      const response = await fetch(`${SERVER_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, session_id: sessionId, stream: true }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.log(paint(c.red, `  ✖  Server error ${response.status}: ${text}\n`));
        rl.prompt();
        return;
      }

      let inTokenStream = false;
      for await (const event of readSSE(response)) {
        inTokenStream = renderEvent(event, inTokenStream);
      }
      console.log();
    } catch (err) {
      console.log(paint(c.red, `  ✖  ${err instanceof Error ? err.message : "Unknown error"}\n`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(paint(c.dim, "\n  Session ended.\n"));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
