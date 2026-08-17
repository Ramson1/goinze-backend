import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { ResultsService } from './results.service';
import {
  EnterScoreDto,
  BulkUploadDto,
  VerifyResultPinDto,
  UpdateScoreDto,
} from './dto/result.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('results')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Post('scores')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  enterScore(@CurrentUser() user: SessionUser, @Body() dto: EnterScoreDto) {
    return this.resultsService.enterScore(user.schoolId, dto);
  }

  @Post('bulk-upload')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  bulkUpload(@CurrentUser() user: SessionUser, @Body() dto: BulkUploadDto) {
    return this.resultsService.bulkUpload(user.schoolId, dto);
  }

  @Get('student/:studentId')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  listForStudent(
    @Param('studentId') studentId: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.resultsService.listForStudent(studentId, sessionId);
  }

  @Get('student/:studentId/gpa')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  gpa(@Param('studentId') studentId: string) {
    return this.resultsService.computeStudentGpa(studentId);
  }

  // ---- Admin: course-grouped approval workflow ----
  @Get('admin/courses')
  @Roles('SCHOOL_ADMIN')
  adminCourseSummaries(@CurrentUser() user: SessionUser) {
    return this.resultsService.adminCourseSummaries(user.schoolId);
  }

  @Get('admin/courses/:courseId')
  @Roles('SCHOOL_ADMIN')
  adminCourseResults(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.resultsService.adminCourseResults(user.schoolId, courseId);
  }

  @Patch('admin/courses/:courseId/approve')
  @Roles('SCHOOL_ADMIN')
  approveCourse(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.resultsService.approveCourse(user.schoolId, courseId, user.id);
  }

  @Patch('admin/courses/:courseId/lock')
  @Roles('SCHOOL_ADMIN')
  lockCourse(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.resultsService.lockCourse(user.schoolId, courseId);
  }

  @Patch('admin/courses/:courseId/publish')
  @Roles('SCHOOL_ADMIN')
  publishCourse(@CurrentUser() user: SessionUser, @Param('courseId') courseId: string) {
    return this.resultsService.publishCourse(user.schoolId, courseId);
  }

  @Patch(':id/approve')
  @Roles('SCHOOL_ADMIN')
  approve(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.resultsService.approve(id, user.id);
  }

  @Patch(':id/lock')
  @Roles('SCHOOL_ADMIN')
  lock(@Param('id') id: string) {
    return this.resultsService.lock(id);
  }

  @Patch(':id/publish')
  @Roles('SCHOOL_ADMIN')
  publish(@Param('id') id: string) {
    return this.resultsService.publish(id);
  }

  @Patch(':id')
  @Roles('SCHOOL_ADMIN')
  updateScore(@Param('id') id: string, @Body() dto: UpdateScoreDto) {
    return this.resultsService.updateScore(id, dto);
  }

  // ---- Result pins ----
  @Post('pins')
  @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
  generatePin(@CurrentUser() user: SessionUser) {
    return this.resultsService.generatePin(user.schoolId);
  }

  @Post('pins/verify')
  @Roles('STUDENT', 'SCHOOL_ADMIN')
  verifyPin(@Body() dto: VerifyResultPinDto) {
    return this.resultsService.verifyPin(dto);
  }
}
