import { Injectable } from '@nestjs/common';
import { IEmbeddingProvider } from '../embedding.interface';
import { AppConfigService } from '../../../../config';
import { StructuredLogger } from '../../../../common/logger/structured-logger';
import { ErrorClassifier } from '../../../../common/resilience/error-classifier';

/* Remote GPU / OpenAI / vLLM embedding provider adapter with batching support */
@Injectable()
export class RemoteGpuEmbeddingAdapter implements IEmbeddingProvider {
  private readonly logger = new StructuredLogger(RemoteGpuEmbeddingAdapter.name);
  private readonly batchSize = 32;

  constructor(private readonly config: AppConfigService) {}

  getProviderName(): string {
    return 'remote-gpu';
  }

  getDimension(): number {
    return this.config.embedding.dimension;
  }

  /* Generates embeddings for input texts using remote OpenAI-compatible embedding API */
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const { remoteGpuUrl, remoteGpuApiKey, model } = this.config.embedding;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      try {
        const batchEmbeddings = await this.embedBatchRemote(
          remoteGpuUrl,
          remoteGpuApiKey,
          model,
          batch,
        );
        allEmbeddings.push(...batchEmbeddings);
      } catch (err: any) {
        const category = ErrorClassifier.classify(err);
        this.logger.error(
          `Remote GPU embedding request failed for batch of ${batch.length} texts: ${err?.message}`,
          err?.stack,
          {
            errorType: category,
            model,
            batchSize: batch.length,
          },
        );
        throw err;
      }
    }

    return allEmbeddings;
  }

  /* Executes remote POST request to OpenAI-compatible /v1/embeddings endpoint */
  private async embedBatchRemote(
    baseUrl: string,
    apiKey: string | undefined,
    model: string,
    batch: string[],
  ): Promise<number[][]> {
    const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: batch }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Remote GPU embedding error [${res.status}]: ${errText || res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { embedding: number[]; index?: number }[];
    };

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(`Malformed response from Remote GPU embedding API: missing data array`);
    }

    /* Sort by index to maintain original order if returned out of order */
    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => d.embedding);
  }
}
