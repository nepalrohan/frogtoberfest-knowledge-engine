import { Document } from './Document.entity';
import { IngestionJob } from './IngestionJob.entity';
import { EmbeddingOutbox } from './EmbeddingOutbox.entity';
import { DocumentChunk } from './DocumentChunk.entity';

describe('Domain Entities Contract Verification (Phase 1)', () => {
  /* Verifies Document entity instantiation and default lifecycle invariants */
  it('should instantiate Document entity with proper properties and version default', () => {
    const doc = new Document();
    doc.id = '11111111-1111-1111-1111-111111111111';
    doc.sourceType = 'upload';
    doc.sourceId = 'file-abc';
    doc.title = 'Architecture Spec';
    doc.normalizedContent = '# Spec Content';
    doc.contentHash = 'abc123sha256';
    doc.version = 1;
    doc.syncStatus = 'pending_embedding';
    doc.metadata = { author: 'Alice' };

    expect(doc.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(doc.version).toBe(1);
    expect(doc.syncStatus).toBe('pending_embedding');
    expect(doc.metadata).toEqual({ author: 'Alice' });
  });

  /* Verifies IngestionJob entity structure */
  it('should instantiate IngestionJob entity with proper tracking fields', () => {
    const job = new IngestionJob();
    job.id = '22222222-2222-2222-2222-222222222222';
    job.sourceType = 'notion';
    job.triggerType = 'manual';
    job.status = 'pending';
    job.itemsDiscovered = 10;
    job.itemsProcessed = 0;
    job.itemsFailed = 0;

    expect(job.sourceType).toBe('notion');
    expect(job.status).toBe('pending');
    expect(job.itemsDiscovered).toBe(10);
  });

  /* Verifies EmbeddingOutbox event schema */
  it('should instantiate EmbeddingOutbox entity with deterministic payload structure', () => {
    const outbox = new EmbeddingOutbox();
    outbox.id = '33333333-3333-3333-3333-333333333333';
    outbox.documentId = '11111111-1111-1111-1111-111111111111';
    outbox.documentVersion = 1;
    outbox.eventType = 'DOCUMENT_READY_FOR_EMBEDDING';
    outbox.payload = {
      documentId: '11111111-1111-1111-1111-111111111111',
      documentVersion: 1,
      sourceType: 'upload',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    outbox.status = 'pending';

    expect(outbox.eventType).toBe('DOCUMENT_READY_FOR_EMBEDDING');
    expect(outbox.payload.documentVersion).toBe(1);
    expect(outbox.status).toBe('pending');
  });

  /* Verifies DocumentChunk entity schema and vector embedding representation */
  it('should instantiate DocumentChunk entity with chunk index and vector payload', () => {
    const chunk = new DocumentChunk();
    chunk.id = '44444444-4444-4444-4444-444444444444';
    chunk.documentId = '11111111-1111-1111-1111-111111111111';
    chunk.chunkIndex = 0;
    chunk.documentVersion = 1;
    chunk.content = 'First chunk content';
    chunk.embedding = '[0.123, -0.456, 0.789]';
    chunk.tokenCount = 42;

    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.embedding).toContain('0.123');
    expect(chunk.tokenCount).toBe(42);
  });
});
