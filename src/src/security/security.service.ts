import { Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';

/**
 * Security: audit logs, login history and permission management.
 */
@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Audit logs ----
  async listAuditLogs(
    schoolId: string | null,
    query: PaginationDto,
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {
      user: {
        role: {
          not: 'SUPER_ADMIN',
        },
      },
    };
    if (schoolId) where.schoolId = schoolId;
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { entity: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.auditLog, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { user: { select: { id: true, email: true } } },
    });
  }

  /** Record an audit log entry. */
  log(data: {
    schoolId?: string | null;
    userId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    metadata?: any;
    ipAddress?: string;
  }) {
    return this.prisma.db.auditLog.create({
      data: {
        schoolId: data.schoolId ?? undefined,
        userId: data.userId,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        metadata: data.metadata,
        ipAddress: data.ipAddress,
      },
    });
  }

  // ---- Login history ----
  listLoginHistory(userId: string) {
    return this.prisma.db.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---- Permissions ----
  listPermissions() {
    return this.prisma.db.permission.findMany({ orderBy: { key: 'asc' } });
  }

  listUserPermissions(userId: string) {
    return this.prisma.db.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });
  }

  /** Grant (or update) a permission for a user. */
  async grantPermission(
    userId: string,
    permissionKey: string,
    granted = true,
  ) {
    let permission = await this.prisma.db.permission.findUnique({
      where: { key: permissionKey },
    });
    if (!permission) {
      permission = await this.prisma.db.permission.create({
        data: { key: permissionKey },
      });
    }

    return this.prisma.db.userPermission.upsert({
      where: {
        userId_permissionId: { userId, permissionId: permission.id },
      },
      create: { userId, permissionId: permission.id, granted },
      update: { granted },
    });
  }
}
