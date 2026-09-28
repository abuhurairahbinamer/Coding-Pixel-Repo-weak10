// ============================================================================
// Week 9 Assignment 3: Security Hardening and OWASP Checklist
// [W2] Enable helmet security headers and restrict CORS to FRONTEND_URL (http://localhost:3000)
// [X1] Tuned Content-Security-Policy (CSP)
// [C2] Strict validation everywhere to prevent mass assignment (whitelist & forbidNonWhitelisted)
// [C1] Global AllExceptionsFilter returning consistent 5-field error shapes
// ============================================================================
import { ForbiddenException, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // [W2] & [X1] Security headers via Helmet with tuned Content-Security-Policy (CSP)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // [W2] Restrict CORS to configured frontend origin (e.g. http://localhost:3000)
  const allowedOrigin = configService.get<string>("FRONTEND_URL", "http://localhost:3000");
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests without Origin header (e.g., server-to-server, curl, Postman)
      if (!origin || origin === allowedOrigin) {
        callback(null, true);
      } else {
        callback(
          new ForbiddenException(
            `Disallowed by CORS: origin '${origin}' is not permitted`,
          ),
          false,
        );
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });

  // [C2] Global validation pipe with whitelist & forbidNonWhitelisted (prevents mass assignment)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // [C1] Global exception filter for uniform 5-field error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>("PORT", 3000);
  await app.listen(port);
}

await bootstrap();
