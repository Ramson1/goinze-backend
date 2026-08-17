import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { LecturersMeService } from './lecturers-me.service';
import { SaveScoresDto, UpdateProfileDto } from './dto/lecturers-me.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Lecturer self-service endpoints for the lecturer portal.
 * All routes require an authenticated LECTURER and are scoped to their courses.
 */
@Controller('lecturers/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LECTURER')
export class LecturersMeController {
  constructor(private readonly meService: LecturersMeService) {}

  @Get()
  profile(@CurrentUser() user: SessionUser) {
    return this.meService.profile(user.id);
  }

  @Patch()
  updateProfile(
    @CurrentUser() user: SessionUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.meService.updateProfile(user.id, dto);
  }

  @Get('contacts')
  contacts(@CurrentUser() user: SessionUser) {
    return this.meService.contacts(user.id);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: SessionUser) {
    return this.meService.dashboard(user.id);
  }

  @Get('courses')
  courses(@CurrentUser() user: SessionUser) {
    return this.meService.myCourses(user.id);
  }

  @Get('courses/:courseId/roster')
  roster(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.meService.courseRoster(user.id, courseId);
  }

  @Get('courses/:courseId/results')
  courseResults(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.meService.courseResults(user.id, courseId);
  }

  @Post('courses/:courseId/scores')
  saveScores(
    @CurrentUser() user: SessionUser,
    @Param('courseId') courseId: string,
    @Body() dto: SaveScoresDto,
  ) {
    return this.meService.saveScores(user.id, courseId, dto);
  }

  @Patch('courses/:courseId/submit')
  submit(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.meService.submitCourseResults(user.id, courseId);
  }

  @Patch('courses/:courseId/publish')
  publish(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.meService.publishCourseResults(user.id, courseId);
  }

  @Get('registrations')
  registrations(@CurrentUser() user: SessionUser) {
    return this.meService.pendingRegistrations(user.id);
  }

  @Patch('registrations/:id/approve')
  approveRegistration(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.meService.approveRegistration(user.id, id);
  }
}
