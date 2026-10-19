import { Injectable } from '@nestjs/common';
import { ConfigService, registerAs } from '@nestjs/config';

export interface AppConfiguration {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  webUrl: string;
  appVersion: string;
  otel: {
    serviceName: string;
    serviceVersion: string;
    exporterEndpoint: string;
    samplingRatio: number;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    synchronize: boolean;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  embedding: {
    providerType: 'ollama' | 'remote-gpu';
    ollamaUrl: string;
    remoteGpuUrl: string;
    remoteGpuApiKey?: string;
    model: string;
    dimension: number;
  };
  notion: {
    apiKey: string;
    apiVersion: string;
    baseUrl: string;
    maxDepth: number;
    maxRequests: number;
  };
  llm: {
    baseUrl: string;
    chatModel: string;
    temperature: number;
    numCtx: number;
    idleTimeoutMs: number;
    rewriteTimeoutMs: number;
    /* Context window share kept free for the answer itself */
    answerReserveTokens: number;
    /* How long Ollama keeps the chat model loaded between questions, e.g. "30m" */
    keepAlive: string;
  };
  retrieval: {
    minSimilarity: number;
    /* Share of the question's terms a chunk must contain to pass the gate on keywords alone */
    minKeywordCoverage: number;
    candidateK: number;
    maxSources: number;
    maxSourcesPerDocument: number;
    contextTokenBudget: number;
  };
  reranker: {
    /* Text Embeddings Inference base URL; empty disables reranking */
    url: string;
    timeoutMs: number;
  };
  chat: {
    /* Reuse of an identical standalone question's answer; 0 disables */
    answerCacheTtlSeconds: number;
  };
}

/* Loads raw environment configurations with fallbacks */
export const loadConfiguration = (): AppConfiguration => ({
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  webUrl: process.env.WEB_URL || 'http://localhost:3000',
  appVersion: process.env.APP_VERSION || '1.0.0',
  otel: {
    serviceName: process.env.OTEL_ATTR_SERVICE_NAME || 'Knowledge_Engine',
    serviceVersion: process.env.OTEL_ATTR_SERVICE_VERSION || '1.0',
    exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    samplingRatio: parseFloat(process.env.OTEL_SAMPLING_RATIO || '1.0'),
  },
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgrespassword',
    database: process.env.DATABASE_NAME || 'frogtoberfest',
    ssl: process.env.DATABASE_SSL === 'true',
    /* Schema comes from migrations; synchronize is an explicit opt-in for throwaway databases */
    synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  embedding: {
    providerType: (process.env.EMBEDDING_PROVIDER as 'ollama' | 'remote-gpu') || 'ollama',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    remoteGpuUrl: process.env.REMOTE_GPU_URL || 'http://localhost:8000',
    remoteGpuApiKey: process.env.REMOTE_GPU_API_KEY || undefined,
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    apiVersion: process.env.NOTION_API_VERSION || '2022-06-28',
    baseUrl: process.env.NOTION_BASE_URL || 'https://api.notion.com/v1',
    maxDepth: parseInt(process.env.NOTION_MAX_DEPTH || '5', 10),
    maxRequests: parseInt(process.env.NOTION_MAX_REQUESTS || '50', 10),
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
    chatModel: process.env.GENERATION_MODEL || 'qwen2.5:7b-instruct',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.1'),
    numCtx: parseInt(process.env.LLM_NUM_CTX || '8192', 10),
    idleTimeoutMs: parseInt(process.env.LLM_IDLE_TIMEOUT_MS || '30000', 10),
    rewriteTimeoutMs: parseInt(process.env.LLM_REWRITE_TIMEOUT_MS || '8000', 10),
    answerReserveTokens: parseInt(process.env.LLM_ANSWER_RESERVE_TOKENS || '768', 10),
    keepAlive: process.env.LLM_KEEP_ALIVE || '30m',
  },
  retrieval: {
    minSimilarity: parseFloat(process.env.RETRIEVAL_MIN_SIMILARITY || '0.65'),
    minKeywordCoverage: parseFloat(process.env.RETRIEVAL_MIN_KEYWORD_COVERAGE || '0.8'),
    candidateK: parseInt(process.env.RETRIEVAL_CANDIDATE_K || '20', 10),
    maxSources: parseInt(process.env.RETRIEVAL_MAX_SOURCES || '5', 10),
    maxSourcesPerDocument: parseInt(process.env.RETRIEVAL_MAX_SOURCES_PER_DOCUMENT || '2', 10),
    contextTokenBudget: parseInt(process.env.RETRIEVAL_CONTEXT_TOKEN_BUDGET || '2500', 10),
  },
  reranker: {
    url: process.env.RERANKER_URL || '',
    timeoutMs: parseInt(process.env.RERANKER_TIMEOUT_MS || '10000', 10),
  },
  chat: {
    answerCacheTtlSeconds: parseInt(process.env.CHAT_ANSWER_CACHE_TTL_SECONDS || '3600', 10),
  },
});

/* Registers namespaced configuration loader for NestJS ConfigModule */
export const configuration = registerAs('app', loadConfiguration);

/* Injectable configuration service providing strongly-typed access */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get port(): number {
    return (
      this.configService.get<number>('app.port') ??
      this.configService.get<number>('port', 5000)
    );
  }

  get nodeEnv(): string {
    return (
      this.configService.get<string>('app.nodeEnv') ??
      this.configService.get<string>('nodeEnv', 'development')
    );
  }

  get corsOrigin(): string {
    return (
      this.configService.get<string>('app.corsOrigin') ??
      this.configService.get<string>('corsOrigin', '*')
    );
  }

  get webUrl(): string {
    return (
      this.configService.get<string>('app.webUrl') ??
      this.configService.get<string>('webUrl', 'http://localhost:3000')
    );
  }

  get appVersion(): string {
    return (
      this.configService.get<string>('app.appVersion') ??
      this.configService.get<string>('appVersion', '1.0.0')
    );
  }

  get otel() {
    return (
      this.configService.get<AppConfiguration['otel']>('app.otel') ?? {
        serviceName: this.configService.get<string>(
          'otel.serviceName',
          'Knowledge_Engine',
        ),
        serviceVersion: this.configService.get<string>(
          'otel.serviceVersion',
          '1.0',
        ),
        exporterEndpoint: this.configService.get<string>(
          'otel.exporterEndpoint',
          'http://localhost:4317',
        ),
        samplingRatio: this.configService.get<number>(
          'otel.samplingRatio',
          1.0,
        ),
      }
    );
  }

  get database(): AppConfiguration['database'] {
    return (
      this.configService.get<AppConfiguration['database']>('app.database') ?? {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgrespassword',
        database: 'frogtoberfest',
        ssl: false,
        synchronize: false,
      }
    );
  }

  get redis(): AppConfiguration['redis'] {
    return (
      this.configService.get<AppConfiguration['redis']>('app.redis') ?? {
        host: 'localhost',
        port: 6379,
      }
    );
  }

  get embedding(): AppConfiguration['embedding'] {
    return (
      this.configService.get<AppConfiguration['embedding']>('app.embedding') ?? {
        providerType: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        remoteGpuUrl: 'http://localhost:8000',
        model: 'nomic-embed-text',
        dimension: 768,
      }
    );
  }

  get notion(): AppConfiguration['notion'] {
    return (
      this.configService.get<AppConfiguration['notion']>('app.notion') ?? {
        apiKey: '',
        apiVersion: '2022-06-28',
        baseUrl: 'https://api.notion.com/v1',
        maxDepth: 5,
        maxRequests: 50,
      }
    );
  }

  /* Local chat model used for answer generation and follow-up rewriting */
  get llm(): AppConfiguration['llm'] {
    return this.configService.get<AppConfiguration['llm']>('app.llm') ?? loadConfiguration().llm;
  }

  /* Retrieval gating and context-selection limits */
  get retrieval(): AppConfiguration['retrieval'] {
    return (
      this.configService.get<AppConfiguration['retrieval']>('app.retrieval') ??
      loadConfiguration().retrieval
    );
  }

  /* Optional cross-encoder reranking service */
  get reranker(): AppConfiguration['reranker'] {
    return (
      this.configService.get<AppConfiguration['reranker']>('app.reranker') ??
      loadConfiguration().reranker
    );
  }

  /* Chat turn behaviour */
  get chat(): AppConfiguration['chat'] {
    return this.configService.get<AppConfiguration['chat']>('app.chat') ?? loadConfiguration().chat;
  }
}

export default configuration;
