import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Communication: announcements, direct messages, conversations, and notifications.
 */
@Injectable()
export class CommunicationService {
  private readonly logger = new Logger(CommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

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

  // ---- Bulk Email (Email Blast) ----

  /**
   * Resolve recipient email addresses based on group selection and/or explicit user IDs.
   */
  async resolveEmailRecipients(
    schoolId: string | null,
    groups: string[],
    specificUserIds?: string[],
  ): Promise<{ email: string; name: string }[]> {
    const where: any = {};
    if (schoolId) where.schoolId = schoolId;

    const recipients: { email: string; name: string }[] = [];
    const seen = new Set<string>();

    const addUsers = (users: { email: string; firstName: string; lastName: string }[]) => {
      for (const u of users) {
        if (!seen.has(u.email)) {
          seen.add(u.email);
          recipients.push({ email: u.email, name: `${u.firstName} ${u.lastName}` });
        }
      }
    };

    if (groups.includes('ALL_STUDENTS')) {
      const students = await this.prisma.db.user.findMany({
        where: { ...where, role: 'STUDENT' },
        select: { email: true, firstName: true, lastName: true },
      });
      addUsers(students);
    }

    if (groups.includes('ALL_STAFF') || groups.includes('ALL_LECTURERS')) {
      if (groups.includes('ALL_LECTURERS') && !groups.includes('ALL_STAFF')) {
        // Only lecturers
        const staff = await this.prisma.db.user.findMany({
          where: { ...where, role: 'LECTURER' },
          select: { email: true, firstName: true, lastName: true },
        });
        addUsers(staff);
      } else {
        // ALL_STAFF — all staff-role users
        const staff = await this.prisma.db.user.findMany({
          where: { ...where, OR: [{ role: 'LECTURER' }, { role: 'SCHOOL_ADMIN' }, { role: 'ADMISSION_OFFICER' }, { role: 'ACCOUNTANT' }] },
          select: { email: true, firstName: true, lastName: true },
        });
        addUsers(staff);
      }
    }

    if (specificUserIds && specificUserIds.length > 0) {
      const users = await this.prisma.db.user.findMany({
        where: { id: { in: specificUserIds } },
        select: { email: true, firstName: true, lastName: true },
      });
      addUsers(users);
    }

    return recipients;
  }

  /**
   * Send a school-branded bulk email to resolved recipients.
   */
  async sendBulkEmail(
    schoolId: string | null,
    data: {
      subject: string;
      body: string;
      groups: string[];
      specificUserIds?: string[];
    },
  ) {
    // Resolve school info for branding
    let schoolName = 'Goinze International School';
    let schoolLogoUrl = '';
    let schoolEmail = '';
    if (schoolId) {
      const school = await this.prisma.db.school.findUnique({ where: { id: schoolId } });
      if (school) {
        schoolName = school.name;
        schoolLogoUrl = school.logoUrl ?? '';
        schoolEmail = school.email ?? '';
      }
    }

    const recipients = await this.resolveEmailRecipients(
      schoolId,
      data.groups,
      data.specificUserIds,
    );

    if (recipients.length === 0) {
      return { sent: 0, failed: 0, total: 0, message: 'No recipients found for the selected criteria.' };
    }

    const emailHtml = this.renderBulkEmailHtml({
      schoolName,
      schoolLogoUrl,
      schoolEmail,
      body: data.body,
    });

    let sent = 0;
    let failed = 0;

    // Send individually so each recipient gets a personalised feel
    for (const r of recipients) {
      try {
        await this.mail.sendEmail(r.email, data.subject, emailHtml);
        sent++;
      } catch (err) {
        this.logger.error(`Failed to send email to ${r.email}`, err instanceof Error ? err.message : '');
        failed++;
      }
    }

    return { sent, failed, total: recipients.length };
  }

  /**
   * Render a school-branded HTML email template for bulk emails.
   */
  private renderBulkEmailHtml(d: {
    schoolName: string;
    schoolLogoUrl: string;
    schoolEmail: string;
    body: string;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoUrl = d.schoolLogoUrl || logoFallback;
    return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f766e);padding:28px 32px;text-align:center;">
      <img src="${logoUrl}" alt="${d.schoolName}" style="max-height:56px;margin:0 auto 12px;display:block;border-radius:8px;" />
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;letter-spacing:.3px;">${d.schoolName}</h1>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      ${d.body}
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">${d.schoolName}${d.schoolEmail ? ` &middot; <a href="mailto:${d.schoolEmail}" style="color:#0f766e;">${d.schoolEmail}</a>` : ''}</p>
      <p style="margin:0;font-size:11px;color:#94a3b8;">This is an official email from ${d.schoolName}. If you believe you received this in error, please contact the administration office.</p>
    </div>
  </div>
</body>
</html>`;
  }
}
