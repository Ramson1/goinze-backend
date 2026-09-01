import { Module } from '@nestjs/common';
import { CourseRegistrationService } from './course-registration.service';
import { CourseRegistrationController } from './course-registration.controller';

@Module({
  controllers: [CourseRegistrationController],
  providers: [CourseRegistrationService],
  exports: [CourseRegistrationService],
})
export class CourseRegistrationModule {}
