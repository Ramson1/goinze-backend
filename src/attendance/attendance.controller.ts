import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../../lib/types';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('mark')
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  mark(
    @CurrentUser() user: SessionUser,
    @Body()
    data: {
      courseId?: string;
      date?: string;
      records: { studentId: string; status?: string }[];
    },
  ) {
    return this.attendanceService.markManual(user.schoolId, data);
  }

  @Post('qr')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'LECTURER')
  qrCheckIn(
    @CurrentUser() user: SessionUser,
    @Body() data: { studentId: string; courseId?: string; token?: string },
  ) {
    return this.attendanceService.qrCheckIn(user.schoolId, data);
  }

  @Post('digital-id')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'LECTURER')
  digitalIdCheckIn(
    @CurrentUser() user: SessionUser,
    @Body() data: { studentId: string; cardNumber?: string; courseId?: string },
  ) {
    return this.attendanceService.digitalIdCheckIn(user.schoolId, data);
  }

  @Get()
  @Roles('SCHOOL_ADMIN', 'LECTURER')
  list(
    @CurrentUser() user: SessionUser,
    @Query('studentId') studentId?: string,
    @Query('courseId') courseId?: string,
    @Query('date') date?: string,
  ) {
    return this.attendanceService.list(user.schoolId, {
      studentId,
      courseId,
      date,
    });
  }

  @Get('report/:studentId')
  @Roles('SCHOOL_ADMIN', 'LECTURER', 'STUDENT')
  report(@Param('studentId') studentId: string) {
    return this.attendanceService.reportForStudent(studentId);
  }
}
