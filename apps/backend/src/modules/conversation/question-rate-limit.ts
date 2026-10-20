import type { ThrottlerOptions } from '@nestjs/throttler';

/* Per-client limit on question submissions (spec: 20 per minute); history routes are not limited */
export const QUESTION_RATE_LIMIT: ThrottlerOptions = {
  name: 'questions',
  ttl: 60_000,
  limit: 20,
  /* One shared counter per client across new and follow-up questions (the default key is per route) */
  generateKey: (_context, tracker, throttlerName) =>
    `${throttlerName}:${tracker}`,
};
