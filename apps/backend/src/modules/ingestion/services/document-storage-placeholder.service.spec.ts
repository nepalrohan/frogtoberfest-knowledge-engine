import { DocumentStoragePlaceholderService } from './document-storage-placeholder.service';
import { NormalizedDocumentPayload } from '../types';

describe('DocumentStoragePlaceholderService', () => {
  let service: DocumentStoragePlaceholderService;

  beforeEach(() => {
    service = new DocumentStoragePlaceholderService();
  });

  const createMockPayload = (
    overrides?: Partial<NormalizedDocumentPayload>,
  ): NormalizedDocumentPayload => ({
    sourceType: 'notion',
    sourceId: 'page-123',
    sourceUrl: 'https://notion.so/page-123',
    title: 'Architecture Overview',
    normalizedContent: '# Architecture\nDetails here.',
    contentHash: 'hash-abc',
    sourceUpdatedAt: new Date('2026-10-25T12:00:00.000Z'),
    metadata: {
      parentHierarchy: [],
    },
    ...overrides,
  });

  /* Verifies first save creates version 1 and reports isNewVersion true */
  it('should save initial document with version 1', async () => {
    const payload = createMockPayload();

    const result = await service.saveDocument(payload);

    expect(result).toEqual({
      documentId: 'doc-page-123',
      version: 1,
      isNewVersion: true,
    });

    const stored = service.getDocument('notion', 'page-123');
    expect(stored).toBeDefined();
    expect(stored?.version).toBe(1);
    expect(stored?.payload.title).toBe('Architecture Overview');
  });

  /* Verifies subsequent save on same resource increments version and marks isNewVersion false */
  it('should increment version on subsequent updates to existing document', async () => {
    const payload1 = createMockPayload({
      title: 'Initial Title',
      normalizedContent: '# Initial',
      contentHash: 'hash-v1',
    });

    const payload2 = createMockPayload({
      title: 'Updated Title',
      normalizedContent: '# Updated',
      contentHash: 'hash-v2',
    });

    const firstResult = await service.saveDocument(payload1);
    expect(firstResult.version).toBe(1);
    expect(firstResult.isNewVersion).toBe(true);

    const secondResult = await service.saveDocument(payload2);
    expect(secondResult.version).toBe(2);
    expect(secondResult.isNewVersion).toBe(false);

    const stored = service.getDocument('notion', 'page-123');
    expect(stored?.version).toBe(2);
    expect(stored?.payload.title).toBe('Updated Title');
  });

  /* Verifies clear method flushes stored documents */
  it('should clear stored documents', async () => {
    await service.saveDocument(
      createMockPayload({
        sourceId: 'page-999',
        title: 'Temporary',
        normalizedContent: 'temp',
        contentHash: 'hash-temp',
      }),
    );

    expect(service.getDocument('notion', 'page-999')).toBeDefined();
    service.clear();
    expect(service.getDocument('notion', 'page-999')).toBeUndefined();
  });
});
