import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  /* Enable CORS */
  const webUrl = config.webUrl;
  const corsOrigin = config.corsOrigin;

  app.enableCors({
    origin: corsOrigin === '*' ? webUrl : corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-branch-id', 'X-Branch-Id', 'x-admin-key'],
    credentials: true,
  });

  /* Global routing and versioning */
  app.setGlobalPrefix('api');

  app.enableVersioning({ type: VersioningType.URI });

  /* Global exception filter with structured WARN/ERROR telemetry */
  app.useGlobalFilters(new HttpExceptionFilter());

  /* Global validation pipe */
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

  /* OpenAPI / Swagger configuration */
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Knowledge Engine API')
    .setDescription(
      'Knowledge Engine - Ingestion, Vector Search, and Grounded Assistant API Documentation',
    )
    .setVersion(config.appVersion)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Bearer Token or Session Token',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = config.port;
  await app.listen(port);
  logger.log(`Backend running on http://localhost:${port}/api`);
  logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
