import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AlumniService } from './alumni.service';
import { CreateAlumniRegistrationDto } from './dto/alumni-registration.dto';

@Controller('alumni')
export class AlumniController {
  constructor(private readonly alumniService: AlumniService) {}

  @Public()
  @Post('register')
  register(@Body() dto: CreateAlumniRegistrationDto) {
    return this.alumniService.create(dto);
  }

  @Public()
  @Get('approved')
  listApproved() {
    return this.alumniService.listApproved();
  }

  @Get()
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  list(@Query('status') status?: string) {
    return this.alumniService.list(status);
  }

  @Patch(':id/approve')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  approve(@Param('id') id: string) {
    return this.alumniService.approve(id);
  }

  @Patch(':id/decline')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  decline(@Param('id') id: string) {
    return this.alumniService.decline(id);
  }

  @Delete(':id')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  delete(@Param('id') id: string) {
    return this.alumniService.delete(id);
  }
}
