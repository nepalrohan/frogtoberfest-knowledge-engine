import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z
    .enum(['development', 'production', 'test', 'provision'])
    .default('development'),

  OTEL_ATTR_SERVICE_VERSION: z
    .string()
    .optional()
    .or(z.literal(''))
    .default('1.0'),
  OTEL_ATTR_SERVICE_NAME: z
    .string()
    .optional()
    .or(z.literal(''))
    .default('Knowledge_Engine'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .default('http://localhost:4317'),
  OTEL_SAMPLING_RATIO: z.coerce.number().min(0).max(1).optional().default(1),
});

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    throw new Error('Environment validation failed');
  }

  return result.data;
}
