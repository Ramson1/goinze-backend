import { Injectable, NotFoundException } from '@nestjs/common';
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
