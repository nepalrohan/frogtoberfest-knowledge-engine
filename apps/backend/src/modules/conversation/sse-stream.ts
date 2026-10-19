import type { Response } from 'express';
import type { ChatStreamEvent } from './chat.types';

/* Minimal server-sent events writer over an Express response; one JSON object per `data:` line */
export class SseStream {
  private constructor(private readonly res: Response) {}

  /* Commits 200 + event-stream headers; after this, failures must be reported as events */
  static open(res: Response): SseStream {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    /* Stops reverse proxies from buffering the stream */
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    return new SseStream(res);
  }

  send(event: ChatStreamEvent): void {
    if (!this.res.writableEnded) {
      this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  close(): void {
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }
}
