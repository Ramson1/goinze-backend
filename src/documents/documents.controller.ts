import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '../../lib/types';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Upload a file to Cloudinary. Returns the hosted URL so the client can
   * persist it against any record (news, gallery, profile logo, etc.).
   */
  @Post('upload')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'LECTURER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: SessionUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided.');
    }
    const result = await this.documentsService.uploadFile(
      file.buffer,
      folder ?? 'goinzeschool',
    );
    return { ...result, uploadedBy: user.id };
  }

  @Post()
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'STUDENT')
  create(
    @CurrentUser() user: SessionUser,
    @Body()
    data: {
      name: string;
      url: string;
      type?: string;
      mimeType?: string;
      sizeBytes?: number;
      studentId?: string;
      applicationId?: string;
    },
  ) {
    return this.documentsService.create(user.schoolId, {
      ...data,
      ownerUserId: data.studentId ? undefined : user.id,
    });
  }

  @Get()
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  list(@CurrentUser() user: SessionUser) {
    return this.documentsService.list(user.schoolId);
  }

  @Get('student/:studentId')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'STUDENT')
  listByStudent(@Param('studentId') studentId: string) {
    return this.documentsService.listByStudent(studentId);
  }

  @Delete(':id')
  @Roles('SCHOOL_ADMIN', 'ADMISSION_OFFICER')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
