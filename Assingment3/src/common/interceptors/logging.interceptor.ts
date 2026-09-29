// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [W2] WARM-UP REQUIREMENT: Logging interceptor recording method, path, status, duration
// [X2] CHALLENGE REQUIREMENT: Automatic secret & token redaction (Bearer [REDACTED], password)
// [X3] CHALLENGE REQUIREMENT: Structured JSON logs carrying request ID across all lines
// ============================================================================
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { sanitizeData } from "../utils/sanitizer.util.js";

export interface StructuredLogPayload {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  durationMs: number;
  auth?: string;
  body?: unknown;
  message?: string;
  error?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // [X3] Read incoming x-request-id header or generate unique request id
    const headerRequestId = request.headers["x-request-id"];
    const requestId =
      typeof headerRequestId === "string" && headerRequestId.trim().length > 0
        ? headerRequestId.trim()
        : randomUUID();

    // Attach request ID to request object and propagate via response header
    (request as any).id = requestId;
    if (response && typeof response.setHeader === "function") {
      response.setHeader("X-Request-Id", requestId);
    }

    const { method, originalUrl, url, headers, body } = request;
    const path = originalUrl || url;

    // [X2] Redact sensitive credentials in headers, tokens, and payload
    const rawAuth = headers?.authorization;
    const sanitizedAuth = rawAuth
      ? typeof rawAuth === "string" && /^bearer\s+/i.test(rawAuth)
        ? "Bearer [REDACTED]"
        : "[REDACTED]"
      : "None";

    const sanitizedBody = sanitizeData(body);

    // [X3] Structured JSON log for incoming request
    const incomingLog: StructuredLogPayload = {
      requestId,
      timestamp: new Date().toISOString(),
      method,
      path,
      statusCode: 0,
      duration: 0,
      durationMs: 0,
      event: "REQUEST_RECEIVED",
      auth: sanitizedAuth,
      body: sanitizedBody,
    };
    this.logger.log(JSON.stringify(incomingLog));

    // [W2] Start the timer before the handler and log in tap
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const statusCode = response.statusCode || 200;

          // [W2] & [X3] Log line carrying method, path, status code, duration as structured JSON
          const completionLog: StructuredLogPayload = {
            requestId,
            timestamp: new Date().toISOString(),
            method,
            path,
            statusCode,
            duration,
            durationMs: duration,
            auth: sanitizedAuth,
            body: sanitizedBody,
            message: `${method} ${path} ${statusCode} - ${duration}ms`,
          };

          this.logger.log(JSON.stringify(completionLog));
        },
        error: (err: unknown) => {
          const duration = Date.now() - start;

          // Resolve appropriate status code from exception
          let statusCode = 500;
          if (err instanceof HttpException) {
            statusCode = err.getStatus();
          } else if (typeof (err as any)?.status === "number") {
            statusCode = (err as any).status;
          } else if (response.statusCode && response.statusCode >= 400) {
            statusCode = response.statusCode;
          }

          const rawErrorMessage = err instanceof Error ? err.message : String(err);
          const sanitizedErrorMessage = sanitizeData(rawErrorMessage);

          // [W2] & [X3] Log line carrying all 4 fields for failing requests as structured JSON
          const errorLog: StructuredLogPayload = {
            requestId,
            timestamp: new Date().toISOString(),
            method,
            path,
            statusCode,
            duration,
            durationMs: duration,
            auth: sanitizedAuth,
            body: sanitizedBody,
            error: err instanceof Error ? err.name : "Error",
            errorMessage: sanitizedErrorMessage,
            message: `${method} ${path} ${statusCode} - ${duration}ms [FAILED]`,
          };

          this.logger.error(JSON.stringify(errorLog));
        },
      }),
    );
  }
}
