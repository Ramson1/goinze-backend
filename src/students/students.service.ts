import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Paginated } from '../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateStudentDto,
  UpdateStudentDto,
  ImportStudentsDto,
} from './dto/student.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    schoolId: string | null,
    query: PaginationDto,
    status?: string,
    departmentId?: string,
    level?: number,
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (level) where.currentLevel = level;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { matricNumber: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.student, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { programme: true, department: true },
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.db.student.findUnique({
      where: { id },
      include: {
        programme: true,
        department: true,
        user: true,
        payments: {
          include: { feeStructure: true },
          orderBy: { createdAt: 'desc' },
        },
        results: {
          include: { course: true, session: true },
          orderBy: [{ session: { name: 'asc' } }, { semester: 'asc' }],
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async create(schoolId: string | null, dto: CreateStudentDto) {
    return this.prisma.db.student.create({
      data: {
        schoolId: schoolId ?? '',
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        gender: dto.gender as any,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        stateOfOrigin: dto.stateOfOrigin,
        nationality: dto.nationality,
        matricNumber: dto.matricNumber,
        regNumber: dto.regNumber,
        programmeId: dto.programmeId,
        departmentId: dto.departmentId,
        currentLevel: dto.currentLevel,
        status: (dto.status as any) ?? 'APPLICANT',
        passportUrl: dto.passportUrl,
      },
    });
  }

  async update(id: string, dto: UpdateStudentDto) {
    await this.findOne(id);
    return this.prisma.db.student.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        gender: dto.gender as any,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        stateOfOrigin: dto.stateOfOrigin,
        nationality: dto.nationality,
        programmeId: dto.programmeId,
        departmentId: dto.departmentId,
        currentLevel: dto.currentLevel,
        status: dto.status as any,
        passportUrl: dto.passportUrl,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.db.student.delete({ where: { id } });
  }

  /** Bulk import stub — creates many students in a transaction. */
  async import(schoolId: string | null, dto: ImportStudentsDto) {
    const records = Array.isArray(dto.records) ? dto.records : [];
    const created = await this.prisma.db.$transaction(
      records.map((r) =>
        this.prisma.db.student.create({
          data: {
            schoolId: schoolId ?? '',
            firstName: r.firstName,
            lastName: r.lastName,
            middleName: r.middleName,
            gender: r.gender as any,
            email: r.email,
            phone: r.phone,
            matricNumber: r.matricNumber,
            regNumber: r.regNumber,
            programmeId: r.programmeId,
            departmentId: r.departmentId,
            currentLevel: r.currentLevel,
            status: (r.status as any) ?? 'ACTIVE',
          },
        }),
      ),
    );
    return { imported: created.length };
  }

  /** Transition a student's lifecycle status. */
  private async setStatus(id: string, status: string) {
    await this.findOne(id);
    return this.prisma.db.student.update({
      where: { id },
      data: { status: status as any },
    });
  }

  suspend(id: string) {
    return this.setStatus(id, 'SUSPENDED');
  }

  graduate(id: string) {
    return this.setStatus(id, 'GRADUATED');
  }

  archive(id: string) {
    return this.setStatus(id, 'ARCHIVED');
  }

  /**
   * Promote all ACTIVE students to the next level (increment by 100).
   * Students already at the maximum level (300) are not affected.
   */
  async promoteAll(schoolId: string | null): Promise<{ promoted: number }> {
    const where: Record<string, any> = {
      status: 'ACTIVE',
      currentLevel: { lt: 300 },
    };
    if (schoolId) where.schoolId = schoolId;

    const result = await this.prisma.db.student.updateMany({
      where,
      data: {
        currentLevel: {
          increment: 100,
        },
      },
    });

    return { promoted: result.count };
  }

  /**
   * Graduate all ACTIVE students at the final year level (300).
   */
  async graduateAllFinalYear(schoolId: string | null): Promise<{ graduated: number }> {
    const where: Record<string, any> = {
      status: 'ACTIVE',
      currentLevel: 300,
    };
    if (schoolId) where.schoolId = schoolId;

    const result = await this.prisma.db.student.updateMany({
      where,
      data: { status: 'GRADUATED' },
    });

    return { graduated: result.count };
  }

  /**
   * Generate a random temporary password for student accounts.
   */
  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Find all students with a portal account awaiting admin approval (User.status = PENDING).
   */
  async findPendingApprovals(schoolId: string | null) {
    const where: Record<string, any> = {
      userId: { not: null },
      user: { status: 'PENDING' },
    };
    if (schoolId) where.schoolId = schoolId;
    return this.prisma.db.student.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, createdAt: true } },
        department: true,
        programme: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve a self-registered student's portal account:
   * activate both the Student and the linked User.
   */
  async approvePortalAccount(studentId: string, schoolId: string | null) {
    const where: Record<string, any> = { id: studentId };
    if (schoolId) where.schoolId = schoolId;
    const student = await this.prisma.db.student.findFirst({
      where,
      include: { user: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (!student.userId) throw new BadRequestException('This student has no portal account linked.');
    if (student.user?.status !== 'PENDING') {
      throw new BadRequestException('This account is not pending approval.');
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: studentId },
        data: { status: 'ACTIVE', matricActivatedAt: new Date() },
      });
      await tx.user.update({
        where: { id: student.userId! },
        data: { status: 'ACTIVE' },
      });
    });

    return { success: true };
  }

  /**
   * Decline a self-registered student's portal account (linked flow):
   * delete the User record and unlink from the Student.
   */
  async declinePortalAccount(studentId: string, schoolId: string | null) {
    const where: Record<string, any> = { id: studentId };
    if (schoolId) where.schoolId = schoolId;
    const student = await this.prisma.db.student.findFirst({
      where,
      include: { user: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (!student.userId) throw new BadRequestException('This student has no portal account linked.');
    if (student.user?.status !== 'PENDING') {
      throw new BadRequestException('This account is not pending approval.');
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: student.userId! } });
      await tx.student.update({
        where: { id: studentId },
        data: { userId: null },
      });
    });

    return { success: true };
  }

  /**
   * Find all PENDING student-role Users that have no linked Student record
   * (i.e. self-registered without a pre-existing student record).
   */
  async findUnlinkedPendingUsers(schoolId: string | null) {
    return this.prisma.db.user.findMany({
      where: {
        schoolId: schoolId ?? undefined,
        role: 'STUDENT',
        status: 'PENDING',
        student: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve an unlinked PENDING user: create a Student record from the User + metadata,
   * link them, and activate both.
   */
  async approveUnlinkedUser(userId: string, schoolId: string | null) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, schoolId: schoolId ?? undefined, role: 'STUDENT', status: 'PENDING', student: null },
    });
    if (!user) throw new NotFoundException('Pending user not found');

    const meta = (user as any).metadata as { matricNumber?: string; departmentId?: string; currentLevel?: number } | null;

    await this.prisma.db.$transaction(async (tx) => {
      await tx.student.create({
        data: {
          schoolId: user.schoolId!,
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          matricNumber: meta?.matricNumber ?? null,
          departmentId: meta?.departmentId ?? null,
          currentLevel: meta?.currentLevel ?? 100,
          status: 'ACTIVE',
          matricActivatedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' },
      });
    });

    return { success: true };
  }

  /**
   * Decline an unlinked PENDING user: delete the User record entirely.
   */
  async declineUnlinkedUser(userId: string, schoolId: string | null) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, schoolId: schoolId ?? undefined, role: 'STUDENT', status: 'PENDING', student: null },
    });
    if (!user) throw new NotFoundException('Pending user not found');

    await this.prisma.db.user.delete({ where: { id: userId } });

    return { success: true };
  }

  /**
   * Reset a student's temporary password and update their user account.
   * Returns the new temp password so it can be communicated to the student.
   */
  async resetTempPassword(id: string): Promise<{ tempPassword: string }> {
    const student = await this.prisma.db.student.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException(`Student ${id} not found`);
    }

    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Update the student record with the new temp password
    await this.prisma.db.student.update({
      where: { id },
      data: { tempPassword },
    });

    // Update the user account with the new password hash
    if (student.userId) {
      await this.prisma.db.user.update({
        where: { id: student.userId },
        data: { passwordHash },
      });
    }

    return { tempPassword };
  }
}
