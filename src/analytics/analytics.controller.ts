import { Controller, Get, UseGuards } from '@nestjs/common';
import type { SessionUser } from '../lib/types';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: SessionUser) {
    return this.analyticsService.dashboard(user.schoolId);
  }

  @Get('admissions-trend')
  admissionsTrend(@CurrentUser() user: SessionUser) {
    return this.analyticsService.admissionsTrend(user.schoolId);
  }

  @Get('revenue')
  revenue(@CurrentUser() user: SessionUser) {
    return this.analyticsService.revenueBreakdown(user.schoolId);
  }

  @Get('revenue-by-month')
  revenueByMonth(@CurrentUser() user: SessionUser) {
    return this.analyticsService.revenueByMonth(user.schoolId);
  }

  @Get('admissions-by-month')
  admissionsByMonth(@CurrentUser() user: SessionUser) {
    return this.analyticsService.admissionsByMonth(user.schoolId);
  }

  @Get('enrollment-by-department')
  enrollmentByDepartment(@CurrentUser() user: SessionUser) {
    return this.analyticsService.enrollmentByDepartment(user.schoolId);
  }

  @Get('gender-distribution')
  genderDistribution(@CurrentUser() user: SessionUser) {
    return this.analyticsService.genderDistribution(user.schoolId);
  }

  @Get('payment-methods')
  paymentMethods(@CurrentUser() user: SessionUser) {
    return this.analyticsService.paymentMethods(user.schoolId);
  }

  @Get('staff-by-department')
  staffByDepartment(@CurrentUser() user: SessionUser) {
    return this.analyticsService.staffByDepartment(user.schoolId);
  }

  @Get('staff-by-category')
  staffByCategory(@CurrentUser() user: SessionUser) {
    return this.analyticsService.staffByCategory(user.schoolId);
  }

  @Get('staff-breakdown')
  staffBreakdown(@CurrentUser() user: SessionUser) {
    return this.analyticsService.staffBreakdown(user.schoolId);
  }

  @Get('student-staff-ratio')
  studentStaffRatio(@CurrentUser() user: SessionUser) {
    return this.analyticsService.studentStaffRatio(user.schoolId);
  }

  @Get('payment-status-breakdown')
  paymentStatusBreakdown(@CurrentUser() user: SessionUser) {
    return this.analyticsService.paymentStatusBreakdown(user.schoolId);
  }

  @Get('enrollment-trend')
  enrollmentTrend(@CurrentUser() user: SessionUser) {
    return this.analyticsService.enrollmentTrend(user.schoolId);
  }

  @Get('programme-enrollment')
  programmeEnrollment(@CurrentUser() user: SessionUser) {
    return this.analyticsService.programmeEnrollment(user.schoolId);
  }
}
