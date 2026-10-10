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
import { envSchema } from './config/env.validation';

// 1. Force load the correct .env file early for validation
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// 2. Validate using your existing Zod schema
const parsedEnv = envSchema.parse(process.env);

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: parsedEnv.OTEL_ATTR_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: parsedEnv.OTEL_ATTR_SERVICE_VERSION,
  }),

  traceExporter: new OTLPTraceExporter({
    url: parsedEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),

  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(parsedEnv.OTEL_SAMPLING_RATIO),
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
