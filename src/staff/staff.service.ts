import { Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '../../../lib/types';
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

  /** Toggle a staff member's active status (disable/enable). */
  async toggleActive(id: string) {
    const staff = await this.prisma.db.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff not found');
    return this.prisma.db.staff.update({
      where: { id },
      data: { isActive: !staff.isActive },
    });
  }
}
