/* Normalizes an unknown thrown value into an Error so callers can read message and stack safely */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  if (value && typeof value === 'object' && 'message' in value) {
    return new Error(String(value.message));
  }
  return new Error(String(value));
}

/* Reads an HTTP status from the shapes used by fetch wrappers, axios, and Nest exceptions */
function readStatus(value: object): number | undefined {
  const candidate = value as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/* True when a provider explicitly rejected the credentials (HTTP 401 or a revoked/invalid grant) */
export function isAuthRejection(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (readStatus(value) === 401) {
    return true;
  }
  const message = toError(value).message.toLowerCase();
  return message.includes('unauthorized') || message.includes('invalid_grant');
}
