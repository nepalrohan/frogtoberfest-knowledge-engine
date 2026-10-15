import { Injectable } from '@nestjs/common';
import { IEmbeddingProvider } from '../embedding.interface';
import { AppConfigService } from '../../../../config';
import { StructuredLogger } from '../../../../common/logger/structured-logger';
import { ErrorClassifier } from '../../../../common/resilience/error-classifier';

/* Local Ollama embedding provider adapter with batching support */
@Injectable()
export class OllamaEmbeddingAdapter implements IEmbeddingProvider {
  private readonly logger = new StructuredLogger(OllamaEmbeddingAdapter.name);
  private readonly batchSize = 16;

  constructor(private readonly config: AppConfigService) {}

  getProviderName(): string {
    return 'ollama';
  }

  getDimension(): number {
    return this.config.embedding.dimension;
  }

  /* Generates embeddings for input texts in batches using local Ollama service */
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const { ollamaUrl, model } = this.config.embedding;
    const allEmbeddings: number[][] = [];

    /* Process texts in batches to prevent payload size limits and memory pressure */
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      try {
        const batchEmbeddings = await this.embedBatchWithOllama(ollamaUrl, model, batch);
        allEmbeddings.push(...batchEmbeddings);
      } catch (err: any) {
        const category = ErrorClassifier.classify(err);
        this.logger.error(
          `Ollama embedding request failed for batch of ${batch.length} texts: ${err?.message}`,
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

  /* Sends embedding request to Ollama endpoint */
  private async embedBatchWithOllama(
    ollamaUrl: string,
    model: string,
    batch: string[],
  ): Promise<number[][]> {
    const endpoint = `${ollamaUrl.replace(/\/$/, '')}/api/embed`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!res.ok) {
      /* Fallback for older Ollama versions supporting single-item /api/embeddings */
      if (res.status === 404) {
        return await this.fallbackSingleEmbeddings(ollamaUrl, model, batch);
      }
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama embedding error [${res.status}]: ${errText || res.statusText}`);
    }

    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error(`Malformed response from Ollama embedding API: missing embeddings array`);
    }

    return data.embeddings;
  }

  /* Fallback implementation calling /api/embeddings for legacy Ollama versions */
  private async fallbackSingleEmbeddings(
    ollamaUrl: string,
    model: string,
    batch: string[],
  ): Promise<number[][]> {
    const singleEndpoint = `${ollamaUrl.replace(/\/$/, '')}/api/embeddings`;
    const results: number[][] = [];

    for (const prompt of batch) {
      const res = await fetch(singleEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama legacy embedding error [${res.status}]: ${errText || res.statusText}`);
      }

      const data = (await res.json()) as { embedding?: number[] };
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error(`Malformed response from Ollama legacy embedding API`);
      }
      results.push(data.embedding);
    }

    return results;
  }
}
