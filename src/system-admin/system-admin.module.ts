import { Module } from '@nestjs/common';
import { SystemAdminService } from './system-admin.service';
import { SystemAdminController } from './system-admin.controller';

@Module({
  controllers: [SystemAdminController],
  providers: [SystemAdminService],
  exports: [SystemAdminService],
})
export class SystemAdminModule {}
