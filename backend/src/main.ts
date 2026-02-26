import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initializeOpenTelemetry } from './telemetry/opentelemetry';
import { WinstonModule } from 'nest-winston';
import { createLogger } from './common/logger/winston.config';

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

  // Body size limit - Allow up to 100MB file uploads
  app.use(require('express').json({ limit: '100mb' }));
  app.use(require('express').urlencoded({ limit: '100mb', extended: true }));

  // CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:3001'),
    credentials: true,
  });

  // Global prefix
  const apiPrefix = configService.get('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

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