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

  /**
   * School + developer inboxes that receive a full-details alert whenever an
   * admission application fee payment is confirmed on the public website.
   */
  private static readonly ADMISSION_ALERT_RECIPIENTS = [
    'onyevid@gmail.com',
    'ishayadan5@gmail.com',
  ];

  /**
   * Production student portal URL used in every student-facing email. Static by
   * design — portal links must never resolve to a localhost/dev URL, so no
   * environment detection (e.g. STUDENT_PORTAL_URL) is applied here.
   */
  private static readonly STUDENT_PORTAL_URL = 'https://student.goinzeschool.edu.ng';

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
    const admissionFeePaid = Boolean(dto.paymentReference && requiredFees.length > 0);
    if (admissionFeePaid) {
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

      // Payment for the admission application is confirmed: email the full
      // request details to the school + developer inboxes and raise an in-app
      // notification for administrators. Fire-and-forget so submission never
      // blocks on email/notification delivery.
      this.notifyAdmissionPaymentReceived(
        school.id,
        school.name,
        application,
        dto.paymentReference as string,
      ).catch((err) =>
        this.logger.error(
          'Failed to send admission payment notification',
          err instanceof Error ? err.stack : '',
        ),
      );
    } else {
      // No application fee configured for this school — simply notify admins
      // that a new (unpaid) application was received.
      this.comms
        .notifyUsersByRole(
          school.id,
          'SCHOOL_ADMIN',
          'New Application Received',
          `${application.firstName} ${application.lastName} has submitted an application (${application.applicationNo}).`,
        )
        .catch((err) => this.logger.error('Failed to send application notification', err instanceof Error ? err.stack : ''));
    }

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
   * Fired immediately after an admission application fee payment is confirmed
   * and linked to a newly submitted application. Sends a full-details alert
   * email to the school + developer inboxes and raises an in-app notification
   * for school administrators so the new admission payment surfaces on the
   * admin dashboard.
   */
  private async notifyAdmissionPaymentReceived(
    schoolId: string,
    schoolName: string,
    application: any,
    paymentReference: string,
  ) {
    const [payment, programme, department, school] = await Promise.all([
      this.prisma.db.payment.findUnique({ where: { reference: paymentReference } }),
      application.programmeId
        ? this.prisma.db.programme.findUnique({ where: { id: application.programmeId } })
        : Promise.resolve(null),
      application.departmentId
        ? this.prisma.db.department.findUnique({ where: { id: application.departmentId } })
        : Promise.resolve(null),
      this.prisma.db.school.findUnique({ where: { id: schoolId } }),
    ]);

    const applicantName = [application.firstName, application.middleName, application.lastName]
      .filter(Boolean)
      .join(' ');
    const programmeName = programme?.name || application.firstChoice || '—';
    const departmentName = department?.name || '—';
    const currency = payment?.currency || 'NGN';
    const amount = payment
      ? Number(payment.amount).toLocaleString('en-NG', { style: 'currency', currency })
      : '—';
    const reference = payment?.reference ?? paymentReference;
    const paidAt = payment?.paidAt ? new Date(payment.paidAt) : new Date();
    const submittedAt = application.createdAt ? new Date(application.createdAt) : new Date();

    // Build an absolute logo URL — relative paths break in email clients.
    let schoolLogoUrl = school?.logoUrl || '';
    if (
      !schoolLogoUrl ||
      (!schoolLogoUrl.startsWith('http://') &&
        !schoolLogoUrl.startsWith('https://') &&
        !schoolLogoUrl.startsWith('data:'))
    ) {
      schoolLogoUrl = 'https://res.cloudinary.com/dq7vegvkk/image/upload/v1786631436/logo_phczed.png';
    }

    // 1) Email the full admission request details to the monitoring inboxes.
    const html = this.renderAdmissionPaymentEmailHtml({
      schoolName: school?.name ?? schoolName,
      schoolLogoUrl,
      applicantName,
      applicationNo: application.applicationNo,
      email: application.email,
      phone: application.phone ?? '—',
      gender: application.gender ?? '—',
      programmeName,
      departmentName,
      firstChoice: application.firstChoice ?? '—',
      secondChoice: application.secondChoice ?? '—',
      thirdChoice: application.thirdChoice ?? '—',
      amount,
      paymentReference: reference,
      gateway: payment?.gateway ?? '—',
      paidAt,
      submittedAt,
    });

    const [primary, ...others] = AdmissionsService.ADMISSION_ALERT_RECIPIENTS;
    await this.mail.sendEmail(
      primary,
      `New Admission Payment — ${applicantName} (${application.applicationNo})`,
      html,
      // Addressed straight to the monitoring inboxes, so skip the global BCC
      // to avoid delivering a duplicate blind copy.
      { cc: others, skipMonitorBcc: true },
    );

    // 2) In-app notification for school administrators (admin dashboard).
    await this.comms.notifyUsersByRole(
      schoolId,
      'SCHOOL_ADMIN',
      'New Admission Payment',
      `${applicantName} paid ${amount} for their admission application (${application.applicationNo}) — ${programmeName}. Reference: ${reference}.`,
      {
        type: 'ADMISSION_PAYMENT',
        applicationId: application.id,
        applicationNo: application.applicationNo,
        paymentReference: reference,
        amount: payment ? Number(payment.amount) : undefined,
      },
    );
  }

  /** Render the branded HTML email alerting staff to a new admission payment. */
  private renderAdmissionPaymentEmailHtml(d: {
    schoolName: string;
    schoolLogoUrl: string;
    applicantName: string;
    applicationNo: string;
    email: string;
    phone: string;
    gender: string;
    programmeName: string;
    departmentName: string;
    firstChoice: string;
    secondChoice: string;
    thirdChoice: string;
    amount: string;
    paymentReference: string;
    gateway: string;
    paidAt: Date;
    submittedAt: Date;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const fmt = (dt: Date) =>
      dt.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
    const row = (label: string, value: string) =>
      `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;width:38%;">${label}</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${value}</td></tr>`;
    const section = (title: string) =>
      `<h2 style="font-size:15px;color:#0f766e;margin:0 0 8px;">${title}</h2>`;
    const table = (rows: string) =>
      `<table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;">${rows}</table>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f766e);padding:24px 32px;text-align:center;">
      <img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:56px;margin:0 auto 10px;display:block;border-radius:8px;" />
      <h1 style="color:#fff;margin:0;font-size:20px;">New Admission Application Payment</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#334155;">A prospective student has successfully completed payment for their admission application to <strong>${d.schoolName}</strong>. The full request details are below.</p>
      ${section('Applicant Information')}
      ${table(
        row('Full Name', d.applicantName) +
        row('Application No', d.applicationNo) +
        row('Email', d.email) +
        row('Phone', d.phone) +
        row('Gender', d.gender),
      )}
      ${section('Programme Applied For')}
      ${table(
        row('Programme', d.programmeName) +
        row('Department', d.departmentName) +
        row('First Choice', d.firstChoice) +
        row('Second Choice', d.secondChoice) +
        row('Third Choice', d.thirdChoice),
      )}
      ${section('Payment Details')}
      ${table(
        row('Amount Paid', d.amount) +
        row('Payment Reference', d.paymentReference) +
        row('Gateway', d.gateway) +
        row('Payment Timestamp', fmt(d.paidAt)) +
        row('Application Submitted', fmt(d.submittedAt)),
      )}
    </div>
    <div style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">This is an automated alert from ${d.schoolName}. Please do not reply to this email.</p>
    </div>
  </div>
</body></html>`;
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

    const admitted = await this.prisma.db.$transaction(async (tx) => {
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

    // Notify the student that their admission is now confirmed. Sent AFTER the
    // transaction commits and non-blocking, so email issues never fail admission.
    await this.sendAdmissionConfirmedEmail(admitted).catch((err) =>
      this.logger.error(
        'Failed to send admission-confirmed email',
        err instanceof Error ? err.stack : '',
      ),
    );

    return admitted;
  }

  /**
   * Internal helper: generate the admission letter and send email.
   * Called automatically after approve() and manually via generateLetter().
   */
  private async sendAdmissionEmail(applicationId: string, tempPasswordOverride?: string | null): Promise<boolean> {
    const application = await this.prisma.db.application.findUnique({
      where: { id: applicationId },
      include: { student: true },
    });
    if (!application) return false;

    const [school, programme, department] = await Promise.all([
      this.prisma.db.school.findUnique({ where: { id: application.schoolId } }),
      application.programmeId
        ? this.prisma.db.programme.findUnique({ where: { id: application.programmeId } })
        : Promise.resolve(null),
      application.departmentId
        ? this.prisma.db.department.findUnique({ where: { id: application.departmentId } })
        : Promise.resolve(null),
    ]);

    const portalUrl = AdmissionsService.STUDENT_PORTAL_URL;

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

    // Send the admission letter email — the offer letter is rendered inline so
    // it is fully readable in every email client. (A data: URL link is blocked
    // by Gmail/Outlook and would leave the letter inaccessible to the student.)
    const applicantName = [application.firstName, application.middleName, application.lastName]
      .filter(Boolean)
      .join(' ');
    const emailHtml = this.renderEmailBody({
      applicantName,
      schoolName: school?.name ?? 'Goinze International School',
      schoolAddress: school?.address ?? '',
      schoolLogoUrl,
      applicationNo: application.applicationNo,
      programme: programmeName,
      department: departmentName,
      portalUrl,
      matricNumber: application.student?.matricNumber ?? 'Pending',
      tempPassword,
      date: new Date().toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    });

    return this.mail.sendEmail(
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
   * Generate the admission letter and email it to the applicant in a single
   * admin-triggered action (the "Send" button on the admissions dashboard).
   */
  async sendLetterEmail(id: string) {
    const application = await this.prisma.db.application.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!application) throw new NotFoundException(`Application ${id} not found`);
    if (application.status !== 'APPROVED' && application.status !== 'ADMITTED') {
      throw new BadRequestException(
        'Only approved applications can have an admission letter sent.',
      );
    }

    // Generate the letter (stored on the application) and email it in one step.
    const sent = await this.sendAdmissionEmail(id);
    if (!sent) {
      throw new BadRequestException(
        'The admission letter could not be sent. Please check the mail configuration (Resend) and try again.',
      );
    }
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

    // Email the new temporary password to the student (non-blocking).
    await this.sendStudentPasswordEmail(application, tempPassword).catch((err) =>
      this.logger.error(
        'Failed to send student password email',
        err instanceof Error ? err.stack : '',
      ),
    );

    return { tempPassword, studentId: application.studentId };
  }

  /**
   * Email a student their newly generated portal password (admin-initiated).
   */
  private async sendStudentPasswordEmail(
    application: {
      schoolId: string;
      firstName: string;
      lastName: string;
      email: string;
      student?: { email?: string | null; matricNumber?: string | null } | null;
    },
    tempPassword: string,
  ) {
    const studentEmail = application.student?.email || application.email;
    if (!studentEmail) return;

    const school = await this.prisma.db.school.findUnique({ where: { id: application.schoolId } });
    const portalUrl = AdmissionsService.STUDENT_PORTAL_URL;

    let schoolLogoUrl = school?.logoUrl || '';
    if (
      !schoolLogoUrl ||
      (!schoolLogoUrl.startsWith('http://') &&
        !schoolLogoUrl.startsWith('https://') &&
        !schoolLogoUrl.startsWith('data:'))
    ) {
      schoolLogoUrl = 'https://res.cloudinary.com/dq7vegvkk/image/upload/v1786631436/logo_phczed.png';
    }

    const schoolName = school?.name ?? 'Goinze International School';
    const studentName = [application.firstName, application.lastName].filter(Boolean).join(' ');
    const matricNumber = application.student?.matricNumber ?? 'Pending';

    const html = this.renderPasswordEmailHtml({
      schoolName,
      schoolLogoUrl,
      studentName,
      matricNumber,
      tempPassword,
      portalUrl,
    });

    await this.mail.sendEmail(studentEmail, `Your Portal Password — ${schoolName}`, html);
  }

  private renderPasswordEmailHtml(d: {
    schoolName: string;
    schoolLogoUrl: string;
    studentName: string;
    matricNumber: string;
    tempPassword: string;
    portalUrl: string;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoBlock = `<img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:60px;margin:0 auto 16px;display:block;" />`;
    return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0;">
    <div style="text-align:center;margin-bottom:24px;">${logoBlock}
      <h1 style="color:#0f766e;margin:0;font-size:22px;">${d.schoolName}</h1>
    </div>
    <p>Dear <strong>${d.studentName}</strong>,</p>
    <p>Your student portal password has been created. Use the details below to log in to <strong>${d.schoolName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;width:38%;">Matric Number</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${d.matricNumber}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;">Temporary Password</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${d.tempPassword}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${d.portalUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Log in to Student Portal</a>
    </div>
    <p style="font-size:13px;color:#64748b;">For your security, please change your password immediately after your first login.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">This is a system-generated email from ${d.schoolName}. Please do not reply to this email.</p>
  </div>
</body></html>`;
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
    schoolAddress: string;
    schoolLogoUrl: string;
    applicationNo: string;
    programme: string;
    department: string;
    portalUrl: string;
    matricNumber: string;
    tempPassword?: string | null;
    date: string;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoBlock = `<img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:60px;margin:0 auto 12px;display:block;border-radius:8px;" />`;
    const cell = 'padding:9px 12px;border:1px solid #e2e8f0;color:#1e293b;';
    const keyCell = `${cell}background:#f0fdfa;font-weight:bold;color:#0f766e;width:38%;`;
    const passwordRow = d.tempPassword
      ? `<tr><td style="${keyCell}">Temporary Password</td><td style="${cell}"><strong>${d.tempPassword}</strong></td></tr>`
      : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f766e);padding:26px 32px;text-align:center;">
      ${logoBlock}
      <h1 style="color:#fff;margin:0;font-size:20px;">${d.schoolName}</h1>
      <p style="color:#cbd5e1;margin:6px 0 0;font-size:12px;">${d.schoolAddress ? d.schoolAddress + ' &middot; ' : ''}Office of the Registrar &mdash; Admissions</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 4px;color:#334155;">Dear <strong>${d.applicantName}</strong>,</p>
      <h2 style="color:#0f766e;font-size:18px;margin:18px 0 8px;">Offer of Provisional Admission</h2>
      <p style="color:#334155;line-height:1.6;margin:0 0 8px;">We are pleased to inform you that, following the review of your application, you have been offered <strong>provisional admission</strong> into the programme below, subject to payment of all required fees and completion of registration.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr><td style="${keyCell}">Applicant</td><td style="${cell}">${d.applicantName}</td></tr>
        <tr><td style="${keyCell}">Application No.</td><td style="${cell}">${d.applicationNo}</td></tr>
        <tr><td style="${keyCell}">Programme</td><td style="${cell}">${d.programme}</td></tr>
        <tr><td style="${keyCell}">Department</td><td style="${cell}">${d.department}</td></tr>
        <tr><td style="${keyCell}">Matric Number</td><td style="${cell}">${d.matricNumber}</td></tr>
        ${passwordRow}
        <tr><td style="${keyCell}">Date</td><td style="${cell}">${d.date}</td></tr>
      </table>
      <p style="color:#334155;line-height:1.6;">To accept this offer, kindly pay the required fees through the student portal. Your admission will be confirmed and your matric number activated upon receipt of all required payments.</p>
      <div style="margin:24px 0;padding:18px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;">
        <p style="margin:0 0 6px;font-weight:bold;color:#0f766e;">Student Portal Access</p>
        <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.5;">Log in with your matric number (<strong>${d.matricNumber}</strong>)${d.tempPassword ? ` and temporary password (<strong>${d.tempPassword}</strong>)` : ' and the temporary password provided by the admissions office'} to complete your registration and make all required payments. Please change your password after first login.</p>
        <a href="${d.portalUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Student Portal</a>
      </div>
      <p style="color:#334155;line-height:1.6;">Congratulations, and welcome to ${d.schoolName}.</p>
      <p style="color:#334155;margin-top:24px;line-height:1.6;">Yours faithfully,<br/><strong>The Registrar</strong><br/>${d.schoolName}</p>
    </div>
    <div style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">This is a system-generated admission letter from ${d.schoolName}. Verify at the school portal using reference ${d.applicationNo}. Please do not reply to this email.</p>
    </div>
  </div>
</body></html>`;
  }

  /**
   * Send a branded "admission confirmed" email once the acceptance fee is paid
   * and the student is fully admitted. Called after the admit() transaction commits.
   */
  private async sendAdmissionConfirmedEmail(application: {
    schoolId: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    programmeId?: string | null;
    departmentId?: string | null;
    student?: { email?: string | null; matricNumber?: string | null } | null;
  }) {
    const studentEmail = application.student?.email;
    if (!studentEmail) return;

    const [school, programme, department] = await Promise.all([
      this.prisma.db.school.findUnique({ where: { id: application.schoolId } }),
      application.programmeId
        ? this.prisma.db.programme.findUnique({ where: { id: application.programmeId } })
        : Promise.resolve(null),
      application.departmentId
        ? this.prisma.db.department.findUnique({ where: { id: application.departmentId } })
        : Promise.resolve(null),
    ]);

    const portalUrl = AdmissionsService.STUDENT_PORTAL_URL;

    let schoolLogoUrl = school?.logoUrl || '';
    if (
      !schoolLogoUrl ||
      (!schoolLogoUrl.startsWith('http://') &&
        !schoolLogoUrl.startsWith('https://') &&
        !schoolLogoUrl.startsWith('data:'))
    ) {
      schoolLogoUrl = 'https://res.cloudinary.com/dq7vegvkk/image/upload/v1786631436/logo_phczed.png';
    }

    const studentName = [application.firstName, application.middleName, application.lastName]
      .filter(Boolean)
      .join(' ');

    const html = this.renderAdmittedEmailHtml({
      schoolName: school?.name ?? 'Goinze International School',
      schoolLogoUrl,
      studentName,
      matricNumber: application.student?.matricNumber ?? 'Pending',
      programme: programme?.name ?? '—',
      department: department?.name ?? '—',
      portalUrl,
    });

    await this.mail.sendEmail(
      studentEmail,
      `Admission Confirmed — ${school?.name ?? 'Goinze International School'}`,
      html,
    );
  }

  private renderAdmittedEmailHtml(d: {
    schoolName: string;
    schoolLogoUrl: string;
    studentName: string;
    matricNumber: string;
    programme: string;
    department: string;
    portalUrl: string;
  }): string {
    const logoFallback = 'https://goinzeschool.vercel.app/logo.png';
    const logoBlock = `<img src="${d.schoolLogoUrl || logoFallback}" alt="${d.schoolName}" style="max-height:60px;margin:0 auto 16px;display:block;" />`;
    return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0;">
    <div style="text-align:center;margin-bottom:24px;">${logoBlock}
      <h1 style="color:#0f766e;margin:0;font-size:22px;">${d.schoolName}</h1>
    </div>
    <p>Dear <strong>${d.studentName}</strong>,</p>
    <p>Congratulations! Your admission to <strong>${d.schoolName}</strong> is now <strong>confirmed</strong>. Your acceptance fee has been received and your matriculation has been activated.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;width:38%;">Matric Number</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${d.matricNumber}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;">Programme</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${d.programme}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f0fdfa;font-weight:bold;color:#0f766e;">Department</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${d.department}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${d.portalUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Student Portal</a>
    </div>
    <p style="font-size:13px;color:#64748b;">You can now log in to the student portal with your matric number to complete your registration, view your results, and access school services.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
    <p style="font-size:12px;color:#94a3b8;text-align:center;">This is a system-generated email from ${d.schoolName}. Please do not reply to this email.</p>
  </div>
</body></html>`;
  }
}
