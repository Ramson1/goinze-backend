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
import { WebsiteCmsService } from './website-cms.service';
import { SecurityService } from '../security/security.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IpAddress } from '../common/decorators/ip-address.decorator';

@Controller('website')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebsiteCmsController {
  constructor(
    private readonly websiteCmsService: WebsiteCmsService,
    private readonly security: SecurityService,
  ) {}

  // ---- Website content ----
  @Public()
  @Get('content')
  listContent(@Query('schoolId') schoolId?: string) {
    return this.websiteCmsService.listContent(schoolId ?? null);
  }

  @Post('content')
  @Roles('SCHOOL_ADMIN')
  async upsertContent(
    @CurrentUser() user: SessionUser,
    @Body() data: { key: string; title?: string; body?: any },
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.upsertContent(user.schoolId, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.content_upserted',
        entity: 'WebsiteContent',
        entityId: result.id,
        metadata: { key: data.key, title: data.title },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Delete('content/:key')
  @Roles('SCHOOL_ADMIN')
  async deleteContent(
    @CurrentUser() user: SessionUser,
    @Param('key') key: string,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.deleteContent(user.schoolId, key);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.content_deleted',
        entity: 'WebsiteContent',
        metadata: { key },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  // ---- News ----
  @Public()
  @Get('news')
  listNews(@Query('schoolId') schoolId?: string) {
    return this.websiteCmsService.listNews(schoolId ?? null, true);
  }

  @Get('news/manage')
  @Roles('SCHOOL_ADMIN')
  listAllNews(@CurrentUser() user: SessionUser) {
    return this.websiteCmsService.listNews(user.schoolId, false);
  }

  @Public()
  @Get('news/:slug')
  getNews(@Param('slug') slug: string, @Query('schoolId') schoolId?: string) {
    return this.websiteCmsService.getNewsBySlug(schoolId ?? null, slug);
  }

  @Patch('news/:id/publish')
  @Roles('SCHOOL_ADMIN')
  setNewsPublished(
    @Param('id') id: string,
    @Body() data: { published: boolean },
  ) {
    return this.websiteCmsService.setNewsPublished(id, data.published);
  }

  @Post('news')
  @Roles('SCHOOL_ADMIN')
  async createNews(
    @CurrentUser() user: SessionUser,
    @Body()
    data: {
      title: string;
      body: string;
      category?: string;
      excerpt?: string;
      coverUrl?: string;
      published?: boolean;
    },
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.createNews(user.schoolId, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.news_created',
        entity: 'NewsPost',
        entityId: result.id,
        metadata: { title: data.title, category: data.category },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Patch('news/:id')
  @Roles('SCHOOL_ADMIN')
  async updateNews(
    @Param('id') id: string,
    @Body()
    data: {
      title?: string;
      body?: string;
      category?: string;
      excerpt?: string;
      coverUrl?: string;
      published?: boolean;
    },
    @CurrentUser() user: SessionUser,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.updateNews(id, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.news_updated',
        entity: 'NewsPost',
        entityId: id,
        metadata: { changedFields: Object.keys(data) },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Delete('news/:id')
  @Roles('SCHOOL_ADMIN')
  async deleteNews(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.deleteNews(id);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.news_deleted',
        entity: 'NewsPost',
        entityId: id,
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  // ---- Comments ----
  @Public()
  @Get('news/:id/comments')
  listComments(@Param('id') newsPostId: string) {
    return this.websiteCmsService.listComments(newsPostId);
  }

  @Public()
  @Post('news/:id/comments')
  createComment(
    @Param('id') newsPostId: string,
    @Body() data: { name: string; text: string },
  ) {
    return this.websiteCmsService.createComment(newsPostId, data);
  }

  @Patch('comments/:id')
  @Roles('SCHOOL_ADMIN')
  updateComment(
    @Param('id') id: string,
    @Body() data: { name?: string; text?: string },
  ) {
    return this.websiteCmsService.updateComment(id, data);
  }

  @Delete('comments/:id')
  @Roles('SCHOOL_ADMIN')
  deleteComment(@Param('id') id: string) {
    return this.websiteCmsService.deleteComment(id);
  }

  // ---- Events ----
  @Public()
  @Get('events')
  listEvents(@Query('schoolId') schoolId?: string) {
    return this.websiteCmsService.listEvents(schoolId ?? null);
  }

  @Post('events')
  @Roles('SCHOOL_ADMIN')
  async createEvent(
    @CurrentUser() user: SessionUser,
    @Body()
    data: {
      title: string;
      description?: string;
      location?: string;
      startsAt: string;
      endsAt?: string;
      coverUrl?: string;
    },
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.createEvent(user.schoolId, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.event_created',
        entity: 'Event',
        entityId: result.id,
        metadata: { title: data.title },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Patch('events/:id')
  @Roles('SCHOOL_ADMIN')
  async updateEvent(
    @Param('id') id: string,
    @Body()
    data: {
      title?: string;
      description?: string;
      location?: string;
      startsAt?: string;
      endsAt?: string;
      coverUrl?: string;
    },
    @CurrentUser() user: SessionUser,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.updateEvent(id, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.event_updated',
        entity: 'Event',
        entityId: id,
        metadata: { changedFields: Object.keys(data) },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Delete('events/:id')
  @Roles('SCHOOL_ADMIN')
  async deleteEvent(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.deleteEvent(id);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.event_deleted',
        entity: 'Event',
        entityId: id,
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  // ---- Gallery ----
  @Public()
  @Get('gallery')
  listGallery(
    @Query('schoolId') schoolId?: string,
    @Query('album') album?: string,
  ) {
    return this.websiteCmsService.listGallery(schoolId ?? null, album);
  }

  @Post('gallery')
  @Roles('SCHOOL_ADMIN')
  async createGalleryItem(
    @CurrentUser() user: SessionUser,
    @Body() data: { url: string; type?: string; caption?: string; album?: string },
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.createGalleryItem(user.schoolId, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.gallery_item_created',
        entity: 'GalleryItem',
        entityId: result.id,
        metadata: { caption: data.caption, album: data.album },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Patch('gallery/:id')
  @Roles('SCHOOL_ADMIN')
  async updateGalleryItem(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() data: { url?: string; type?: string; caption?: string; album?: string },
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.updateGalleryItem(id, user.schoolId!, data);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.gallery_item_updated',
        entity: 'GalleryItem',
        entityId: result.id,
        metadata: data,
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  @Delete('gallery/:id')
  @Roles('SCHOOL_ADMIN')
  async deleteGalleryItem(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @IpAddress() ip: string,
  ) {
    const result = await this.websiteCmsService.deleteGalleryItem(id, user.schoolId!);
    this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'cms.gallery_item_deleted',
        entity: 'GalleryItem',
        entityId: result.id,
        ipAddress: ip,
      })
      .catch(() => undefined);
    return result;
  }

  // ---- Media upload ----

  @Post('upload')
  @Roles('SCHOOL_ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const result = await this.websiteCmsService.uploadMedia(file.buffer);
    return { url: result.url, publicId: result.publicId };
  }
}
