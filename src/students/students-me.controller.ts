import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '../lib/types';
import { StudentsMeService } from './students-me.service';
import { RegisterCoursesDto } from './dto/students-me.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Student self-service endpoints for the student portal.
 * All routes require an authenticated STUDENT and are scoped to their record.
 */
@Controller('students/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class StudentsMeController {
  constructor(private readonly meService: StudentsMeService) {}

  @Get()
  profile(@CurrentUser() user: SessionUser) {
    return this.meService.profile(user.id);
  }

  @Get('digital-id')
  digitalId(@CurrentUser() user: SessionUser) {
    return this.meService.digitalId(user.id);
  }

  @Get('fees')
  fees(@CurrentUser() user: SessionUser) {
    return this.meService.fees(user.id);
  }

  @Get('results')
  results(@CurrentUser() user: SessionUser) {
    return this.meService.results(user.id);
  }

  @Get('courses')
  courses(@CurrentUser() user: SessionUser) {
    return this.meService.registeredCourses(user.id);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: SessionUser) {
    return this.meService.dashboard(user.id);
  }

  @Get('available-courses')
  availableCourses(
    @CurrentUser() user: SessionUser,
    @Query('semester') semester?: string,
  ) {
    return this.meService.availableCourses(user.id, semester);
  }

  @Post('course-registration')
  submitRegistration(
    @CurrentUser() user: SessionUser,
    @Body() dto: RegisterCoursesDto,
  ) {
    return this.meService.submitRegistration(user.id, dto);
  }
}
