// ============================================================================
// [X2] CHALLENGE REQUIREMENT: Centralized Logging Interceptor with Redaction
// Logs incoming requests at debug level, automatically redacting sensitive fields
// like password, token, refreshToken, authorization, etc.
// ============================================================================
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request } from "express";
import { sanitizeData } from "../utils/sanitizer.util.js";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, body, query, headers } = request;

    const sanitizedBody = sanitizeData(body);
    const sanitizedQuery = sanitizeData(query);
    const sanitizedAuth = headers?.authorization
      ? sanitizeData(headers.authorization)
      : undefined;

    this.logger.debug(
      `Incoming Request: ${method} ${url} | Auth: ${sanitizedAuth ?? "None"} | Body: ${JSON.stringify(
        sanitizedBody,
      )} | Query: ${JSON.stringify(sanitizedQuery)}`,
    );

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.debug(`Completed Request: ${method} ${url} [${duration}ms]`);
        },
        error: (err) => {
          const duration = Date.now() - start;
          const sanitizedErr = sanitizeData(
            err instanceof Error ? err.message : String(err),
          );
          this.logger.debug(
            `Failed Request: ${method} ${url} [${duration}ms] - ${sanitizedErr}`,
          );
        },
      }),
    );
  }
}
