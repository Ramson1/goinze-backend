import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../lib/types';
import { AcademicsService } from './academics.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('academics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicsController {
  constructor(private readonly academicsService: AcademicsService) {}

  // ---- Faculties ----
  @Public()
  @Get('faculties')
  listFaculties(
    @CurrentUser() user: SessionUser | undefined,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.academicsService.listFaculties(
      user?.schoolId ?? schoolId ?? null,
    );
  }

  @Post('faculties')
  @Roles('SCHOOL_ADMIN')
  createFaculty(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.createFaculty(user.schoolId, data);
  }

  // ---- Departments ----
  @Public()
  @Get('departments')
  listDepartments(
    @CurrentUser() user: SessionUser | undefined,
    @Query('schoolId') schoolId?: string,
    @Query('facultyId') facultyId?: string,
  ) {
    return this.academicsService.listDepartments(
      user?.schoolId ?? schoolId ?? null,
      facultyId,
    );
  }

  @Post('departments')
  @Roles('SCHOOL_ADMIN')
  createDepartment(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.createDepartment(user.schoolId, data);
  }

  @Put('departments/:id')
  @Roles('SCHOOL_ADMIN')
  updateDepartment(@Param('id') id: string, @Body() data: Record<string, any>) {
    return this.academicsService.updateDepartment(id, data);
  }

  @Delete('departments/:id')
  @Roles('SCHOOL_ADMIN')
  deleteDepartment(@Param('id') id: string) {
    return this.academicsService.deleteDepartment(id);
  }

  // ---- Programmes ----
  @Public()
  @Get('programmes')
  listProgrammes(
    @CurrentUser() user: SessionUser | undefined,
    @Query('schoolId') schoolId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.academicsService.listProgrammes(
      user?.schoolId ?? schoolId ?? null,
      departmentId,
    );
  }

  @Post('programmes')
  @Roles('SCHOOL_ADMIN')
  createProgramme(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.createProgramme(user.schoolId, data);
  }

  @Put('programmes/:id')
  @Roles('SCHOOL_ADMIN')
  updateProgramme(@Param('id') id: string, @Body() data: Record<string, any>) {
    return this.academicsService.updateProgramme(id, data);
  }

  @Delete('programmes/:id')
  @Roles('SCHOOL_ADMIN')
  deleteProgramme(@Param('id') id: string) {
    return this.academicsService.deleteProgramme(id);
  }

  // ---- Sessions ----
  @Get('sessions')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  listSessions(@CurrentUser() user: SessionUser) {
    return this.academicsService.listSessions(user.schoolId);
  }

  @Post('sessions')
  @Roles('SCHOOL_ADMIN')
  createSession(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.createSession(user.schoolId, data);
  }

  @Patch('sessions/:id/activate')
  @Roles('SCHOOL_ADMIN')
  activateSession(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ) {
    return this.academicsService.activateSession(user.schoolId, id);
  }

  @Patch('sessions/:id')
  @Roles('SCHOOL_ADMIN')
  updateSession(
    @Param('id') id: string,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.updateSession(id, data);
  }

  @Delete('sessions/:id')
  @Roles('SCHOOL_ADMIN')
  deleteSession(@Param('id') id: string) {
    return this.academicsService.deleteSession(id);
  }

  // ---- Courses ----
  @Get('courses')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  listCourses(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
    @Query('departmentId') departmentId?: string,
    @Query('level') level?: number,
    @Query('semester') semester?: string,
  ) {
    return this.academicsService.listCourses(user.schoolId, query, {
      departmentId,
      level,
      semester,
    });
  }

  @Get('courses/:id')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  getCourse(@Param('id') id: string) {
    return this.academicsService.getCourse(id);
  }

  @Post('courses')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  createCourse(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
  ) {
    return this.academicsService.createCourse(user.schoolId, data);
  }

  @Put('courses/:id')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  updateCourse(@Param('id') id: string, @Body() data: Record<string, any>) {
    return this.academicsService.updateCourse(id, data);
  }

  @Delete('courses/:id')
  @Roles('SCHOOL_ADMIN')
  deleteCourse(@Param('id') id: string) {
    return this.academicsService.deleteCourse(id);
  }

  // ---- Course allocation ----
  @Get('courses/:id/allocations')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  listAllocations(@Param('id') courseId: string) {
    return this.academicsService.listAllocations(courseId);
  }

  @Post('course-allocations')
  @Roles('SCHOOL_ADMIN')
  allocateCourse(
    @Body() data: { courseId: string; staffId: string; sessionId?: string },
  ) {
    return this.academicsService.allocateCourse(data);
  }

  @Put('courses/:id/allocation')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  updateCourseAllocation(
    @Param('id') courseId: string,
    @Body() data: { staffId: string },
  ) {
    return this.academicsService.updateCourseAllocation(courseId, data.staffId);
  }
}
