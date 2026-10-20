import type { AppConfigService } from '../../../config';
import { TeiRerankerClient } from './tei-reranker.client';

describe('TeiRerankerClient', () => {
  const client = (url: string) =>
    new TeiRerankerClient({
      reranker: { url, timeoutMs: 1000 },
    } as unknown as AppConfigService);

  afterEach(() => jest.restoreAllMocks());

  it('is disabled when no URL is configured', () => {
    expect(client('').enabled).toBe(false);
    expect(client('http://reranker:80').enabled).toBe(true);
  });

  it('posts the query and passages and returns scores in input order', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { index: 1, score: 0.9 },
          { index: 0, score: 0.2 },
        ]),
      ),
    );

    const scores = await client('http://reranker:80/').rerank('roll back?', ['a', 'b'], {});

    expect(scores).toEqual([0.2, 0.9]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://reranker:80/rerank');
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'roll back?',
      texts: ['a', 'b'],
      truncate: true,
    });
  });

  it('rejects on a non-OK response so the caller can fall back', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    await expect(client('http://reranker').rerank('q', ['a'], {})).rejects.toThrow('503');
  });
});
