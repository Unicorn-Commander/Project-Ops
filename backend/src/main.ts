// Sentry / Glitchtip MUST be the first import — the SDK has to hook the
// Node runtime before any user code runs. No-op when SENTRY_DSN is unset.
import './instrument';

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initializeOpenTelemetry } from './telemetry/opentelemetry';
import { WinstonModule } from 'nest-winston';
import { createLogger } from './common/logger/winston.config';
import { SentryFilter } from './common/filters/sentry.filter';
import { PublicUserInterceptor } from './common/serialization/public-user.interceptor';
import { createMcpCorsMiddleware } from './auth/oauth-discovery/mcp-cors';

async function bootstrap() {
  // Initialize OpenTelemetry
  initializeOpenTelemetry();

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createLogger()),
    bodyParser: true,
  });

  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());
  app.use(compression());
  app.useGlobalInterceptors(new PublicUserInterceptor());

  // Body size limit - Allow up to 100MB file uploads
  // Preserve bootstrap module-loading order after instrumentation setup.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use(require('express').json({ limit: '100mb' }));
  // Preserve bootstrap module-loading order after instrumentation setup.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use(require('express').urlencoded({ limit: '100mb', extended: true }));

  // MCP is a bearer-only browser surface. This middleware runs before Nest's
  // guards so preflight can answer without authentication and disallowed
  // browser origins are rejected without revealing auth state.
  app.use(createMcpCorsMiddleware(configService));

  // CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:3001'),
    credentials: true,
  });

  // Global prefix
  const apiPrefix = configService.get('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix, {
    // RFC 9728 metadata is served at the origin root, not under /api/v1.
    exclude: [
      '.well-known/oauth-protected-resource',
      '.well-known/oauth-protected-resource/api/v1/mcp',
    ],
  });

  // Global validation pipe
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

  // Sentry filter — captures uncaught exceptions surfacing through Nest.
  // Process-level uncaught/unhandled handlers are already attached by the
  // SDK init in instrument.ts. Pass the adapter host explicitly so
  // BaseExceptionFilter has the HttpServer reference it needs to write
  // the response (without it, every 5xx path crashes with
  // `TypeError: Cannot read properties of undefined (reading 'isHeadersSent')`).
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryFilter(httpAdapterHost));

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Project Ops API')
    .setDescription('Backend API for Project Ops project management system')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .addTag('projects', 'Project management')
    .addTag('documents', 'Document operations')
    .addTag('comments', 'Comment operations')
    .addTag('audit', 'Audit log queries')
    .addTag('dashboard', 'Dashboard statistics')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = configService.get('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on: http://0.0.0.0:${port}/${apiPrefix}`);
  console.log(`📚 Swagger documentation: http://0.0.0.0:${port}/${apiPrefix}/docs`);
}

bootstrap();
