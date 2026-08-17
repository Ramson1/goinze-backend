import { Module } from '@nestjs/common';
import { AdmissionsService } from './admissions.service';
import { AdmissionsController } from './admissions.controller';
import { CloudinaryModule } from '../common/utils/cloudinary.module';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [CloudinaryModule, CommunicationModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
  exports: [AdmissionsService],
})
export class AdmissionsModule {}
