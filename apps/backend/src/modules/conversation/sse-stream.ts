import type { Response } from 'express';
import type { ChatStreamEvent } from './chat.types';

/* Long silent waits (slow first token) get comment pings so proxies and browsers keep the connection */
export const SSE_HEARTBEAT_MS = 10_000;

/* Minimal server-sent events writer over an Express response; one JSON object per `data:` line */
export class SseStream {
  private readonly heartbeat: NodeJS.Timeout;

  private constructor(
    private readonly res: Response,
    heartbeatMs: number,
  ) {
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), heartbeatMs);
    res.on('close', () => clearInterval(this.heartbeat));
  }

  /* Commits 200 + event-stream headers; after this, failures must be reported as events */
  static open(res: Response, heartbeatMs = SSE_HEARTBEAT_MS): SseStream {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    /* Stops reverse proxies from buffering the stream */
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    return new SseStream(res, heartbeatMs);
  }

  send(event: ChatStreamEvent): void {
    this.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    clearInterval(this.heartbeat);
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }

  private write(chunk: string): void {
    if (!this.res.writableEnded) {
      this.res.write(chunk);
    }
  }
}
