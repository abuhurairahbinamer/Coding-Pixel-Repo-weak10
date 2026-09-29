// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [W1] Fail fast at boot with validated configuration
// [C2] Read configuration through typed AppConfigService
// [C3] Wire graceful shutdown with enableShutdownHooks
// ============================================================================
import { ForbiddenException, Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { AppConfigService } from "./config/app-config.service.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule);

  // [C3] Wire graceful shutdown with enableShutdownHooks
  // WHY: An abrupt exit drops requests in flight and leaves database connections open.
  // HINT: On SIGTERM, stop accepting new connections first, let in-flight work finish, then close DB.
  app.enableShutdownHooks();

  // [C2] Retrieve configuration through strongly-typed AppConfigService
  const config = app.get(AppConfigService);

  // Security headers via Helmet with tuned Content-Security-Policy (CSP)
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

  // Restrict CORS to configured frontend origin
  const allowedOrigin = config.frontendUrl;
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
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
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-Id",
    ],
  });

  // Global validation pipe with whitelist & forbidNonWhitelisted
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

  // Global exception filter for uniform 5-field error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.port;
  await app.listen(port);
  logger.log(`Application successfully booted and listening on port ${port} [env=${config.nodeEnv}]`);
}

await bootstrap();
