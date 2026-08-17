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
import { IdCardsService } from './id-cards.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('id-cards')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IdCardsController {
  constructor(private readonly idCardsService: IdCardsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'SCHOOL_ADMIN')
  generate(
    @CurrentUser() user: SessionUser,
    @Body() data: { type: 'STUDENT' | 'STAFF'; studentId?: string; staffId?: string },
  ) {
    return this.idCardsService.generate(user.schoolId, data);
  }

  @Post('batch')
  @Roles('SUPER_ADMIN', 'SCHOOL_ADMIN')
  batchGenerate(
    @CurrentUser() user: SessionUser,
    @Body() data: { type: 'STUDENT' | 'STAFF'; studentIds?: string[]; staffIds?: string[] },
  ) {
    return this.idCardsService.batchGenerate(user.schoolId, data);
  }

  @Get('status')
  @Roles('SUPER_ADMIN', 'SCHOOL_ADMIN')
  statusMap(@CurrentUser() user: SessionUser) {
    return this.idCardsService.getStatusMap(user.schoolId);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'SCHOOL_ADMIN')
  list(
    @CurrentUser() user: SessionUser,
    @Query('type') type?: string,
  ) {
    return this.idCardsService.list(user.schoolId, type);
  }

  /** Public verification endpoint for scanning / portal lookup. */
  @Public()
  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.idCardsService.verify(code);
  }

  @Patch(':id/revoke')
  @Roles('SUPER_ADMIN', 'SCHOOL_ADMIN')
  revoke(@Param('id') id: string) {
    return this.idCardsService.revoke(id);
  }
}
