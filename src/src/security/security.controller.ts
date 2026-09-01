import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../lib/types';
import { SecurityService } from './security.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('audit-logs')
  auditLogs(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
  ) {
    return this.securityService.listAuditLogs(user.schoolId, query);
  }

  @Get('login-history/:userId')
  loginHistory(@Param('userId') userId: string) {
    return this.securityService.listLoginHistory(userId);
  }

  @Get('permissions')
  permissions() {
    return this.securityService.listPermissions();
  }

  @Get('permissions/user/:userId')
  userPermissions(@Param('userId') userId: string) {
    return this.securityService.listUserPermissions(userId);
  }

  @Post('permissions/grant')
  grant(
    @Body() data: { userId: string; permissionKey: string; granted?: boolean },
  ) {
    return this.securityService.grantPermission(
      data.userId,
      data.permissionKey,
      data.granted ?? true,
    );
  }
}
