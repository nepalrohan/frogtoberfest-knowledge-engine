import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL,
    credentials: true,
  });


  /* Enable CORS */

  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-branch-id', 'X-Branch-Id'],
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
    .setTitle('Rani Cake API')
    .setDescription(
      'Enterprise Authentication, Branch Isolation, and Administrative API Documentation',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Better Auth Bearer Token or Session Token',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-branch-id',
        description: 'Active branch UUID context',
      },
      'x-branch-id',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 5000);
  logger.log(`Backend running on http://localhost:${process.env.PORT ?? 5000}/api`);
  logger.log(`Swagger documentation available at http://localhost:${process.env.PORT ?? 5000}/api/docs`);
}
bootstrap();
