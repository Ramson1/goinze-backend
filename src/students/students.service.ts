import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Paginated } from '../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateStudentDto,
  UpdateStudentDto,
  ImportStudentsDto,
} from './dto/student.dto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

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
    const student = await this.prisma.db.student.create({
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

    // Welcome notification to the newly registered student (non-blocking so
    // email delivery issues never fail the registration).
    this.sendStudentWelcomeEmail(student, schoolId).catch((err) =>
      this.logger.error(
        'Failed to send student welcome email',
        err instanceof Error ? err.stack : '',
      ),
    );

    return student;
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

    // Email the new temporary password to the student (non-blocking).
    this.sendPasswordResetEmail(student, tempPassword).catch((err) =>
      this.logger.error(
        'Failed to send password reset email',
        err instanceof Error ? err.stack : '',
      ),
    );

    return { tempPassword };
  }

  // ---- email helpers ----

  /** Resolve school branding + portal URL used in student notification emails. */
  private async resolveSchoolBranding(schoolId: string | null) {
    const school = schoolId
      ? await this.prisma.db.school.findUnique({ where: { id: schoolId } })
      : null;
    // Static production URL — portal links must never resolve to localhost/dev.
    const portalUrl = 'https://student.goinzeschool.edu.ng';
    let schoolLogoUrl = school?.logoUrl || '';
    if (
      !schoolLogoUrl ||
      (!schoolLogoUrl.startsWith('http://') &&
        !schoolLogoUrl.startsWith('https://') &&
        !schoolLogoUrl.startsWith('data:'))
    ) {
      schoolLogoUrl = 'https://res.cloudinary.com/dq7vegvkk/image/upload/v1786631436/logo_phczed.png';
    }
    return {
      schoolName: school?.name ?? 'Goinze International School',
      schoolLogoUrl,
      portalUrl,
    };
  }

  /** Email a newly created student a registration/welcome confirmation. */
  private async sendStudentWelcomeEmail(
    student: {
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      matricNumber?: string | null;
      regNumber?: string | null;
      schoolId?: string | null;
    },
    schoolId: string | null,
  ) {
    if (!student.email) return;
    const { schoolName, schoolLogoUrl, portalUrl } = await this.resolveSchoolBranding(
      schoolId ?? student.schoolId ?? null,
    );
    const studentName =
      [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student';
    const rows: [string, string][] = [];
    if (student.matricNumber) rows.push(['Matric Number', student.matricNumber]);
    if (student.regNumber) rows.push(['Registration Number', student.regNumber]);
    const html = this.renderBrandedEmailHtml({
      schoolName,
      schoolLogoUrl,
      portalUrl,
      greeting: studentName,
      intro: `Welcome to <strong>${schoolName}</strong>! Your student registration has been received and your record has been created in our system.`,
      rows,
      ctaLabel: 'Go to Student Portal',
      footnote:
        'Please keep your details safe. You will receive your portal login credentials from the admissions office.',
    });
    await this.mail.sendEmail(
      student.email,
      `Welcome to ${schoolName} — Registration Confirmed`,
      html,
    );
  }

  /** Email a student their new temporary password after an admin-initiated reset. */
  private async sendPasswordResetEmail(
    student: {
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      matricNumber?: string | null;
      schoolId?: string | null;
    },
    tempPassword: string,
  ) {
    if (!student.email) return;
    const { schoolName, schoolLogoUrl, portalUrl } = await this.resolveSchoolBranding(
      student.schoolId ?? null,
    );
    const studentName =
      [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student';
    const rows: [string, string][] = [];
    if (student.matricNumber) rows.push(['Matric Number', student.matricNumber]);
    rows.push(['Temporary Password', tempPassword]);
    const html = this.renderBrandedEmailHtml({
      schoolName,
      schoolLogoUrl,
      portalUrl,
      greeting: studentName,
      intro: `Your student portal password has been reset. Use the temporary password below to log in to <strong>${schoolName}</strong>.`,
      rows,
      ctaLabel: 'Log in to Student Portal',
      footnote:
        'For your security, please change your password immediately after your first login.',
    });
    await this.mail.sendEmail(
      student.email,
      `Your New Portal Password — ${schoolName}`,
      html,
    );
  }

  /** Render a simple school-branded HTML email shared by student notifications. */
  private renderBrandedEmailHtml(d: {
    schoolName: string;
    schoolLogoUrl: string;
    portalUrl: string;
    greeting: string;
    intro: string;
    rows: [string, string][];
    ctaLabel: string;
    footnote: string;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoBlock = `<img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:60px;margin:0 auto 16px;display:block;" />`;
    const rowsHtml = d.rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;width:38%;">${k}</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${v}</td></tr>`,
      )
      .join('');
    const tableHtml = rowsHtml
      ? `<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">${rowsHtml}</table>`
      : '';
    return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0;">
    <div style="text-align:center;margin-bottom:24px;">${logoBlock}
      <h1 style="color:#0f766e;margin:0;font-size:22px;">${d.schoolName}</h1>
    </div>
    <p>Dear <strong>${d.greeting}</strong>,</p>
    <p>${d.intro}</p>
    ${tableHtml}
    <div style="text-align:center;margin:24px 0;">
      <a href="${d.portalUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">${d.ctaLabel}</a>
    </div>
    <p style="font-size:13px;color:#64748b;">${d.footnote}</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">This is a system-generated email from ${d.schoolName}. Please do not reply to this email.</p>
  </div>
</body></html>`;
  }
}
