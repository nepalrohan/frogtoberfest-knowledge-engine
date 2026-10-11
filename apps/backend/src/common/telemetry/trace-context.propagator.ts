import {
  context,
  propagation,
  trace,
  Context,
  Span,
  Link,
} from '@opentelemetry/api';

export interface TraceContextCarrier {
  traceparent?: string;
  tracestate?: string;
  [key: string]: unknown;
}

/**
 * Standard W3C Trace Context propagation utilities for in-process and distributed messaging.
 */
export class TraceContextPropagator {
  /**
   * Retrieves the currently active span if one exists.
   */
  static getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * Returns current active traceId and spanId (or undefined if no active trace context).
   */
  static getActiveTraceInfo(): { traceId?: string; spanId?: string } {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) return {};
    const spanCtx = activeSpan.spanContext();
    return {
      traceId: spanCtx.traceId,
      spanId: spanCtx.spanId,
    };
  }

  /**
   * Injects the active (or provided) OpenTelemetry context into a plain carrier object.
   * Produces `traceparent` (and `tracestate` if present).
   */
  static injectToCarrier(
    target: Record<string, unknown> = {},
    ctx: Context = context.active(),
  ): TraceContextCarrier {
    const carrier: Record<string, string> = {};
    propagation.inject(ctx, carrier);

    if (carrier.traceparent) {
      target.traceparent = carrier.traceparent;
    }
    if (carrier.tracestate) {
      target.tracestate = carrier.tracestate;
    }
    return target as TraceContextCarrier;
  }

  /**
   * Extracts OpenTelemetry context from a plain carrier object containing `traceparent` and optional `tracestate`.
   */
  static extractFromCarrier(
    carrier: TraceContextCarrier | null | undefined,
    parentCtx: Context = context.active(),
  ): Context {
    if (!carrier || !carrier.traceparent) {
      return parentCtx;
    }

    const carrierRecord: Record<string, string> = {
      traceparent: String(carrier.traceparent),
    };
    if (carrier.tracestate) {
      carrierRecord.tracestate = String(carrier.tracestate);
    }

    return propagation.extract(parentCtx, carrierRecord);
  }

  /**
   * Creates an OpenTelemetry Link from extracted carrier for causal tracing.
   */
  static createLinkFromCarrier(
    carrier?: TraceContextCarrier | null,
  ): Link | undefined {
    if (!carrier) return undefined;
    const extractedCtx = this.extractFromCarrier(carrier);
    const span = trace.getSpan(extractedCtx);
    if (!span) return undefined;
    return {
      context: span.spanContext(),
    };
  }
}
