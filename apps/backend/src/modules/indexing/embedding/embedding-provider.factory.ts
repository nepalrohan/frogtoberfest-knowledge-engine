import { Provider } from '@nestjs/common';
import { EMBEDDING_PROVIDER_TOKEN } from './embedding.interface';
import { AppConfigService } from '../../../config';
import { EMBEDDING_VECTOR_DIMENSION } from '../../../entities';
import { OllamaEmbeddingAdapter } from './adapters/ollama-embedding.adapter';
import { RemoteGpuEmbeddingAdapter } from './adapters/remote-gpu-embedding.adapter';

/* Factory provider dynamically instantiating the configured embedding provider based on AppConfigService */
export const EmbeddingProviderFactory: Provider = {
  provide: EMBEDDING_PROVIDER_TOKEN,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => {
    /* Fail at boot rather than on the first job when the model cannot fit the vector column */
    if (config.embedding.dimension !== EMBEDDING_VECTOR_DIMENSION) {
      throw new Error(
        `EMBEDDING_DIMENSION=${config.embedding.dimension} does not match document_chunk.embedding ` +
          `vector(${EMBEDDING_VECTOR_DIMENSION}); add a migration before switching embedding models`,
      );
    }
    const providerType = config.embedding.providerType;
    if (providerType === 'remote-gpu') {
      return new RemoteGpuEmbeddingAdapter(config);
    }
    return new OllamaEmbeddingAdapter(config);
  },
};
