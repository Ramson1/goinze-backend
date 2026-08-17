import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Thin wrapper around the shared Prisma client exported by @goinze/database.
 * The underlying client is a module-level singleton, so every service that
 * injects PrismaService shares the exact same connection pool.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** The shared PrismaClient singleton. */
  get client(): PrismaClient {
    return prisma;
  }

  /** Convenience alias so `this.prisma.db.student.findMany(...)` reads well. */
  get db(): PrismaClient {
    return prisma;
  }

  async onModuleInit(): Promise<void> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await prisma.$connect();
        return;
      } catch (err) {
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}`,
        );
        if (attempt === maxRetries) throw err;
        // Wait before retrying — Neon may need time to wake from suspend
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await prisma.$disconnect();
  }
}
