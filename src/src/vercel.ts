/**
 * Vercel serverless entry-point for the NestJS API.
 *
 * tsconfig-paths is registered FIRST so that TypeScript path
 * aliases (@/lib/*) resolve correctly at runtime.
 */
require('tsconfig-paths/register');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';

let cachedHandler: any;
let cachedPromise: Promise<any> | null = null;

async function bootstrap(): Promise<any> {
  if (cachedHandler) return cachedHandler;

  if (!cachedPromise) {
    cachedPromise = (async () => {
      const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

      app.setGlobalPrefix('api/v1', {
        exclude: [{ path: '', method: RequestMethod.GET }],
      });

      app.enableCors({
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      });

      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );

      await app.init();
      return app.getHttpAdapter().getInstance();
    })();
  }

  cachedHandler = await cachedPromise;
  return cachedHandler;
}

export default async function handler(req: any, res: any) {
  try {
    const app = await bootstrap();
    return app(req, res);
  } catch (err) {
    Logger.error('Serverless handler error', err, 'VercelHandler');
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
