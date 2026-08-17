import { Controller, Get, UseGuards } from '@nestjs/common';
import type { SessionUser } from '../../../lib/types';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'ACCOUNTANT', 'ADMISSION_OFFICER')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('students')
  students(@CurrentUser() user: SessionUser) {
    return this.reportsService.studentsReport(user.schoolId);
  }

  @Get('admissions')
  admissions(@CurrentUser() user: SessionUser) {
    return this.reportsService.admissionsReport(user.schoolId);
  }

  @Get('payments')
  payments(@CurrentUser() user: SessionUser) {
    return this.reportsService.paymentsReport(user.schoolId);
  }

  @Get('results')
  results(@CurrentUser() user: SessionUser) {
    return this.reportsService.resultsReport(user.schoolId);
  }

  @Get('attendance')
  attendance(@CurrentUser() user: SessionUser) {
    return this.reportsService.attendanceReport(user.schoolId);
  }
}
