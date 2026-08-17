import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { CourseRegistrationService } from './course-registration.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('course-registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CourseRegistrationController {
  constructor(
    private readonly courseRegistrationService: CourseRegistrationService,
  ) {}

  @Post()
  @Roles('STUDENT', 'SCHOOL_ADMIN')
  register(
    @Body()
    data: {
      studentId: string;
      sessionId: string;
      semester?: string;
      level?: number;
      courseIds?: string[];
    },
  ) {
    return this.courseRegistrationService.register(data);
  }

  @Get('student/:studentId')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'LECTURER')
  listForStudent(@Param('studentId') studentId: string) {
    return this.courseRegistrationService.listForStudent(studentId);
  }

  @Get(':id')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'LECTURER')
  findOne(@Param('id') id: string) {
    return this.courseRegistrationService.findOne(id);
  }

  @Post(':id/courses')
  @Roles('STUDENT', 'SCHOOL_ADMIN')
  addCourses(
    @Param('id') id: string,
    @Body() data: { courseIds: string[] },
  ) {
    return this.courseRegistrationService.addCourses(id, data.courseIds);
  }

  @Delete(':id/courses/:courseId')
  @Roles('STUDENT', 'SCHOOL_ADMIN')
  dropCourse(@Param('id') id: string, @Param('courseId') courseId: string) {
    return this.courseRegistrationService.dropCourse(id, courseId);
  }

  @Patch(':id/approve')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  approve(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.courseRegistrationService.approve(id, user.id);
  }

  @Patch(':id/lock')
  @Roles('SCHOOL_ADMIN')
  lock(@Param('id') id: string) {
    return this.courseRegistrationService.lock(id);
  }
}
