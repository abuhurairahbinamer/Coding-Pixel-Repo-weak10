// ============================================================================
// [C1] CORE REQUIREMENT: Global exception filter returning one consistent error body:
//      { statusCode, message, error, timestamp, path }
// [X2] CHALLENGE REQUIREMENT: Ensure no secrets leak in error responses or logs
// [X3] CHALLENGE REQUIREMENT: Detailed error message in development, generic in production,
//      while server logs record the full failure in both environments.
// ============================================================================
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from "@nestjs/common";
import { Request, Response } from "express";
import { sanitizeData } from "../utils/sanitizer.util.js";
import { AppConfigService } from "../../config/app-config.service.js";

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

/**
 * Standard HTTP Status description lookup fallback.
 */
function getStatusPhrase(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "Bad Request";
    case HttpStatus.UNAUTHORIZED:
      return "Unauthorized";
    case HttpStatus.FORBIDDEN:
      return "Forbidden";
    case HttpStatus.NOT_FOUND:
      return "Not Found";
    case HttpStatus.CONFLICT:
      return "Conflict";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Too Many Requests";
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return "Internal Server Error";
    default:
      return HttpStatus[status] || "Error";
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() private readonly config?: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isProduction = this.config
      ? this.config.isProduction
      : (process.env.NODE_ENV === "production");

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    let error = "Internal Server Error";

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === "string") {
        message = res;
        error = getStatusPhrase(statusCode);
      } else if (typeof res === "object" && res !== null) {
        const resObj = res as { message?: string | string[]; error?: string };
        message = resObj.message ?? getStatusPhrase(statusCode);
        error = resObj.error ?? getStatusPhrase(statusCode);
      } else {
        error = getStatusPhrase(statusCode);
      }
    } else {
      // [X2] & [X3] Unhandled / 500 error handling
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      error = "Internal Server Error";

      // Server log keeps the full sanitized detail in both environments
      const rawErrorMessage =
        exception instanceof Error ? exception.message : "Unknown error";
      const rawErrorStack = exception instanceof Error ? exception.stack : undefined;

      const sanitizedMessage = sanitizeData(rawErrorMessage);
      const sanitizedStack = rawErrorStack ? sanitizeData(rawErrorStack) : undefined;

      this.logger.error(
        `[500 Internal Error] Path: ${request.originalUrl || request.url} - ${sanitizedMessage}`,
        sanitizedStack,
      );

      // [X3] In production, return generic error message. In dev/test, provide descriptive message.
      if (isProduction) {
        message = "Internal server error";
      } else {
        message =
          exception instanceof Error
            ? sanitizeData(exception.message)
            : "Internal server error";
      }
    }

    // [C1] Exactly five consistent fields, no stack traces or raw database messages to client
    const responseBody: ErrorResponseBody = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url,
    };

    response.status(statusCode).json(responseBody);
  }
}
