import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { SettingsService } from './settings.service';
import { SecurityService } from '../security/security.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IpAddress } from '../common/decorators/ip-address.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly security: SecurityService,
  ) {}

  @Get()
  getAll(@CurrentUser() user: SessionUser) {
    return this.settingsService.getAll(user.schoolId);
  }

  @Put()
  async updateMany(
    @CurrentUser() user: SessionUser,
    @Body() entries: Record<string, any>,
    @IpAddress() ip: string,
  ) {
    const result = await this.settingsService.updateMany(user.schoolId, entries);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'settings.bulk_updated',
        entity: 'SchoolSetting',
        metadata: { keys: Object.keys(entries) },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Get('profile')
  getProfile(@CurrentUser() user: SessionUser) {
    return this.settingsService.getProfile(user.schoolId);
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: SessionUser,
    @Body() data: Record<string, any>,
    @IpAddress() ip: string,
  ) {
    const result = await this.settingsService.updateProfile(user.schoolId, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'settings.profile_updated',
        entity: 'SchoolProfile',
        metadata: { changedFields: Object.keys(data) },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Patch(':key')
  async upsert(
    @CurrentUser() user: SessionUser,
    @Param('key') key: string,
    @Body() body: { value: any },
    @IpAddress() ip: string,
  ) {
    const result = await this.settingsService.upsert(user.schoolId, key, body.value);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'settings.setting_upserted',
        entity: 'SchoolSetting',
        metadata: { key },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }
}
