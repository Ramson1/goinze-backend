import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { StudentsMeService } from './students-me.service';
import { StudentsMeController } from './students-me.controller';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [CommunicationModule],
  controllers: [StudentsMeController, StudentsController],
  providers: [StudentsService, StudentsMeService],
  exports: [StudentsService, StudentsMeService],
})
export class StudentsModule {}
