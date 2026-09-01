import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Communication: announcements, direct messages, conversations, and notifications.
 */
@Injectable()
export class CommunicationService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Announcements ----
  listAnnouncements(schoolId: string | null) {
    return this.prisma.db.announcement.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: 100,
    });
  }

  createAnnouncement(
    schoolId: string | null,
    data: { title: string; body: string; audience?: string; pinned?: boolean },
  ) {
    return this.prisma.db.announcement.create({
      data: {
        schoolId: schoolId ?? '',
        title: data.title,
        body: data.body,
        audience: data.audience ?? 'ALL',
        pinned: data.pinned ?? false,
      },
    });
  }

  async updateAnnouncement(
    id: string,
    data: { title?: string; body?: string; audience?: string; pinned?: boolean },
  ) {
    const announcement = await this.prisma.db.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    const updateData: Record<string, any> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.body !== undefined) updateData.body = data.body;
    if (data.audience !== undefined) updateData.audience = data.audience;
    if (data.pinned !== undefined) updateData.pinned = data.pinned;
    return this.prisma.db.announcement.update({ where: { id }, data: updateData });
  }

  async deleteAnnouncement(id: string) {
    const announcement = await this.prisma.db.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return this.prisma.db.announcement.delete({ where: { id } });
  }

  // ---- Conversations ----

  /** List all conversations for a user with last message preview and unread count */
  async listConversations(userId: string) {
    const participations = await this.prisma.db.conversationParticipant.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            participants: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true, role: true, avatarUrl: true } },
              },
            },
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return participations.map((p) => {
      const conv = p.conversation;
      const lastMessage = conv.messages[0] ?? null;
      // Count unread messages (messages created after participant's lastReadAt)
      const unreadCount = p.lastReadAt
        ? conv.messages.length // simplified — real count would need a separate query
        : 0;

      // Determine display title and other participant's avatar
      let title = conv.title;
      let otherAvatarUrl: string | null = null;
      if (!conv.isGroup) {
        const otherParticipant = conv.participants.find((pt) => pt.userId !== userId);
        if (otherParticipant) {
          if (!title) title = `${otherParticipant.user.firstName} ${otherParticipant.user.lastName}`;
          otherAvatarUrl = otherParticipant.user.avatarUrl ?? null;
        }
      }

      return {
        id: conv.id,
        title,
        otherAvatarUrl,
        isGroup: conv.isGroup,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body,
              senderId: lastMessage.senderId,
              senderName: lastMessage.sender
                ? `${lastMessage.sender.firstName} ${lastMessage.sender.lastName}`
                : null,
              createdAt: lastMessage.createdAt,
            }
          : null,
        participants: conv.participants.map((pt) => ({
          userId: pt.userId,
          user: {
            id: pt.user.id,
            firstName: pt.user.firstName,
            lastName: pt.user.lastName,
            email: pt.user.email,
            role: pt.user.role,
            avatarUrl: pt.user.avatarUrl,
          },
        })),
        lastReadAt: p.lastReadAt,
        updatedAt: conv.updatedAt,
      };
    });
  }

  /** Get a single conversation with its messages */
  async getConversation(conversationId: string, userId: string) {
    const conversation = await this.prisma.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, role: true, avatarUrl: true } },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 200,
          include: {
            sender: { select: { id: true, firstName: true, lastName: true } },
            replyTo: {
              where: { deletedAt: null },
              select: {
                id: true,
                body: true,
                sender: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    // Verify user is a participant
    const isParticipant = conversation.participants.some((p) => p.userId === userId);
    if (!isParticipant) throw new ForbiddenException('You are not a participant in this conversation');

    // Determine display title
    let title = conversation.title;
    if (!title && !conversation.isGroup) {
      const other = conversation.participants.find((p) => p.userId !== userId);
      if (other) {
        title = `${other.user.firstName} ${other.user.lastName}`;
      }
    }

    return {
      id: conversation.id,
      title,
      isGroup: conversation.isGroup,
      participants: conversation.participants.map((p) => ({
        userId: p.userId,
        user: {
          id: p.user.id,
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          email: p.user.email,
          role: p.user.role,
          avatarUrl: p.user.avatarUrl,
        },
      })),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        sender: m.sender ? { id: m.sender.id, firstName: m.sender.firstName, lastName: m.sender.lastName } : null,
        body: m.body,
        replyTo: m.replyTo
          ? {
              id: m.replyTo.id,
              body: m.replyTo.body,
              sender: m.replyTo.sender
                ? { id: m.replyTo.sender.id, firstName: m.replyTo.sender.firstName, lastName: m.replyTo.sender.lastName }
                : null,
            }
          : null,
        editedAt: m.editedAt,
        createdAt: m.createdAt,
      })),
    };
  }

  /** Create a new conversation with participants */
  async createConversation(data: {
    senderId: string;
    recipientIds: string[];
    title?: string;
    isGroup?: boolean;
  }) {
    const allParticipantIds = [...new Set([data.senderId, ...data.recipientIds])];
    const isGroup = data.isGroup ?? allParticipantIds.length > 2;

    // For 1-to-1, check if conversation already exists
    if (!isGroup && allParticipantIds.length === 2) {
      const existing = await this.findExistingDirectConversation(
        allParticipantIds[0],
        allParticipantIds[1],
      );
      if (existing) return this.getConversation(existing.id, data.senderId);
    }

    const conversation = await this.prisma.db.conversation.create({
      data: {
        title: data.title ?? null,
        isGroup,
        participants: {
          create: allParticipantIds.map((uid) => ({
            userId: uid,
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, role: true, avatarUrl: true } },
          },
        },
      },
    });

    return {
      id: conversation.id,
      title: conversation.title ?? (conversation.isGroup
        ? 'Group Conversation'
        : conversation.participants.find((p) => p.userId !== data.senderId)?.user
          ? `${conversation.participants.find((p) => p.userId !== data.senderId)!.user.firstName} ${conversation.participants.find((p) => p.userId !== data.senderId)!.user.lastName}`
          : null),
      isGroup: conversation.isGroup,
      participants: conversation.participants.map((p) => ({
        userId: p.userId,
        user: {
          id: p.user.id,
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          email: p.user.email,
          role: p.user.role,
          avatarUrl: p.user.avatarUrl,
        },
      })),
      messages: [],
    };
  }

  /** Find existing direct (non-group) conversation between two users */
  private async findExistingDirectConversation(userId1: string, userId2: string) {
    return this.prisma.db.conversation.findFirst({
      where: {
        isGroup: false,
        participants: {
          every: {
            userId: { in: [userId1, userId2] },
          },
        },
      },
    });
  }

  /** Send a message within a conversation */
  async sendMessageInConversation(data: {
    senderId: string;
    conversationId: string;
    body: string;
    replyToId?: string;
  }) {
    // Verify sender is a participant
    const participant = await this.prisma.db.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: data.conversationId,
          userId: data.senderId,
        },
      },
    });
    if (!participant) throw new ForbiddenException('You are not a participant in this conversation');

    const message = await this.prisma.db.message.create({
      data: {
        senderId: data.senderId,
        conversationId: data.conversationId,
        body: data.body,
        replyToId: data.replyToId ?? null,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
        replyTo: {
          select: {
            id: true,
            body: true,
            sender: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    // Update conversation updatedAt
    await this.prisma.db.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });

    // Notify other participants about the new message (fire-and-forget)
    this.prisma.db.conversationParticipant
      .findMany({
        where: { conversationId: data.conversationId, userId: { not: data.senderId } },
        select: { userId: true },
      })
      .then((participants) => {
        const recipientIds = participants.map((p) => p.userId);
        if (recipientIds.length > 0) {
          const senderName = message.sender
            ? `${message.sender.firstName} ${message.sender.lastName}`
            : 'Someone';
          return this.notifyUsers(
            recipientIds,
            'New Message',
            `${senderName}: ${data.body.length > 80 ? data.body.slice(0, 80) + '…' : data.body}`,
            { conversationId: data.conversationId, messageId: message.id },
          );
        }
      })
      .catch(() => {});

    return {
      id: message.id,
      senderId: message.senderId,
      sender: message.sender
        ? { id: message.sender.id, firstName: message.sender.firstName, lastName: message.sender.lastName }
        : null,
      body: message.body,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            body: message.replyTo.body,
            sender: message.replyTo.sender
              ? { id: message.replyTo.sender.id, firstName: message.replyTo.sender.firstName, lastName: message.replyTo.sender.lastName }
              : null,
          }
        : null,
      editedAt: message.editedAt,
      createdAt: message.createdAt,
    };
  }

  /** Edit a message (only by sender) */
  async editMessage(messageId: string, userId: string, newBody: string) {
    const message = await this.prisma.db.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only edit your own messages');
    if (message.deletedAt) throw new ForbiddenException('Cannot edit a deleted message');

    const updated = await this.prisma.db.message.update({
      where: { id: messageId },
      data: { body: newBody, editedAt: new Date() },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return {
      id: updated.id,
      senderId: updated.senderId,
      sender: updated.sender
        ? { id: updated.sender.id, firstName: updated.sender.firstName, lastName: updated.sender.lastName }
        : null,
      body: updated.body,
      editedAt: updated.editedAt,
      createdAt: updated.createdAt,
    };
  }

  /** Soft delete a message (only by sender) */
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.db.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own messages');

    await this.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: 'This message was deleted' },
    });

    return { success: true };
  }

  /** Mark all messages in a conversation as read for a participant */
  async markConversationRead(conversationId: string, userId: string) {
    await this.prisma.db.conversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: { lastReadAt: new Date() },
    });
    return { success: true };
  }

  // ---- Legacy Messages (backward compat) ----
  listMessages(userId: string) {
    return this.prisma.db.message.findMany({
      where: { recipientId: userId },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  sendMessage(data: {
    senderId: string;
    recipientId?: string;
    subject?: string;
    body: string;
  }) {
    return this.prisma.db.message.create({
      data: {
        senderId: data.senderId,
        recipientId: data.recipientId,
        subject: data.subject,
        body: data.body,
      },
    });
  }

  async markMessageRead(id: string) {
    const message = await this.prisma.db.message.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    return this.prisma.db.message.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  // ---- Contacts ----

  /** Search users that the current user can message */
  async searchContacts(userId: string, query?: string, roleFilter?: string) {
    // Get current user to determine their role
    const currentUser = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { role: true, schoolId: true, student: { select: { departmentId: true } } },
    });
    if (!currentUser) throw new NotFoundException('User not found');

    const where: any = {
      id: { not: userId }, // Exclude self
      schoolId: currentUser.schoolId,
    };

    if (query) {
      where.OR = [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (roleFilter) {
      where.role = roleFilter;
    }

    const users = await this.prisma.db.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        avatarUrl: true,
        student: { select: { matricNumber: true, department: { select: { name: true } } } },
        staff: { select: { department: { select: { name: true } } } },
      },
      take: 50,
      orderBy: { firstName: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl ?? null,
      department: u.student?.department?.name ?? u.staff?.department?.name ?? null,
    }));
  }

  // ---- Notifications ----
  listNotifications(userId: string) {
    return this.prisma.db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  createNotification(data: {
    schoolId?: string | null;
    userId?: string;
    title: string;
    body: string;
    channel?: string;
    metadata?: any;
  }) {
    return this.prisma.db.notification.create({
      data: {
        schoolId: data.schoolId ?? undefined,
        userId: data.userId,
        title: data.title,
        body: data.body,
        channel: (data.channel as any) ?? 'IN_APP',
        status: 'QUEUED',
        metadata: data.metadata ?? undefined,
      },
    });
  }

  async markNotificationRead(id: string) {
    const notification = await this.prisma.db.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.db.notification.update({
      where: { id },
      data: { status: 'READ' },
    });
  }

  // ---- Notification Helpers (for automated triggers) ----

  /** Create a notification for a single user */
  async notifyUser(userId: string, title: string, body: string, metadata?: any) {
    return this.prisma.db.notification.create({
      data: {
        userId,
        title,
        body,
        channel: 'IN_APP',
        status: 'QUEUED',
        metadata: metadata ?? undefined,
      },
    });
  }

  /** Create notifications for multiple users at once */
  async notifyUsers(userIds: string[], title: string, body: string, metadata?: any) {
    if (userIds.length === 0) return;
    return this.prisma.db.notification.createMany({
      data: userIds.map((uid) => ({
        userId: uid,
        title,
        body,
        channel: 'IN_APP' as any,
        status: 'QUEUED' as any,
        metadata: metadata ?? undefined,
      })),
    });
  }

  /** Find all users with a specific role in a school and notify them */
  async notifyUsersByRole(schoolId: string, role: string, title: string, body: string, metadata?: any) {
    const users = await this.prisma.db.user.findMany({
      where: { schoolId, role: role as any },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      return this.notifyUsers(userIds, title, body, metadata);
    }
  }

  /** Find students in a specific department and notify them */
  async notifyStudentsByDepartment(
    schoolId: string,
    departmentId: string,
    title: string,
    body: string,
    metadata?: any,
  ) {
    const students = await this.prisma.db.student.findMany({
      where: { schoolId, departmentId },
      select: { userId: true },
    });
    const userIds = students.map((s) => s.userId).filter(Boolean) as string[];
    if (userIds.length > 0) {
      return this.notifyUsers(userIds, title, body, metadata);
    }
  }
}
