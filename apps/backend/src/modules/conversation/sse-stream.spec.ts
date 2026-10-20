import { EventEmitter } from 'events';
import type { Response } from 'express';
import { SseStream } from './sse-stream';

/* Just enough of an Express response to observe what the stream writes */
class FakeResponse extends EventEmitter {
  written: string[] = [];
  writableEnded = false;
  status = jest.fn();
  setHeader = jest.fn();
  flushHeaders = jest.fn();
  write(chunk: string) {
    this.written.push(chunk);
  }
  end() {
    this.writableEnded = true;
  }
}

describe('SseStream', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends comment pings while idle and stops them when closed', () => {
    const res = new FakeResponse();
    const stream = SseStream.open(res as unknown as Response, 1000);

    jest.advanceTimersByTime(2500);
    expect(res.written).toEqual([': ping\n\n', ': ping\n\n']);

    stream.send({ type: 'token', delta: 'Hi' });
    stream.close();
    jest.advanceTimersByTime(5000);
    expect(res.written).toEqual([': ping\n\n', ': ping\n\n', 'data: {"type":"token","delta":"Hi"}\n\n']);
  });

  it('stops pinging when the client disconnects', () => {
    const res = new FakeResponse();
    SseStream.open(res as unknown as Response, 1000);

    res.emit('close');
    jest.advanceTimersByTime(5000);
    expect(res.written).toEqual([]);
  });
});
