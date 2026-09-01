import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Paginated } from '../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    schoolId: string | null,
    query: PaginationDto,
    departmentId?: string,
    isLecturer?: string,
    staffCategory?: string,
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (departmentId) where.departmentId = departmentId;
    if (isLecturer === 'true') where.isLecturer = true;
    if (isLecturer === 'false') where.isLecturer = false;
    if (staffCategory) where.staffCategory = staffCategory;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { staffNumber: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.staff, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { department: true },
    });
  }

  async findOne(id: string) {
    const staff = await this.prisma.db.staff.findUnique({
      where: { id },
      include: { department: true, courseAllocations: true, user: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');
    return staff;
  }

  /**
   * Public staff directory: privacy-friendly projection (no phone, salary
   * or other sensitive fields) for the school website.
   */
  directory(schoolId: string | null) {
    return this.prisma.db.staff.findMany({
      where: schoolId ? { schoolId } : {},
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        designation: true,
        email: true,
        isLecturer: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
  }

  async create(schoolId: string | null, data: Record<string, any>) {
    return this.prisma.db.staff.create({
      data: {
        schoolId: schoolId ?? '',
        firstName: data.firstName,
        lastName: data.lastName,
        title: data.title,
        gender: data.gender as any,
        email: data.email,
        phone: data.phone,
        staffNumber: data.staffNumber,
        departmentId: data.departmentId,
        designation: data.designation,
        salaryGrade: data.salaryGrade,
        employmentType: data.employmentType,
        employmentDate: data.employmentDate
          ? new Date(data.employmentDate)
          : undefined,
        qualification: data.qualification,
        isLecturer: Boolean(data.isLecturer),
        staffCategory: data.staffCategory || undefined,
        photoUrl: data.photoUrl,
      },
    });
  }

  async update(id: string, data: Record<string, any>) {
    await this.findOne(id);
    return this.prisma.db.staff.update({
      where: { id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        title: data.title,
        gender: data.gender as any,
        email: data.email,
        phone: data.phone,
        departmentId: data.departmentId,
        designation: data.designation,
        salaryGrade: data.salaryGrade,
        employmentType: data.employmentType,
        qualification: data.qualification,
        isLecturer: data.isLecturer,
        staffCategory: data.staffCategory,
        photoUrl: data.photoUrl,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.db.staff.delete({ where: { id } });
  }

  /**
   * Find all lecturers with a portal account awaiting admin approval (User.status = PENDING).
   */
  async findPendingApprovals(schoolId: string | null) {
    const where: Record<string, any> = {
      userId: { not: null },
      isLecturer: true,
      user: { status: 'PENDING' },
    };
    if (schoolId) where.schoolId = schoolId;
    return this.prisma.db.staff.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, createdAt: true } },
        department: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve a self-registered lecturer's portal account:
   * activate the linked User.
   */
  async approvePortalAccount(staffId: string, schoolId: string | null) {
    const where: Record<string, any> = { id: staffId };
    if (schoolId) where.schoolId = schoolId;
    const staff = await this.prisma.db.staff.findFirst({
      where,
      include: { user: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');
    if (!staff.userId) throw new BadRequestException('This staff member has no portal account linked.');
    if (staff.user?.status !== 'PENDING') {
      throw new BadRequestException('This account is not pending approval.');
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: staff.userId! },
        data: { status: 'ACTIVE' },
      });
    });

    return { success: true };
  }

  /**
   * Decline a self-registered lecturer's portal account (linked flow):
   * delete the User record and unlink from the Staff.
   */
  async declinePortalAccount(staffId: string, schoolId: string | null) {
    const where: Record<string, any> = { id: staffId };
    if (schoolId) where.schoolId = schoolId;
    const staff = await this.prisma.db.staff.findFirst({
      where,
      include: { user: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');
    if (!staff.userId) throw new BadRequestException('This staff member has no portal account linked.');
    if (staff.user?.status !== 'PENDING') {
      throw new BadRequestException('This account is not pending approval.');
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: staff.userId! } });
      await tx.staff.update({
        where: { id: staffId },
        data: { userId: null },
      });
    });

    return { success: true };
  }

  /**
   * Find all PENDING lecturer-role Users that have no linked Staff record.
   */
  async findUnlinkedPendingUsers(schoolId: string | null) {
    return this.prisma.db.user.findMany({
      where: {
        schoolId: schoolId ?? undefined,
        role: 'LECTURER',
        status: 'PENDING',
        staff: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve an unlinked PENDING lecturer user: create a Staff record from the User + metadata,
   * link them, and activate the User.
   */
  async approveUnlinkedUser(userId: string, schoolId: string | null) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, schoolId: schoolId ?? undefined, role: 'LECTURER', status: 'PENDING', staff: null },
    });
    if (!user) throw new NotFoundException('Pending user not found');

    const meta = (user as any).metadata as { staffNumber?: string; departmentId?: string; courseIds?: string[] } | null;

    const staffRecord = await this.prisma.db.$transaction(async (tx) => {
      const s = await tx.staff.create({
        data: {
          schoolId: user.schoolId!,
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          staffNumber: meta?.staffNumber ?? null,
          departmentId: meta?.departmentId ?? null,
          isLecturer: true,
          isActive: true,
        },
      });
      // Create course allocations from self-registration
      if (meta?.courseIds && meta.courseIds.length > 0) {
        for (const courseId of meta.courseIds) {
          await tx.courseAllocation.create({
            data: { courseId, staffId: s.id },
          }).catch(() => { /* ignore duplicate allocation errors */ });
        }
      }
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' },
      });
      return s;
    });

    return { success: true };
  }

  /**
   * Decline an unlinked PENDING lecturer user: delete the User record entirely.
   */
  async declineUnlinkedUser(userId: string, schoolId: string | null) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, schoolId: schoolId ?? undefined, role: 'LECTURER', status: 'PENDING', staff: null },
    });
    if (!user) throw new NotFoundException('Pending user not found');

    await this.prisma.db.user.delete({ where: { id: userId } });

    return { success: true };
  }

  async toggleActive(id: string) {
    const staff = await this.prisma.db.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff not found');
    return this.prisma.db.staff.update({
      where: { id },
      data: { isActive: !staff.isActive },
    });
  }
}
