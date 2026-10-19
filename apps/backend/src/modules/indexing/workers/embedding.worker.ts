import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { Document, DocumentChunk, EMBEDDING_VECTOR_DIMENSION } from '../../../entities';
import { AppConfigService } from '../../../config';
import { EMBEDDING_QUEUE_NAME, EmbeddingJobPayload } from '../../queue/queue.constants';
import { Processor } from '../../queue/processor.decorator';
import { EMBEDDING_PROVIDER_TOKEN } from '../embedding/embedding.interface';
import type { IEmbeddingProvider } from '../embedding/embedding.interface';
import { MarkdownChunker } from '../chunker/markdown-chunker';
import { StructuredLogger } from '../../../common/logger/structured-logger';
import { LogEvents } from '../../../common/logger/log-events';
import { TraceContextPropagator } from '../../../common/telemetry/trace-context.propagator';
import { ErrorClassifier } from '../../../common/resilience/error-classifier';

/* BullMQ worker processing document chunking and atomic vector upsert */
@Processor(EMBEDDING_QUEUE_NAME)
@Injectable()
export class EmbeddingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(EmbeddingWorker.name);
  private worker?: Worker<EmbeddingJobPayload>;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EMBEDDING_PROVIDER_TOKEN)
    private readonly embeddingProvider: IEmbeddingProvider,
    private readonly chunker: MarkdownChunker,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit() {
    /* Initialize BullMQ worker connected to Redis */
    const redis = this.config.redis;
    this.worker = new Worker<EmbeddingJobPayload>(
      EMBEDDING_QUEUE_NAME,
      async (job: Job<EmbeddingJobPayload>) => {
        await this.process(job);
      },
      {
        connection: {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          maxRetriesPerRequest: null,
        },
        concurrency: 2,
      },
    );

    this.worker.on('failed', (job, err) => {
      const category = ErrorClassifier.classify(err);
      this.logger.error(
        `Embedding job ${job?.id} failed: ${err?.message}`,
        err?.stack,
        {
          event: LogEvents.INDEXING_FAILED,
          jobId: job?.id,
          documentId: job?.data.documentId,
          version: job?.data.documentVersion,
          errorType: category,
        },
      );
    });

    this.logger.log('EmbeddingWorker initialized and listening for jobs');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  /* Processes a single embedding job with stale check and atomic vector upsert */
  async process(job: Job<EmbeddingJobPayload>): Promise<void> {
    const { documentId, documentVersion, traceCarrier } = job.data;

    /* 1. Extract W3C trace context */
    if (traceCarrier) {
      TraceContextPropagator.extractFromCarrier(traceCarrier);
    }

    this.logger.log('Starting document embedding and indexing workflow', {
      event: LogEvents.INDEXING_STARTED,
      documentId,
      version: documentVersion,
      jobId: job.id,
    });

    try {
      /* 2. Fetch current document from database */
      const docRepo = this.dataSource.getRepository(Document);
      const currentDoc = await docRepo.findOne({ where: { id: documentId } });

      if (!currentDoc) {
        this.logger.warn(`Document ${documentId} no longer exists; skipping embedding job`, {
          event: LogEvents.JOB_STALE_SKIPPED,
          documentId,
          version: documentVersion,
        });
        return;
      }

      /* 3. STALE JOB GUARD: Abort if newer version already exists in database */
      if (currentDoc.version > documentVersion) {
        this.logger.warn('Aborting stale embedding job; newer version already exists in database', {
          event: LogEvents.JOB_STALE_SKIPPED,
          documentId,
          jobVersion: documentVersion,
          currentVersion: currentDoc.version,
        });
        return;
      }

      /* 4. Chunk normalized markdown content */
      const chunks = this.chunker.chunk(currentDoc.normalizedContent);
      if (chunks.length === 0) {
        this.logger.warn('Document produced zero chunks; skipping embedding vector generation', {
          documentId,
          version: documentVersion,
        });
        return;
      }

      /* 5. Generate vector embeddings via configured provider */
      const chunkTexts = chunks.map((c) => c.content);
      const vectors = await this.embeddingProvider.embed(chunkTexts, 'document');
      const embeddingModel = this.embeddingProvider.getModelName();

      /* A wrong vector count or width is a configuration fault; retrying cannot fix it */
      const malformed =
        vectors.length !== chunks.length ||
        vectors.some((v) => v?.length !== EMBEDDING_VECTOR_DIMENSION);
      if (malformed) {
        throw new UnrecoverableError(
          `Embedding model ${embeddingModel} returned ${vectors.length} vectors of width ${vectors[0]?.length} ` +
            `for ${chunks.length} chunks; document_chunk.embedding expects width ${EMBEDDING_VECTOR_DIMENSION}`,
        );
      }

      /* 6. Atomic Replace in a Single TypeORM Transaction */
      await this.dataSource.transaction(async (manager) => {
        /* Pessimistic lock on document row to guard against concurrent writes */
        const lockedDoc = await manager
          .createQueryBuilder(Document, 'doc')
          .setLock('pessimistic_write')
          .where('doc.id = :id', { id: documentId })
          .getOne();

        if (!lockedDoc || lockedDoc.version > documentVersion) {
          this.logger.warn('Version conflict detected during atomic chunk upsert; aborting', {
            event: LogEvents.JOB_STALE_SKIPPED,
            documentId,
            jobVersion: documentVersion,
            currentVersion: lockedDoc?.version,
          });
          return;
        }

        const chunkRepo = manager.getRepository(DocumentChunk);

        /* Delete existing chunks for this document */
        await chunkRepo.delete({ documentId });

        /* Bulk insert new chunks; TypeORM serializes number[] into the pgvector column */
        const chunkEntities = chunks.map((chunk, idx) => {
          return chunkRepo.create({
            documentId,
            chunkIndex: idx,
            documentVersion,
            content: chunk.content,
            embedding: vectors[idx],
            embeddingModel,
            tokenCount: chunk.tokenCount,
            metadata: chunk.metadata as Record<string, unknown>,
          });
        });

        await chunkRepo.save(chunkEntities);

        /* Update document syncStatus to indexed */
        lockedDoc.syncStatus = 'indexed';
        await manager.save(lockedDoc);
      });

      this.logger.log('Document chunking and vector indexing completed successfully', {
        event: LogEvents.INDEXING_COMPLETED,
        documentId,
        version: documentVersion,
        totalChunks: chunks.length,
      });
    } catch (err: any) {
      const category = ErrorClassifier.classify(err);
      this.logger.error(
        `Failed to process embedding job for document ${documentId}: ${err?.message}`,
        err?.stack,
        {
          event: LogEvents.INDEXING_FAILED,
          documentId,
          version: documentVersion,
          errorType: category,
        },
      );
      throw err;
    }
  }
}
