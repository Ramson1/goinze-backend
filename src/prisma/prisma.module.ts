import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global module that provides the shared PrismaService to the whole app,
 * so feature modules do not need to import it explicitly.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
