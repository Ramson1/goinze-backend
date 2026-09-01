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
import { SystemAdminService } from './system-admin.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('system-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SystemAdminController {
  constructor(private readonly systemAdminService: SystemAdminService) {}

  // ---- Schools ----
  @Get('schools')
  listSchools(@Query() query: PaginationDto) {
    return this.systemAdminService.listSchools(query);
  }

  @Get('schools/:id')
  getSchool(@Param('id') id: string) {
    return this.systemAdminService.getSchool(id);
  }

  @Post('schools')
  createSchool(
    @Body()
    data: {
      name: string;
      code: string;
      slug?: string;
      email?: string;
      phone?: string;
      address?: string;
    },
  ) {
    return this.systemAdminService.createSchool(data);
  }

  @Put('schools/:id')
  updateSchool(@Param('id') id: string, @Body() data: Record<string, any>) {
    return this.systemAdminService.updateSchool(id, data);
  }

  @Delete('schools/:id')
  removeSchool(@Param('id') id: string) {
    return this.systemAdminService.removeSchool(id);
  }

  // ---- Subscriptions ----
  @Get('subscriptions')
  listSubscriptions() {
    return this.systemAdminService.listSubscriptions();
  }

  @Post('subscriptions')
  upsertSubscription(
    @Body()
    data: {
      schoolId: string;
      plan?: string;
      status?: string;
      seats?: number;
      expiresAt?: string;
    },
  ) {
    return this.systemAdminService.upsertSubscription(data);
  }

  // ---- Maintenance toggle ----
  @Patch('schools/:id/maintenance')
  setMaintenance(
    @Param('id') id: string,
    @Body() body: { maintenance: boolean },
  ) {
    return this.systemAdminService.setMaintenance(id, body.maintenance);
  }
}
