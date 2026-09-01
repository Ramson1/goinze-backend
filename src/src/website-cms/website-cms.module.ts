import { Module } from '@nestjs/common';
import { WebsiteCmsService } from './website-cms.service';
import { WebsiteCmsController } from './website-cms.controller';
import { CloudinaryModule } from '../common/utils/cloudinary.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [CloudinaryModule, SecurityModule],
  controllers: [WebsiteCmsController],
  providers: [WebsiteCmsService],
  exports: [WebsiteCmsService],
})
export class WebsiteCmsModule {}
