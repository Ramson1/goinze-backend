import { Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '../../../lib/types';
import { slugify } from '../../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';

/**
 * System administration (platform-level, SUPER_ADMIN only): schools CRUD,
 * subscriptions and maintenance/health toggles.
 */
@Injectable()
export class SystemAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Schools ----
  async listSchools(query: PaginationDto): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.school, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { subscription: true },
    });
  }

  async getSchool(id: string) {
    const school = await this.prisma.db.school.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!school) throw new NotFoundException('School not found');
    return school;
  }

  createSchool(data: {
    name: string;
    code: string;
    slug?: string;
    email?: string;
    phone?: string;
    address?: string;
  }) {
    return this.prisma.db.school.create({
      data: {
        name: data.name,
        code: data.code,
        slug: data.slug ?? slugify(data.name),
        email: data.email,
        phone: data.phone,
        address: data.address,
      },
    });
  }

  async updateSchool(id: string, data: Record<string, any>) {
    await this.getSchool(id);
    return this.prisma.db.school.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        slug: data.slug,
        email: data.email,
        phone: data.phone,
        address: data.address,
        logoUrl: data.logoUrl,
        primaryColor: data.primaryColor,
        website: data.website,
        isActive: data.isActive,
      },
    });
  }

  async removeSchool(id: string) {
    await this.getSchool(id);
    return this.prisma.db.school.delete({ where: { id } });
  }

  // ---- Subscriptions ----
  listSubscriptions() {
    return this.prisma.db.subscription.findMany({
      include: { school: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  upsertSubscription(data: {
    schoolId: string;
    plan?: string;
    status?: string;
    seats?: number;
    expiresAt?: string;
  }) {
    return this.prisma.db.subscription.upsert({
      where: { schoolId: data.schoolId },
      create: {
        schoolId: data.schoolId,
        plan: (data.plan as any) ?? 'TRIAL',
        status: (data.status as any) ?? 'ACTIVE',
        seats: data.seats ?? 50,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      update: {
        plan: data.plan as any,
        status: data.status as any,
        seats: data.seats,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  }

  // ---- Maintenance toggle ----
  async setMaintenance(id: string, maintenance: boolean) {
    await this.getSchool(id);
    return this.prisma.db.school.update({
      where: { id },
      data: { maintenance },
    });
  }
}
