import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../lib/types';
import { StudentsService } from './students.service';
import {
  CreateStudentDto,
  UpdateStudentDto,
  ImportStudentsDto,
} from './dto/student.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'LECTURER')
  findAll(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('level') level?: string,
  ) {
    return this.studentsService.findAll(
      user.schoolId,
      query,
      status,
      departmentId,
      level ? Number(level) : undefined,
    );
  }

  @Get('pending-approvals')
  @Roles('SCHOOL_ADMIN')
  pendingApprovals(@CurrentUser() user: SessionUser) {
    return this.studentsService.findPendingApprovals(user.schoolId);
  }

  @Get('pending-approvals/unlinked')
  @Roles('SCHOOL_ADMIN')
  pendingUnlinked(@CurrentUser() user: SessionUser) {
    return this.studentsService.findUnlinkedPendingUsers(user.schoolId);
  }

  @Post('approve-user/:userId')
  @Roles('SCHOOL_ADMIN')
  approveUnlinkedUser(@Param('userId') userId: string, @CurrentUser() user: SessionUser) {
    return this.studentsService.approveUnlinkedUser(userId, user.schoolId);
  }

  @Post('decline-user/:userId')
  @Roles('SCHOOL_ADMIN')
  declineUnlinkedUser(@Param('userId') userId: string, @CurrentUser() user: SessionUser) {
    return this.studentsService.declineUnlinkedUser(userId, user.schoolId);
  }

  @Get(':id')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'LECTURER', 'STUDENT')
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Post()
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  create(@CurrentUser() user: SessionUser, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(user.schoolId, dto);
  }

  @Post('import')
  @Roles('SCHOOL_ADMIN')
  importStudents(
    @CurrentUser() user: SessionUser,
    @Body() dto: ImportStudentsDto,
  ) {
    return this.studentsService.import(user.schoolId, dto);
  }

  @Post('promote')
  @Roles('SCHOOL_ADMIN')
  promoteAll(@CurrentUser() user: SessionUser) {
    return this.studentsService.promoteAll(user.schoolId);
  }

  @Post('graduate-all')
  @Roles('SCHOOL_ADMIN')
  graduateAll(@CurrentUser() user: SessionUser) {
    return this.studentsService.graduateAllFinalYear(user.schoolId);
  }

  @Patch(':id')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.studentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SCHOOL_ADMIN')
  remove(@Param('id') id: string) {
    return this.studentsService.remove(id);
  }

  @Patch(':id/suspend')
  @Roles('SCHOOL_ADMIN')
  suspend(@Param('id') id: string) {
    return this.studentsService.suspend(id);
  }

  @Patch(':id/graduate')
  @Roles('SCHOOL_ADMIN')
  graduate(@Param('id') id: string) {
    return this.studentsService.graduate(id);
  }

  @Patch(':id/archive')
  @Roles('SCHOOL_ADMIN')
  archive(@Param('id') id: string) {
    return this.studentsService.archive(id);
  }

  @Post(':id/reset-password')
  @Roles('SCHOOL_ADMIN')
  resetPassword(@Param('id') id: string) {
    return this.studentsService.resetTempPassword(id);
  }

  @Patch(':id/approve-portal')
  @Roles('SCHOOL_ADMIN')
  approvePortal(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.studentsService.approvePortalAccount(id, user.schoolId);
  }

  @Patch(':id/decline-portal')
  @Roles('SCHOOL_ADMIN')
  declinePortal(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.studentsService.declinePortalAccount(id, user.schoolId);
  }
}
