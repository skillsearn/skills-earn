import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Env } from './common/env';

async function bootstrap() {
  // rawBody is required to verify Razorpay webhook signatures.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService<Env, true>);

  app.set('trust proxy', 1);
  // Screenshot / QR uploads are sent as base64 JSON (5 MB image ≈ 6.7 MB encoded).
  app.useBodyParser('json', { limit: '8mb' });
  app.use(helmet());
  app.enableCors({
    origin: config.get('WEB_ORIGIN').split(',').map((s: string) => s.trim()),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  const port = config.get('PORT');
  await app.listen(port);
  Logger.log(`SKILLSEARN API on http://localhost:${port}/api (payments: ${config.get('PAYMENT_PROVIDER')})`, 'Bootstrap');
}

void bootstrap();
