import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '../../lib/types';
import { AdmissionsService } from './admissions.service';
import { ApplyDto, ReviewApplicationDto, ApproveApplicationDto, UpdateVerificationDto } from './dto/admission.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CloudinaryService } from '../common/utils/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdmissionsController {
  constructor(
    private readonly admissionsService: AdmissionsService,
    private readonly cloudinary: CloudinaryService,
    private readonly prisma: PrismaService,
  ) {}

  /** Public application form submission. */
  @Public()
  @Post('apply')
  apply(@Body() dto: ApplyDto) {
    return this.admissionsService.apply(null, dto);
  }

  /** Public status lookup for applicants (applicationNo + email). */
  @Public()
  @Get('track')
  track(@Query('applicationNo') applicationNo: string, @Query('email') email: string) {
    return this.admissionsService.trackStatus(applicationNo, email);
  }

  @Get()
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  findAll(
    @CurrentUser() user: SessionUser,
    @Query() query: PaginationDto,
    @Query('status') status?: string,
  ) {
    return this.admissionsService.findAll(user.schoolId, query, status);
  }

  @Get(':id')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  findOne(@Param('id') id: string) {
    return this.admissionsService.findOne(id);
  }

  @Patch(':id/review')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  review(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() dto: ReviewApplicationDto,
  ) {
    return this.admissionsService.review(id, user.id, dto);
  }

  @Patch(':id/approve')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() dto: ApproveApplicationDto,
  ) {
    return this.admissionsService.approve(id, user.id, dto);
  }

  /** Finalize onboarding once the acceptance fee is paid. */
  @Patch(':id/admit')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  admit(@Param('id') id: string) {
    return this.admissionsService.admit(id);
  }

  @Post(':id/letter')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  generateLetter(@Param('id') id: string) {
    return this.admissionsService.generateLetter(id);
  }

  @Post(':id/send-letter')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  sendLetterEmail(@Param('id') id: string) {
    return this.admissionsService.sendLetterEmail(id);
  }

  @Post(':id/create-password')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  createStudentPassword(@Param('id') id: string) {
    return this.admissionsService.createStudentPassword(id);
  }

  @Patch(':id/verification')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  updateVerification(
    @Param('id') id: string,
    @Body() dto: UpdateVerificationDto,
  ) {
    return this.admissionsService.updateVerification(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.admissionsService.remove(id);
  }

  /** Public document upload for applications — uploads to Cloudinary and links to the application. */
  @Public()
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadApplicationDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { type?: string },
  ) {
    if (!file) throw new BadRequestException('No file provided.');
    const application = await this.admissionsService.findOne(id);
    const result = await this.cloudinary.uploadImage(file.buffer, 'goinzeschool/applications');
    const document = await this.prisma.db.document.create({
      data: {
        schoolId: application.schoolId,
        name: file.originalname,
        url: result.url,
        type: (body.type as any) ?? 'OTHER',
        mimeType: file.mimetype,
        sizeBytes: file.size,
        applicationId: id,
      },
    });
    return document;
  }
}
