import { Module } from '@nestjs/common';
import { AlumniController } from './alumni.controller';
import { AlumniService } from './alumni.service';

@Module({
  controllers: [AlumniController],
  providers: [AlumniService],
})
export class AlumniModule {}
