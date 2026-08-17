import { Injectable } from '@nestjs/common';

/**
 * Health check service.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  check() {
    return {
      status: 'ok' as const,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
