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
}

export default configuration;
