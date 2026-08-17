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
import { CommunicationService } from './communication.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('communication')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  // ---- Announcements ----
  @Public()
  @Get('announcements')
  listAnnouncements(
    @CurrentUser() user: SessionUser | undefined,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.communicationService.listAnnouncements(
      user?.schoolId ?? schoolId ?? null,
    );
  }

  @Post('announcements')
  @Roles('SCHOOL_ADMIN')
  createAnnouncement(
    @CurrentUser() user: SessionUser,
    @Body() data: { title: string; body: string; audience?: string; pinned?: boolean },
  ) {
    return this.communicationService.createAnnouncement(user.schoolId, data);
  }

  @Patch('announcements/:id')
  @Roles('SCHOOL_ADMIN')
  updateAnnouncement(
    @Param('id') id: string,
    @Body() data: { title?: string; body?: string; audience?: string; pinned?: boolean },
  ) {
    return this.communicationService.updateAnnouncement(id, data);
  }

  @Delete('announcements/:id')
  @Roles('SCHOOL_ADMIN')
  deleteAnnouncement(@Param('id') id: string) {
    return this.communicationService.deleteAnnouncement(id);
  }

  // ---- Conversations ----
  @Get('conversations')
  listConversations(@CurrentUser() user: SessionUser) {
    return this.communicationService.listConversations(user.id);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: SessionUser,
    @Body() data: { recipientIds: string[]; title?: string; isGroup?: boolean },
  ) {
    return this.communicationService.createConversation({
      senderId: user.id,
      recipientIds: data.recipientIds,
      title: data.title,
      isGroup: data.isGroup,
    });
  }

  @Get('conversations/:id')
  getConversation(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.communicationService.getConversation(id, user.id);
  }

  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    const conv = await this.communicationService.getConversation(id, user.id);
    return conv.messages;
  }

  @Post('conversations/:id/messages')
  sendMessageInConversation(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() data: { body: string; replyToId?: string },
  ) {
    return this.communicationService.sendMessageInConversation({
      senderId: user.id,
      conversationId: id,
      body: data.body,
      replyToId: data.replyToId,
    });
  }

  @Patch('conversations/:id/read')
  markConversationRead(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.communicationService.markConversationRead(id, user.id);
  }

  // ---- Contacts ----
  @Get('contacts')
  searchContacts(
    @CurrentUser() user: SessionUser,
    @Query('q') q?: string,
    @Query('role') role?: string,
  ) {
    return this.communicationService.searchContacts(user.id, q, role);
  }

  // ---- Messages (edit/delete) ----
  @Patch('messages/:id')
  editMessage(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Body() data: { body: string },
  ) {
    return this.communicationService.editMessage(id, user.id, data.body);
  }

  @Delete('messages/:id')
  deleteMessage(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.communicationService.deleteMessage(id, user.id);
  }

  // ---- Legacy Messages (backward compat) ----
  @Get('messages')
  listMessages(@CurrentUser() user: SessionUser) {
    return this.communicationService.listMessages(user.id);
  }

  @Post('messages')
  sendMessage(
    @CurrentUser() user: SessionUser,
    @Body() data: { recipientId?: string; subject?: string; body: string },
  ) {
    return this.communicationService.sendMessage({
      senderId: user.id,
      recipientId: data.recipientId,
      subject: data.subject,
      body: data.body,
    });
  }

  @Patch('messages/:id/read')
  markMessageRead(@Param('id') id: string) {
    return this.communicationService.markMessageRead(id);
  }

  // ---- Notifications ----
  @Get('notifications')
  listNotifications(@CurrentUser() user: SessionUser) {
    return this.communicationService.listNotifications(user.id);
  }

  @Post('notifications')
  @Roles('SCHOOL_ADMIN')
  createNotification(
    @CurrentUser() user: SessionUser,
    @Body() data: { userId?: string; title: string; body: string; channel?: string },
  ) {
    return this.communicationService.createNotification({
      schoolId: user.schoolId,
      userId: data.userId,
      title: data.title,
      body: data.body,
      channel: data.channel,
    });
  }

  @Patch('notifications/:id/read')
  markNotificationRead(@Param('id') id: string) {
    return this.communicationService.markNotificationRead(id);
  }
}
