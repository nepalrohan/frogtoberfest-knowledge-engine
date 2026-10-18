import { Injectable } from '@nestjs/common';
import { ConfigService, registerAs } from '@nestjs/config';

export interface AppConfiguration {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  webUrl: string;
  frontendUrl: string;
  encryptionSecret: string;
  adminApiKey: string;
  appVersion: string;
  otel: {
    serviceName: string;
    serviceVersion: string;
    exporterEndpoint: string;
    samplingRatio: number;
  };
  notion: {
    apiKey: string;
    apiVersion: string;
    baseUrl: string;
    maxDepth: number;
    maxRequests: number;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authorizationUrl: string;
  };
}

/* Loads raw environment configurations with fallbacks */
export const loadConfiguration = (): AppConfiguration => ({
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  webUrl: process.env.WEB_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || process.env.WEB_URL || 'http://localhost:3000',
  encryptionSecret:
    process.env.ENCRYPTION_SECRET || 'knowledge-engine-secret-key-32b-min!',
  adminApiKey: process.env.ADMIN_API_KEY || 'default-admin-api-key-for-dev',
  appVersion: process.env.APP_VERSION || '1.0.0',
  otel: {
    serviceName: process.env.OTEL_ATTR_SERVICE_NAME || 'Knowledge_Engine',
    serviceVersion: process.env.OTEL_ATTR_SERVICE_VERSION || '1.0',
    exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    samplingRatio: parseFloat(process.env.OTEL_SAMPLING_RATIO || '1.0'),
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    apiVersion: process.env.NOTION_VERSION || '2022-06-28',
    baseUrl: process.env.NOTION_BASE_URL || 'https://api.notion.com/v1',
    maxDepth: parseInt(process.env.NOTION_MAX_DEPTH || '5', 10),
    maxRequests: parseInt(process.env.NOTION_MAX_REQUESTS || '50', 10),
    clientId: process.env.NOTION_CLIENT_ID || 'notion-client-id-default',
    clientSecret:
      process.env.NOTION_CLIENT_SECRET || 'notion-client-secret-default',
    redirectUri:
      process.env.NOTION_REDIRECT_URI ||
      'http://localhost:5000/api/v1/integrations/notion/oauth/callback',
    authorizationUrl:
      process.env.NOTION_AUTH_URL ||
      'https://api.notion.com/v1/oauth/authorize',
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

  get frontendUrl(): string {
    return (
      this.configService.get<string>('app.frontendUrl') ??
      this.configService.get<string>('frontendUrl') ??
      this.webUrl
    );
  }

  get encryptionSecret(): string {
    return (
      this.configService.get<string>('app.encryptionSecret') ??
      this.configService.get<string>(
        'encryptionSecret',
        'knowledge-engine-secret-key-32b-min!',
      )
    );
  }

  get adminApiKey(): string {
    return (
      this.configService.get<string>('app.adminApiKey') ??
      this.configService.get<string>(
        'adminApiKey',
        'default-admin-api-key-for-dev',
      )
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

  get notion(): AppConfiguration['notion'] {
    return (
      this.configService.get<AppConfiguration['notion']>('app.notion') ?? {
        apiKey: this.configService.get<string>('notion.apiKey', ''),
        apiVersion: this.configService.get<string>(
          'notion.apiVersion',
          '2022-06-28',
        ),
        baseUrl: this.configService.get<string>(
          'notion.baseUrl',
          'https://api.notion.com/v1',
        ),
        maxDepth: this.configService.get<number>('notion.maxDepth', 5),
        maxRequests: this.configService.get<number>('notion.maxRequests', 50),
        clientId: this.configService.get<string>(
          'notion.clientId',
          'notion-client-id-default',
        ),
        clientSecret: this.configService.get<string>(
          'notion.clientSecret',
          'notion-client-secret-default',
        ),
        redirectUri: this.configService.get<string>(
          'notion.redirectUri',
          'http://localhost:5000/api/v1/integrations/notion/oauth/callback',
        ),
        authorizationUrl: this.configService.get<string>(
          'notion.authorizationUrl',
          'https://api.notion.com/v1/oauth/authorize',
        ),
      }
    );
  }
}

export default configuration;
