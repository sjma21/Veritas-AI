import type { Response } from "express";
import type { StreamEvent } from "../schemas/output.js";

export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function sendSSEEvent(res: Response, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof (res as any).flush === "function") (res as any).flush();
}

export function sendSSEDone(res: Response): void {
  res.write("data: [DONE]\n\n");
  res.end();
}

export function createSSEEmitter(res: Response): (event: StreamEvent) => void {
  return (event: StreamEvent) => sendSSEEvent(res, event);
}
