import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadConfiguration } from './config/configuration';

// 1. Load the environment file early for OpenTelemetry initialization
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// 2. Load configuration object
const config = loadConfiguration();

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.otel.serviceName,
    [ATTR_SERVICE_VERSION]: config.otel.serviceVersion,
  }),

  traceExporter: new OTLPTraceExporter({
    url: config.otel.exporterEndpoint,
  }),

  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(config.otel.samplingRatio),
  }),

  instrumentations: [getNodeAutoInstrumentations()],
});

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
