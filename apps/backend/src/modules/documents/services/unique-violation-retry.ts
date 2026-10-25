const UNIQUE_VIOLATION = '23505';

/* True for a PostgreSQL unique_violation surfaced through TypeORM's QueryFailedError */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === UNIQUE_VIOLATION);
}

/* Re-runs a whole transaction once when it lost a first-insert race on a unique source key */
export async function retryOnUniqueViolation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return work();
  }
}
