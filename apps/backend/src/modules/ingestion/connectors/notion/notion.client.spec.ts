import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from '../../../../config/configuration';
import pageSample from '../../../../../test/fixtures/notion/page-sample.json';
import blocksPage1 from '../../../../../test/fixtures/notion/blocks-page-1.json';
import { NotionClient } from './notion.client';

describe('NotionClient', () => {
  let client: NotionClient;
  let mockFetch: jest.Mock;

  const mockConfigService = {
    notion: {
      apiKey: 'test-notion-key',
      apiVersion: '2022-06-28',
      baseUrl: 'https://api.notion.com/v1',
      maxDepth: 5,
      maxRequests: 50,
    },
  };

  beforeEach(async () => {
    mockFetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionClient,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    client = module.get<NotionClient>(NotionClient);
    /* Inject mocked fetch function into client for offline testing */
    (client as any).fetchFn = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should send correct authentication and version headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => pageSample,
    });

    const result = await client.getPage('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/pages/96d741cb-6d65-4f76-bc3c-396599b519cf');
    expect(options.headers).toEqual({
      Authorization: 'Bearer test-notion-key',
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    });
    expect(result.id).toBe('96d741cb-6d65-4f76-bc3c-396599b519cf');
  });

  it('should fetch block children with pagination query parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => blocksPage1,
    });

    const result = await client.getBlockChildren('block-parent-id', 'cursor-123', 50);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('https://api.notion.com/v1/blocks/block-parent-id/children?');
    expect(url).toContain('start_cursor=cursor-123');
    expect(url).toContain('page_size=50');
    expect(result.results).toHaveLength(7);
    expect(result.has_more).toBe(true);
  });

  it('should retry on transient HTTP 429 response and succeed on subsequent attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': '1' }),
        json: async () => ({
          object: 'error',
          status: 429,
          code: 'rate_limited',
          message: 'You have been rate limited.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => pageSample,
      });

    /* Use fast sleep function to accelerate test */
    (client as any).retryPolicy = new (client as any).retryPolicy.constructor({
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 10,
      backoffFactor: 2,
      sleepFn: async () => { },
    });

    const result = await client.getPage('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('96d741cb-6d65-4f76-bc3c-396599b519cf');
  });

  it('should fast-fail on permanent HTTP 401/403 errors without retrying', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid API token' }),
    });

    await expect(client.getPage('page-id')).rejects.toThrow();
    /* Should only be called once, not retried */
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should trip circuit breaker after consecutive failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ message: 'Outage' }),
    });

    /* Reconfigure client with low failure threshold for test */
    (client as any).circuitBreaker = new (client as any).circuitBreaker.constructor({
      failureThreshold: 2,
      resetTimeoutMs: 10000,
      name: 'NotionClientTest',
    });
    (client as any).retryPolicy = new (client as any).retryPolicy.constructor({
      maxAttempts: 1,
      sleepFn: async () => { },
    });

    /* First failure */
    await expect(client.getPage('page-1')).rejects.toThrow();
    /* Second failure */
    await expect(client.getPage('page-2')).rejects.toThrow();

    /* Third call should fail fast from open circuit without calling fetch */
    await expect(client.getPage('page-3')).rejects.toThrow(/Circuit breaker/i);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
