import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Paginated } from '../lib/types';
import { generateApplicationNo, generateMatricNumber } from '../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ApplyDto, ReviewApplicationDto, ApproveApplicationDto } from './dto/admission.dto';
import { MailService } from '../mail/mail.service';
import { CommunicationService } from '../communication/communication.service';
import * as crypto from 'crypto';

@Injectable()
export class AdmissionsService {
  private readonly logger = new Logger(AdmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly comms: CommunicationService,
  ) {}

  /**
   * Submit a new application from the public website.
   * Resolves the target school (tenant) from slug/code, falling back to the
   * first active school in development so the demo flow works out of the box.
   */
  async apply(schoolId: string | null, dto: ApplyDto) {
    const school = await this.resolveSchool(schoolId, dto.schoolSlug, dto.schoolCode);

    // ── Pre-admission fee gate ──
    // Check if the school has APPLICATION_FORM or ENTRANCE_EXAM fees configured.
    // If so, a valid payment reference is required to submit.
    const requiredFees = await this.prisma.db.feeStructure.findMany({
      where: {
        schoolId: school.id,
        type: { in: ['APPLICATION_FORM', 'ENTRANCE_EXAM'] },
      },
      select: { id: true, name: true, type: true, amount: true },
    });

    if (requiredFees.length > 0) {
      if (!dto.paymentReference) {
        throw new BadRequestException(
          'Application form fees must be paid before submitting. Please complete the payment first.',
        );
      }

      // Validate the payment exists and was successful
      const payment = await this.prisma.db.payment.findUnique({
        where: { reference: dto.paymentReference },
      });

      if (!payment || payment.schoolId !== school.id || payment.status !== 'SUCCESS') {
        throw new BadRequestException(
          'Invalid or unsuccessful payment. Please complete payment before submitting.',
        );
      }
    }

    const application = await this.prisma.db.application.create({
      data: {
        schoolId: school.id,
        applicationNo: generateApplicationNo(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        middleName: dto.middleName?.trim() || undefined,
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone,
        gender: (dto.gender as any) ?? undefined,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        programmeId: dto.programmeId || undefined,
        departmentId: dto.departmentId || undefined,
        // Extended personal information
        maritalStatus: dto.maritalStatus || undefined,
        stateOfOrigin: dto.stateOfOrigin || undefined,
        localGovernment: dto.localGovernment || undefined,
        postalAddress: dto.postalAddress || undefined,
        homeAddress: dto.homeAddress || undefined,
        guardianName: dto.guardianName || undefined,
        guardianPhone: dto.guardianPhone || undefined,
        guardianGsm: dto.guardianGsm || undefined,
        medicalHistory: dto.medicalHistory || undefined,
        // Course choices
        firstChoice: dto.firstChoice || undefined,
        secondChoice: dto.secondChoice || undefined,
        thirdChoice: dto.thirdChoice || undefined,
        // Structured table data
        educationData: dto.educationData ?? undefined,
        // Declaration
        declarationName: dto.declarationName || undefined,
        declarationDate: dto.declarationDate ? new Date(dto.declarationDate) : undefined,
        declarationAgreed: dto.declarationAgreed ?? false,
        status: 'SUBMITTED',
      },
      include: { documents: false },
    });

    // ── Link payment to application and mark fees paid ──
    if (dto.paymentReference && requiredFees.length > 0) {
      await this.prisma.db.$transaction([
        this.prisma.db.payment.update({
          where: { reference: dto.paymentReference },
          data: {
            applicationId: application.id,
            metadata: { purpose: 'APPLICATION_FORM' },
          },
        }),
        this.prisma.db.application.update({
          where: { id: application.id },
          data: { applicationFormFeePaid: true },
        }),
      ]);
    }

    // Notify admin about new application
    this.comms
      .notifyUsersByRole(
        school.id,
        'SCHOOL_ADMIN',
        'New Application Received',
        `${application.firstName} ${application.lastName} has submitted an application (${application.applicationNo}).`,
      )
      .catch((err) => this.logger.error('Failed to send application notification', err instanceof Error ? err.stack : ''));

    return {
      id: application.id,
      applicationNo: application.applicationNo,
      status: application.status,
      schoolName: school.name,
      message:
        'Application received. Use your application number and email to track its status.',
    };
  }

  /**
   * Public status lookup for applicants (no auth).
   * Requires the matching email to prevent enumeration of other applicants.
   */
  async trackStatus(applicationNo: string, email: string) {
    const application = await this.prisma.db.application.findUnique({
      where: { applicationNo: applicationNo.trim().toUpperCase() },
      include: {
        student: {
          select: {
            id: true,
            matricNumber: true,
            status: true,
            currentLevel: true,
          },
        },
      },
    });

    if (
      !application ||
      application.email.toLowerCase() !== email.toLowerCase().trim()
    ) {
      throw new NotFoundException(
        'No application found for that application number and email.',
      );
    }

    return {
      applicationNo: application.applicationNo,
      status: application.status,
      applicantName: `${application.firstName} ${application.lastName}`,
      acceptanceFeePaid: application.acceptanceFeePaid,
      admissionLetterUrl: application.admissionLetterUrl,
      submittedAt: application.createdAt,
      student: application.student
        ? {
            matricNumber: application.student.matricNumber,
            status: application.student.status,
          }
        : null,
    };
  }

  async findAll(
    schoolId: string | null,
    query: PaginationDto,
    status?: string,
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (status) where.status = status;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { applicationNo: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.application, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { student: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const application = await this.prisma.db.application.findUnique({
      where: { id },
      include: { documents: true, student: true, payments: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  /** Move an application through the review workflow. */
  async review(id: string, reviewerId: string, dto: ReviewApplicationDto) {
    await this.findOne(id);
    return this.prisma.db.application.update({
      where: { id },
      data: {
        status: dto.status as any,
        score: dto.score ?? undefined,
        interviewDate: dto.interviewDate ? new Date(dto.interviewDate) : undefined,
        reviewedBy: reviewerId,
      },
    });
  }

  /**
   * Approve an application and provision a Student record with a matric number.
   * Idempotent: re-approving an already-provisioned application just refreshes
   * the status without creating a duplicate student.
   */
  async approve(id: string, reviewerId: string, dto: ApproveApplicationDto = {}) {
    const application = await this.findOne(id);

    if (application.status === 'REJECTED') {
      throw new BadRequestException('A rejected application cannot be approved.');
    }

    // Use admin-selected programme/department, falling back to application values
    const programmeId = dto.programmeId || application.programmeId;
    const departmentId = dto.departmentId || application.departmentId;

    if (application.studentId) {
      // Update student + application record with selected programme/department if provided
      if (dto.programmeId || dto.departmentId) {
        await this.prisma.db.student.update({
          where: { id: application.studentId },
          data: {
            ...(dto.programmeId && { programmeId: dto.programmeId }),
            ...(dto.departmentId && { departmentId: dto.departmentId }),
          },
        });
      }
      const updated = await this.prisma.db.application.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          ...(programmeId && { programmeId }),
          ...(departmentId && { departmentId }),
        },
        include: { student: true },
      });
      // Auto-generate letter + send email on re-approval
      await this.sendAdmissionEmail(updated.id).catch((err) =>
        this.logger.error('Failed to send admission email on re-approve', err instanceof Error ? err.stack : ''),
      );
      return updated;
    }

    const [matricNumber, currentSession] = await Promise.all([
      this.generateMatricNumber(application.schoolId, departmentId),
      this.prisma.db.academicSession.findFirst({
        where: { schoolId: application.schoolId, isCurrent: true },
      }),
    ]);

    const result = await this.prisma.db.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          schoolId: application.schoolId,
          firstName: application.firstName,
          lastName: application.lastName,
          middleName: application.middleName,
          gender: application.gender ?? undefined,
          dateOfBirth: application.dateOfBirth ?? undefined,
          email: application.email,
          phone: application.phone,
          programmeId,
          departmentId,
          matricNumber,
          currentLevel: 100,
          entrySessionId: currentSession?.id,
          status: 'APPLICANT',
        },
      });

      // Provision a portal login for the newly admitted student.
      const tempPassword = await this.provisionStudentUser(tx, student.id, application);
      
      // Store the temp password on the student record so it can be included in the admission letter
      if (tempPassword) {
        await tx.student.update({
          where: { id: student.id },
          data: { tempPassword },
        });
      }

      const updated = await tx.application.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          studentId: student.id,
          programmeId,
          departmentId,
        },
        include: { student: true },
      });

      return { updated, tempPassword };
    });

    // Auto-generate admission letter + send email with the temp password
    await this.sendAdmissionEmail(result.updated.id, result.tempPassword).catch((err) =>
      this.logger.error('Failed to send admission email after approval', err instanceof Error ? err.stack : ''),
    );

    // Notify the admitted student
    const studentEmail = result.updated.student?.email ?? undefined;
    const studentUser = studentEmail
      ? await this.prisma.db.user.findFirst({ where: { email: studentEmail } })
      : null;
    if (studentUser) {
      this.comms
        .notifyUser(
          studentUser.id,
          'Admission Approved',
          `Congratulations! Your admission has been approved. Check your email for details and your login credentials.`,
        )
        .catch((err) => this.logger.error('Failed to send admission approval notification', err instanceof Error ? err.stack : ''));
    }

    return result.updated;
  }

  /**
   * Generate a random temporary password for student accounts.
   */
  private generateTempPassword(): string {
    // Generate a random 8-character password with letters and numbers
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /** Default password for provisioned student accounts (change on first login). */
  static readonly DEFAULT_STUDENT_PASSWORD = 'student123';

  /**
   * Create a STUDENT-role User linked to a Student record so the applicant can
   * log in to the student portal. Idempotent: skips if the email is taken.
   * Returns the generated temp password if a new user is created.
   */
  private async provisionStudentUser(
    tx: any,
    studentId: string,
    application: { schoolId: string; email: string; firstName: string; lastName: string; phone: string | null },
  ): Promise<string | null> {
    const existing = await tx.user.findUnique({
      where: { email: application.email.toLowerCase() },
      include: { student: true },
    });
    if (existing) {
      // Link the existing account to the student if not already linked.
      if (!existing.student) {
        await tx.student.update({
          where: { id: studentId },
          data: { userId: existing.id },
        });
      }
      return null; // No new password generated
    }

    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await tx.user.create({
      data: {
        schoolId: application.schoolId,
        email: application.email.toLowerCase(),
        passwordHash,
        firstName: application.firstName,
        lastName: application.lastName,
        phone: application.phone ?? undefined,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    // Link student → user (FK lives on Student.userId).
    await tx.student.update({
      where: { id: studentId },
      data: { userId: user.id },
    });
    return tempPassword;
  }

  /**
   * Finalize onboarding once the acceptance fee is paid: flip the application
   * to ADMITTED and activate the provisioned student. Guarded so it only runs
   * when both approval and payment are satisfied.
   */
  async admit(id: string) {
    const application = await this.findOne(id);

    if (!application.studentId) {
      throw new BadRequestException(
        'Approve the application (provision a student) before admitting.',
      );
    }
    if (!application.acceptanceFeePaid) {
      throw new BadRequestException(
        'Acceptance fee has not been paid. Payment is required before admission.',
      );
    }

    return this.prisma.db.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: application.studentId! },
        data: { status: 'ACTIVE', matricActivatedAt: new Date() },
      });
      return tx.application.update({
        where: { id },
        data: { status: 'ADMITTED' },
        include: { student: true },
      });
    });
  }

  /**
   * Internal helper: generate the admission letter and send email.
   * Called automatically after approve() and manually via generateLetter().
   */
  private async sendAdmissionEmail(applicationId: string, tempPasswordOverride?: string | null) {
    const application = await this.prisma.db.application.findUnique({
      where: { id: applicationId },
      include: { student: true },
    });
    if (!application) return;

    const [school, programme, department] = await Promise.all([
      this.prisma.db.school.findUnique({ where: { id: application.schoolId } }),
      application.programmeId
        ? this.prisma.db.programme.findUnique({ where: { id: application.programmeId } })
        : Promise.resolve(null),
      application.departmentId
        ? this.prisma.db.department.findUnique({ where: { id: application.departmentId } })
        : Promise.resolve(null),
    ]);

    const portalUrl =
      this.config.get<string>('STUDENT_PORTAL_URL') || 'https://student-mnx7td3pg-black-box-tech-s-projects.vercel.app';

    // Build an absolute logo URL — relative paths like /logo.png break in data-URLs and emails
    let schoolLogoUrl = school?.logoUrl || '';
    if (!schoolLogoUrl || (!schoolLogoUrl.startsWith('http://') && !schoolLogoUrl.startsWith('https://') && !schoolLogoUrl.startsWith('data:'))) {
      schoolLogoUrl = 'https://res.cloudinary.com/dq7vegvkk/image/upload/v1786631436/logo_phczed.png';
    }

    // Resolve programme name: prefer linked record, fall back to firstChoice text
    const programmeName = programme?.name || application.firstChoice || '—';
    const departmentName = department?.name || '—';

    const tempPassword = tempPasswordOverride ?? application.student?.tempPassword;

    const html = this.renderLetterHtml({
      schoolName: school?.name ?? 'Goinze International School of Medical Health Science and Technology',
      schoolAddress: school?.address ?? '',
      schoolLogoUrl,
      applicationNo: application.applicationNo,
      applicantName: [application.firstName, application.middleName, application.lastName]
        .filter(Boolean)
        .join(' '),
      programme: programmeName,
      department: departmentName,
      matricNumber: application.student?.matricNumber ?? 'Pending',
      tempPassword,
      portalUrl,
      date: new Date().toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    });

    const admissionLetterUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    await this.prisma.db.application.update({
      where: { id: applicationId },
      data: { admissionLetterUrl },
    });

    // Send admission letter via email
    const applicantName = [application.firstName, application.lastName].filter(Boolean).join(' ');
    const emailHtml = this.renderEmailBody({
      applicantName,
      schoolName: school?.name ?? 'Goinze International School',
      schoolLogoUrl,
      admissionLetterUrl,
      portalUrl,
      matricNumber: application.student?.matricNumber ?? 'Pending',
      tempPassword,
    });

    await this.mail.sendEmail(
      application.email,
      `Admission Letter — ${school?.name ?? 'Goinze International School'}`,
      emailHtml,
    );
  }

  /**
   * Generate the admission letter as a self-contained HTML document and store
   * it as a data URL. (Swap for Cloudinary-hosted PDF in production.)
   */
  async generateLetter(id: string) {
    const application = await this.findOne(id);
    if (application.status !== 'APPROVED' && application.status !== 'ADMITTED') {
      throw new BadRequestException(
        'Only approved applications can have an admission letter generated.',
      );
    }

    await this.sendAdmissionEmail(id);

    return this.prisma.db.application.findUnique({
      where: { id },
      include: { student: true },
    });
  }

  /**
   * Re-send the admission letter email to the applicant without regenerating the letter.
   */
  async sendLetterEmail(id: string) {
    const application = await this.prisma.db.application.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!application) throw new NotFoundException(`Application ${id} not found`);
    if (!application.admissionLetterUrl) {
      throw new BadRequestException('No admission letter has been generated yet. Generate the letter first.');
    }

    await this.sendAdmissionEmail(id);
    return { success: true, message: `Admission letter sent to ${application.email}` };
  }

  /**
   * Generate a temporary password for the student linked to this application
   * and update their user account so they can log in to the student portal.
   */
  async createStudentPassword(id: string) {
    const application = await this.prisma.db.application.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!application) throw new NotFoundException(`Application ${id} not found`);
    if (!application.studentId) {
      throw new BadRequestException('No student record linked to this application. Approve the application first.');
    }

    const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Update the student record
    await this.prisma.db.student.update({
      where: { id: application.studentId },
      data: { tempPassword },
    });

    // Update the user account if linked
    if (application.student?.userId) {
      await this.prisma.db.user.update({
        where: { id: application.student.userId },
        data: { passwordHash },
      });
    }

    return { tempPassword, studentId: application.studentId };
  }

  async updateVerification(id: string, dto: import('./dto/admission.dto').UpdateVerificationDto) {
    const application = await this.prisma.db.application.findUnique({ where: { id } });
    if (!application) throw new NotFoundException(`Application ${id} not found`);

    return this.prisma.db.application.update({
      where: { id },
      data: {
        verificationDocumentsReviewed: dto.verificationDocumentsReviewed ?? false,
        verificationDocumentsMatch: dto.verificationDocumentsMatch ?? false,
        verificationReceiptAttached: dto.verificationReceiptAttached ?? false,
        verificationCourseApproved: dto.verificationCourseApproved ?? false,
      },
    });
  }

  /** Delete an application and its related records. */
  async remove(id: string) {
    const application = await this.prisma.db.application.findUnique({ where: { id } });
    if (!application) throw new NotFoundException(`Application ${id} not found`);

    // Delete related documents first
    await this.prisma.db.document.deleteMany({ where: { applicationId: id } });
    // Delete the application
    await this.prisma.db.application.delete({ where: { id } });
    return { success: true, message: `Application ${application.applicationNo} deleted.` };
  }

  // ---- helpers ----

  private async resolveSchool(
    schoolId: string | null,
    slug?: string,
    code?: string,
  ) {
    if (schoolId) {
      const school = await this.prisma.db.school.findUnique({ where: { id: schoolId } });
      if (school) return school;
    }
    if (slug) {
      const school = await this.prisma.db.school.findUnique({ where: { slug } });
      if (school) return school;
    }
    if (code) {
      const school = await this.prisma.db.school.findUnique({ where: { code } });
      if (school) return school;
    }
    // Dev/demo fallback: the first active school.
    const fallback = await this.prisma.db.school.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!fallback) {
      throw new BadRequestException(
        'No school configured. Seed a school or pass schoolSlug/schoolCode.',
      );
    }
    return fallback;
  }

  private async generateMatricNumber(schoolId: string, departmentId: string | null) {
    const [school, department, serial] = await Promise.all([
      this.prisma.db.school.findUnique({ where: { id: schoolId } }),
      departmentId
        ? this.prisma.db.department.findUnique({ where: { id: departmentId } })
        : Promise.resolve(null),
      this.prisma.db.student.count({
        where: { schoolId, departmentId: departmentId ?? undefined },
      }),
    ]);

    return generateMatricNumber(
      school?.code ?? 'GDU',
      department?.code ?? 'GEN',
      serial + 1,
    );
  }

  private renderLetterHtml(d: {
    schoolName: string;
    schoolAddress: string;
    schoolLogoUrl: string;
    applicationNo: string;
    applicantName: string;
    programme: string;
    department: string;
    matricNumber: string;
    tempPassword?: string | null;
    portalUrl: string;
    date: string;
  }): string {
    const logoBlock = `<img src="${d.schoolLogoUrl}" alt="${d.schoolName} Logo" style="max-height:80px;margin:0 auto 12px;display:block;" />`;
    const passwordRow = d.tempPassword
      ? `<tr><td class="k">Temporary Password</td><td><strong>${d.tempPassword}</strong></td></tr>`
      : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>Admission Letter — ${d.applicantName}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1e293b;margin:0;padding:48px;background:#fff;}
  .sheet{max-width:760px;margin:0 auto;border:1px solid #e2e8f0;padding:56px;}
  .head{text-align:center;border-bottom:3px solid #0f766e;padding-bottom:20px;margin-bottom:28px;}
  .head h1{color:#0f766e;margin:0;font-size:26px;letter-spacing:.5px;}
  .head p{margin:6px 0 0;color:#64748b;font-size:13px;}
  .ref{font-size:13px;color:#64748b;margin-bottom:24px;}
  h2{color:#0f766e;font-size:18px;text-decoration:underline;}
  table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;}
  td{padding:8px 10px;border:1px solid #e2e8f0;}
  td.k{background:#f0fdfa;font-weight:bold;width:38%;color:#0f766e;}
  .sign{margin-top:48px;font-size:14px;}
  .foot{margin-top:40px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:14px;}
  .portal-link{margin-top:24px;padding:16px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;font-size:14px;}
  .portal-link a{color:#0f766e;font-weight:bold;text-decoration:underline;}
</style></head><body><div class="sheet">
  <div class="head">${logoBlock}<h1>${d.schoolName}</h1><p>${d.schoolAddress}</p><p>Office of the Registrar — Admissions</p></div>
  <div class="ref">Reference: ${d.applicationNo} &nbsp;|&nbsp; Date: ${d.date}</div>
  <p>Dear <strong>${d.applicantName}</strong>,</p>
  <h2>Offer of Provisional Admission</h2>
  <p>We are pleased to inform you that, following the review of your application, you have been offered <strong>provisional admission</strong> into the programme below, subject to payment of all required fees and completion of registration.</p>
  <table>
    <tr><td class="k">Applicant</td><td>${d.applicantName}</td></tr>
    <tr><td class="k">Application No.</td><td>${d.applicationNo}</td></tr>
    <tr><td class="k">Programme</td><td>${d.programme}</td></tr>
    <tr><td class="k">Department</td><td>${d.department}</td></tr>
    <tr><td class="k">Matric Number</td><td>${d.matricNumber}</td></tr>
    ${passwordRow}
  </table>
  <div class="portal-link">
    <p><strong>Student Portal Access</strong></p>
    <p>Log in to the student portal at <a href="${d.portalUrl}">${d.portalUrl}</a></p>
    <p>Matric Number: <strong>${d.matricNumber}</strong>${d.tempPassword ? ` &nbsp;|&nbsp; Temporary Password: <strong>${d.tempPassword}</strong>` : ''}</p>
    <p style="font-size:12px;color:#64748b;">You must complete all required payments (acceptance fee, portal access fee, etc.) before full portal access is granted. Please change your password after first login.</p>
  </div>
  <p>To accept this offer, kindly pay the required fees through the student portal. Your admission will be confirmed and your matric number activated upon receipt of all required payments.</p>
  <p>Congratulations, and welcome to ${d.schoolName}.</p>
  <div class="sign"><p>Yours faithfully,</p><p><strong>The Registrar</strong><br/>${d.schoolName}</p></div>
  <div class="foot">This is a system-generated admission letter • Verify at the school portal using reference ${d.applicationNo}</div>
</div></body></html>`;
  }

  private renderEmailBody(d: {
    applicantName: string;
    schoolName: string;
    schoolLogoUrl: string;
    admissionLetterUrl: string;
    portalUrl: string;
    matricNumber: string;
    tempPassword?: string | null;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoBlock = `<img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:60px;margin:0 auto 16px;display:block;" />`;
    return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0;">
    <div style="text-align:center;margin-bottom:24px;">${logoBlock}
      <h1 style="color:#0f766e;margin:0;font-size:22px;">${d.schoolName}</h1>
    </div>
    <p>Dear <strong>${d.applicantName}</strong>,</p>
    <p>Congratulations! You have been offered provisional admission into <strong>${d.schoolName}</strong>.</p>
    <p>Your matric number is: <strong>${d.matricNumber}</strong></p>
    ${d.tempPassword ? `<p>Your temporary password is: <strong>${d.tempPassword}</strong></p>` : ''}
    <p>Please find your admission letter attached below. You will need to log in to the student portal to complete your registration and make all required payments.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${d.admissionLetterUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Admission Letter</a>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${d.portalUrl}" target="_blank" style="display:inline-block;background:#f0fdfa;color:#0f766e;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold;border:1px solid #99f6e4;">Go to Student Portal</a>
    </div>
    <p style="font-size:13px;color:#64748b;">You will need your matric number (<strong>${d.matricNumber}</strong>)${d.tempPassword ? ` and temporary password (<strong>${d.tempPassword}</strong>)` : ' and the temporary password provided by the admissions office'} to log in.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">This is a system-generated email from ${d.schoolName}. Please do not reply to this email.</p>
  </div>
</body></html>`;
  }
}
