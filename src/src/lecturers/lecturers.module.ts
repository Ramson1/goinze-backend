import { Module } from '@nestjs/common';
import { LecturersMeService } from './lecturers-me.service';
import { LecturersMeController } from './lecturers-me.controller';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [CommunicationModule],
  controllers: [LecturersMeController],
  providers: [LecturersMeService],
  exports: [LecturersMeService],
})
export class LecturersModule {}
