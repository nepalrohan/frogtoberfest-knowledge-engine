import { Provider } from '@nestjs/common';
import { EMBEDDING_PROVIDER_TOKEN } from './embedding.interface';
import { AppConfigService } from '../../../config';
import { OllamaEmbeddingAdapter } from './adapters/ollama-embedding.adapter';
import { RemoteGpuEmbeddingAdapter } from './adapters/remote-gpu-embedding.adapter';

/* Factory provider dynamically instantiating the configured embedding provider based on AppConfigService */
export const EmbeddingProviderFactory: Provider = {
  provide: EMBEDDING_PROVIDER_TOKEN,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => {
    const providerType = config.embedding.providerType;
    if (providerType === 'remote-gpu') {
      return new RemoteGpuEmbeddingAdapter(config);
    }
    return new OllamaEmbeddingAdapter(config);
  },
};
