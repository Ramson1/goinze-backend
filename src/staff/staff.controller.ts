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
import type { SessionUser } from '../../lib/types';
import { StaffService } from './staff.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  findAll(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
    @Query('departmentId') departmentId?: string,
    @Query('isLecturer') isLecturer?: string,
    @Query('staffCategory') staffCategory?: string,
  ) {
    return this.staffService.findAll(user.schoolId, query, departmentId, isLecturer, staffCategory);
  }

  /** Public staff directory for the school website (privacy-friendly fields only). */
  @Public()
  @Roles()
  @Get('directory')
  directory(@Query('schoolId') schoolId?: string) {
    return this.staffService.directory(schoolId ?? null);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staffService.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() data: Record<string, any>) {
    return this.staffService.create(user.schoolId, data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: Record<string, any>) {
    return this.staffService.update(id, data);
  }

  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.staffService.toggleActive(id);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.staffService.remove(id);
  }
}
