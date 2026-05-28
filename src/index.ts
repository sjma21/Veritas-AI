import { createServer } from "./api/server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const { start, stop } = await createServer();
  await start();

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received — shutting down");
    await stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received — shutting down");
    await stop();
    process.exit(0);
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — crashing");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
