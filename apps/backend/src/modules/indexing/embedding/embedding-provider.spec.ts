import { OllamaEmbeddingAdapter } from './adapters/ollama-embedding.adapter';
import { RemoteGpuEmbeddingAdapter } from './adapters/remote-gpu-embedding.adapter';
import { EmbeddingProviderFactory } from './embedding-provider.factory';
import { AppConfigService } from '../../../config';

describe('EmbeddingProvider Adapters & Factory (Phase 5)', () => {
  let mockConfigService: any;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockConfigService = {
      embedding: {
        providerType: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        remoteGpuUrl: 'http://localhost:8000',
        remoteGpuApiKey: 'test-api-key',
        model: 'nomic-embed-text',
        dimension: 768,
      },
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('OllamaEmbeddingAdapter', () => {
    it('should return empty array when texts array is empty', async () => {
      const adapter = new OllamaEmbeddingAdapter(mockConfigService as AppConfigService);
      const result = await adapter.embed([]);
      expect(result).toEqual([]);
      expect(adapter.getProviderName()).toBe('ollama');
      expect(adapter.getDimension()).toBe(768);
    });

    it('should generate embeddings via /api/embed endpoint', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: mockEmbeddings }),
      } as any);

      const adapter = new OllamaEmbeddingAdapter(mockConfigService as AppConfigService);
      const result = await adapter.embed(['chunk 1', 'chunk 2']);

      expect(result).toEqual(mockEmbeddings);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embed',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'nomic-embed-text', input: ['chunk 1', 'chunk 2'] }),
        }),
      );
    });

    it('should fallback to legacy /api/embeddings when /api/embed returns 404', async () => {
      const mockVector = [0.7, 0.8, 0.9];
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: mockVector }),
        } as any);

      const adapter = new OllamaEmbeddingAdapter(mockConfigService as AppConfigService);
      const result = await adapter.embed(['chunk legacy']);

      expect(result).toEqual([mockVector]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:11434/api/embeddings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'chunk legacy' }),
        }),
      );
    });

    it('should throw error when Ollama responds with server error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Model failed to load',
      } as any);

      const adapter = new OllamaEmbeddingAdapter(mockConfigService as AppConfigService);
      await expect(adapter.embed(['error test'])).rejects.toThrow('Ollama embedding error [500]');
    });
  });

  describe('RemoteGpuEmbeddingAdapter', () => {
    it('should generate embeddings via /v1/embeddings with bearer token', async () => {
      const mockVectors = [
        { index: 0, embedding: [0.01, 0.02] },
        { index: 1, embedding: [0.03, 0.04] },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockVectors }),
      } as any);

      const adapter = new RemoteGpuEmbeddingAdapter(mockConfigService as AppConfigService);
      const result = await adapter.embed(['remote text 1', 'remote text 2']);

      expect(result).toEqual([
        [0.01, 0.02],
        [0.03, 0.04],
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should throw error when Remote GPU fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API Key',
      } as any);

      const adapter = new RemoteGpuEmbeddingAdapter(mockConfigService as AppConfigService);
      await expect(adapter.embed(['test'])).rejects.toThrow('Remote GPU embedding error [401]');
    });
  });

  describe('EmbeddingProviderFactory', () => {
    it('should return OllamaEmbeddingAdapter when providerType is ollama', () => {
      mockConfigService.embedding.providerType = 'ollama';
      const provider = (EmbeddingProviderFactory as any).useFactory(mockConfigService);
      expect(provider).toBeInstanceOf(OllamaEmbeddingAdapter);
      expect(provider.getProviderName()).toBe('ollama');
    });

    it('should return RemoteGpuEmbeddingAdapter when providerType is remote-gpu', () => {
      mockConfigService.embedding.providerType = 'remote-gpu';
      const provider = (EmbeddingProviderFactory as any).useFactory(mockConfigService);
      expect(provider).toBeInstanceOf(RemoteGpuEmbeddingAdapter);
      expect(provider.getProviderName()).toBe('remote-gpu');
    });
  });
});
