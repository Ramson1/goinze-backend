import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Paginated } from '../lib/types';
import { generatePaymentRef, generateReceiptNumber, generateVerificationCode } from '../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import { FlutterwaveGateway } from './flutterwave.gateway';
import { PaystackGateway } from './paystack.gateway';
import { CommunicationService } from '../communication/communication.service';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  InitPaymentDto,
  VerifyPaymentDto,
  RefundDto,
  CreateScholarshipDto,
  CreateManualPaymentDto,
} from './dto/finance.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: FlutterwaveGateway,
    private readonly paystackGateway: PaystackGateway,
    private readonly config: ConfigService,
    private readonly comms: CommunicationService,
  ) {}

  // ---- Fee structures ----
  listFeeStructures(schoolId: string | null) {
    return this.prisma.db.feeStructure.findMany({
      where: schoolId ? { schoolId } : {},
      include: { session: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createFeeStructure(schoolId: string | null, dto: CreateFeeStructureDto) {
    return this.prisma.db.feeStructure.create({
      data: {
        schoolId: schoolId ?? '',
        name: dto.name,
        type: (dto.type as any) ?? 'SCHOOL',
        amount: dto.amount,
        sessionId: dto.sessionId,
        level: dto.level,
        semester: dto.semester as any,
        programmeId: dto.programmeId,
        departmentId: dto.departmentId,
        isMandatory: dto.isMandatory ?? true,
        allowInstallment: dto.allowInstallment ?? false,
      },
    });
  }

  async updateFeeStructure(id: string, schoolId: string | null, dto: UpdateFeeStructureDto) {
    const existing = await this.prisma.db.feeStructure.findUnique({ where: { id } });
    if (!existing || (schoolId && existing.schoolId !== schoolId)) {
      throw new NotFoundException('Fee structure not found');
    }
    return this.prisma.db.feeStructure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type as any }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.sessionId !== undefined && { sessionId: dto.sessionId }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.semester !== undefined && { semester: dto.semester as any }),
        ...(dto.programmeId !== undefined && { programmeId: dto.programmeId }),
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
        ...(dto.isMandatory !== undefined && { isMandatory: dto.isMandatory }),
        ...(dto.allowInstallment !== undefined && { allowInstallment: dto.allowInstallment }),
      },
    });
  }

  async deleteFeeStructure(id: string, schoolId: string | null) {
    const existing = await this.prisma.db.feeStructure.findUnique({ where: { id } });
    if (!existing || (schoolId && existing.schoolId !== schoolId)) {
      throw new NotFoundException('Fee structure not found');
    }
    return this.prisma.db.feeStructure.delete({ where: { id } });
  }

  // ---- Payments ----
  async listPayments(
    schoolId: string | null,
    query: PaginationDto,
    status?: string,
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (status) where.status = status;
    if (query.search) {
      where.reference = { contains: query.search, mode: 'insensitive' };
    }
    const result = await paginated(this.prisma.db.payment, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: {
        student: true,
        feeStructure: true,
        receipt: true,
        application: {
          include: {
            student: true,
          },
        },
      },
    });

    // Resolve student from application when direct student is null
    result.items = result.items.map((p: any) => {
      if (!p.student && p.application?.student) {
        p.student = p.application.student;
      }
      return p;
    });

    return result;
  }

  /**
   * Initialize a payment record in the DB and return the reference.
   * The frontend uses this reference with Flutterwave inline checkout,
   * which creates its own transaction on Flutterwave with the correct
   * customer email. We do NOT call gateway.initialize() here because
   * that would create a server-side transaction whose merchant context
   * overrides the customer email in the inline checkout.
   */
  async initPayment(schoolId: string | null, dto: InitPaymentDto) {
    const reference = generatePaymentRef();

    // Resolve a customer email + owning school from the application or student
    // so unauthenticated applicants can pay the acceptance fee.
    let resolvedSchoolId = schoolId;
    if (dto.applicationId) {
      const app = await this.prisma.db.application.findUnique({
        where: { id: dto.applicationId },
      });
      resolvedSchoolId = resolvedSchoolId ?? app?.schoolId ?? null;
    }
    if (!resolvedSchoolId && dto.studentId) {
      const student = await this.prisma.db.student.findUnique({
        where: { id: dto.studentId },
      });
      resolvedSchoolId = resolvedSchoolId ?? student?.schoolId ?? null;
    }

    // Fall back to resolving the school from the slug (website admission flow)
    if (!resolvedSchoolId && dto.schoolSlug) {
      const school = await this.prisma.db.school.findFirst({
        where: { slug: dto.schoolSlug },
      });
      resolvedSchoolId = school?.id ?? null;
    }

    if (!resolvedSchoolId) {
      throw new BadRequestException(
        'Unable to resolve a school for this payment. Provide an applicationId, studentId, or schoolSlug.',
      );
    }

    // Check developer payment setting if purpose is DEVELOPER_ACCESS
    if (dto.purpose === 'DEVELOPER_ACCESS') {
      const devPaymentSetting = await this.prisma.db.schoolSetting.findUnique({
        where: { schoolId_key: { schoolId: resolvedSchoolId, key: 'payment.developer_payment_enabled' } },
      });
      if (devPaymentSetting && devPaymentSetting.value === false) {
        throw new BadRequestException('Developer account payments are currently disabled.');
      }
    }

    const payment = await this.prisma.db.payment.create({
      data: {
        schoolId: resolvedSchoolId,
        studentId: dto.studentId,
        applicationId: dto.applicationId,
        feeStructureId: dto.feeStructureId,
        reference,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        gateway: (dto.gateway as any) ?? 'FLUTTERWAVE',
        status: 'PENDING',
        metadata: dto.purpose ? { purpose: dto.purpose } : undefined,
      },
    });

    // Return just the DB record and reference.
    // The frontend will use the gateway inline checkout with this reference,
    // passing the customer email directly to the gateway.
    const chosenGateway = dto.gateway === 'PAYSTACK' ? this.paystackGateway : this.gateway;
    return { payment, reference, checkoutUrl: '', live: chosenGateway.isConfigured };
  }

  /**
   * Verify a payment by reference, mark it successful, post a ledger credit,
   * and — for acceptance-fee payments — advance the linked application.
   */
  /**
   * Get payment status by reference (for polling fallback).
   */
  async getPaymentStatus(reference: string) {
    const payment = await this.prisma.db.payment.findUnique({
      where: { reference },
      select: { status: true },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return { status: payment.status };
  }

  async verifyPayment(dto: VerifyPaymentDto) {
    const payment = await this.prisma.db.payment.findUnique({
      where: { reference: dto.reference },
      include: {
        school: true,
        student: { include: { department: true, programme: true } },
        feeStructure: true,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    // Already verified — return existing data with receipt
    if (payment.status === 'SUCCESS') {
      const existingReceipt = await this.prisma.db.receipt.findUnique({
        where: { paymentId: payment.id },
      });
      return { ...payment, receipt: existingReceipt };
    }

    // Verify against the correct gateway based on the payment record
    let result: { status: string; amount: number; currency: string; txRef: string; flwRef?: string; gatewayRef?: string };

    if (payment.gateway === 'PAYSTACK') {
      const paystackResult = await this.paystackGateway.verify(dto.reference);
      result = {
        status: paystackResult.status === 'success' ? 'successful' : paystackResult.status,
        amount: paystackResult.amount,
        currency: paystackResult.currency,
        txRef: paystackResult.txRef,
        gatewayRef: paystackResult.gatewayRef,
      };

      // If Paystack primary fails, try secondary account (Portal Access Fee)
      if (result.status !== 'successful') {
        try {
          const secondaryResult = await this.paystackGateway.verifyWithPortalAccessKey(dto.reference);
          if (secondaryResult.status === 'success') {
            return this.processSuccessfulPayment(payment, {
              status: 'successful',
              amount: secondaryResult.amount,
              currency: secondaryResult.currency,
              txRef: secondaryResult.txRef,
              gatewayRef: secondaryResult.gatewayRef,
            }, dto);
          }
        } catch (err) {
          this.logger.warn('Paystack portal access key verification also failed');
        }
        throw new BadRequestException(
          `Payment not successful (gateway status: ${result.status}).`,
        );
      }
    } else {
      // Default to Flutterwave (FLUTTERWAVE, BANK_TRANSFER, CASH, etc.)
      const flwResult = await this.gateway.verify(dto.reference);
      result = {
        status: flwResult.status,
        amount: flwResult.amount,
        currency: flwResult.currency,
        txRef: flwResult.txRef,
        flwRef: flwResult.flwRef,
      };

      // If Flutterwave primary fails, try secondary account (Portal Access Fee)
      if (result.status !== 'successful') {
        try {
          const secondaryResult = await this.gateway.verifyWithPortalAccessKey(dto.reference);
          if (secondaryResult.status === 'successful') {
            return this.processSuccessfulPayment(payment, secondaryResult, dto);
          }
        } catch (err) {
          this.logger.warn('Portal access key verification also failed');
        }
        throw new BadRequestException(
          `Payment not successful (gateway status: ${result.status}).`,
        );
      }
    }

    if (result.status !== 'successful') {
      throw new BadRequestException(
        `Payment not successful (gateway status: ${result.status}).`,
      );
    }

    return this.processSuccessfulPayment(payment, result, dto);
  }

  /**
   * Process a successful payment verification: update payment status, credit ledger,
   * handle application fees, generate receipt, and notify admin.
   */
  private async processSuccessfulPayment(
    payment: any,
    result: any,
    dto: VerifyPaymentDto,
  ) {
    // Use a transaction to prevent duplicate processing from concurrent webhooks
    const updated = await this.prisma.db.$transaction(async (tx) => {
      // Re-check status inside transaction (optimistic locking)
      const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
      if (fresh?.status === 'SUCCESS') {
        return { ...fresh, alreadyProcessed: true };
      }

      const pay = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          gatewayRef: result.flwRef || result.gatewayRef || dto.gatewayRef,
          paidAt: new Date(),
        },
      });

      // Credit the student ledger when applicable
      if (pay.studentId) {
        await tx.ledgerEntry.create({
          data: {
            studentId: pay.studentId,
            paymentId: pay.id,
            credit: Number(pay.amount),
            balance: Number(pay.amount),
            narration: `Payment ${pay.reference}`,
          },
        });
      }

      // Application form fee flow
      const purpose = (pay.metadata as any)?.purpose;
      if (pay.applicationId && (purpose === 'APPLICATION_FORM' || purpose === 'ENTRANCE_EXAM')) {
        await tx.application.update({
          where: { id: pay.applicationId },
          data: { applicationFormFeePaid: true },
        });
      }

      // Acceptance-fee flow
      if (pay.applicationId && purpose !== 'APPLICATION_FORM' && purpose !== 'ENTRANCE_EXAM') {
        await this.onAcceptanceFeePaid(pay.applicationId, tx);
      }

      // Auto-generate receipt
      const receipt = await tx.receipt.create({
        data: {
          paymentId: pay.id,
          receiptNumber: generateReceiptNumber(),
          verificationCode: generateVerificationCode(),
          qrData: `goinzeschool://receipt/${generateVerificationCode()}`,
        },
      });

      return { ...pay, receipt };
    });

    // Return with full relations for the receipt
    const response = {
      ...payment,
      ...updated,
      receipt: (updated as any).receipt,
    };

    // Notify admin about the payment
    if (payment.schoolId && !(updated as any).alreadyProcessed) {
      const studentName = payment.student
        ? `${payment.student.firstName} ${payment.student.lastName}`
        : 'A student';
      const feeName = payment.feeStructure?.name ?? 'fees';
      this.comms
        .notifyUsersByRole(
          payment.schoolId,
          'SCHOOL_ADMIN',
          'Payment Received',
          `${studentName} made a payment of ${Number(payment.amount).toLocaleString()} for ${feeName}.`,
        )
        .catch((err) => this.logger.error('Failed to send payment notification', err instanceof Error ? err.stack : ''));
    }

    return response;
  }

  /**
   * Handle a successful acceptance-fee payment for an application:
   * flag it paid, then finalize admission if the application is approved.
   */
  private async onAcceptanceFeePaid(applicationId: string, tx?: any) {
    const db = tx ?? this.prisma.db;
    const application = await db.application.update({
      where: { id: applicationId },
      data: { acceptanceFeePaid: true },
    });

    if (application.status === 'APPROVED' && application.studentId) {
      await Promise.all([
        db.student.update({
          where: { id: application.studentId },
          data: { status: 'ACTIVE' },
        }),
        db.application.update({
          where: { id: applicationId },
          data: { status: 'ADMITTED' },
        }),
      ]);
    }
  }

  /** Create a manual (cash/admin) payment for a student — immediately marked SUCCESS. */
  async createManualPayment(schoolId: string | null, dto: CreateManualPaymentDto, adminId: string) {
    const student = await this.prisma.db.student.findUnique({
      where: { id: dto.studentId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const resolvedSchoolId = schoolId ?? student.schoolId;
    const reference = dto.reference || generatePaymentRef();

    const payment = await this.prisma.db.payment.create({
      data: {
        schoolId: resolvedSchoolId,
        studentId: dto.studentId,
        feeStructureId: dto.feeStructureId,
        reference,
        amount: dto.amount,
        currency: 'NGN',
        gateway: 'CASH',
        status: 'SUCCESS',
        paidAt: new Date(),
        metadata: { description: dto.description, narration: dto.narration, createdBy: adminId },
      },
    });

    // Credit the student ledger
    await this.prisma.db.ledgerEntry.create({
      data: {
        studentId: dto.studentId,
        paymentId: payment.id,
        credit: Number(dto.amount),
        balance: Number(dto.amount),
        narration: dto.narration || `Manual payment: ${dto.description}`,
      },
    });

    // Auto-generate receipt
    const receipt = await this.prisma.db.receipt.create({
      data: {
        paymentId: payment.id,
        receiptNumber: generateReceiptNumber(),
        verificationCode: generateVerificationCode(),
        qrData: `goinzeschool://receipt/${generateVerificationCode()}`,
      },
    });

    return { ...payment, receipt };
  }

  /** Process a Flutterwave webhook event (charge.completed). */
  async handleWebhook(payload: any, signature?: string) {
    // Verify webhook signature if FLUTTERWAVE_WEBHOOK_HASH is configured
    const webhookHash = this.gateway.webhookHash;
    if (webhookHash) {
      if (!signature) {
        this.logger.warn('Webhook received without verifi-hash header');
        throw new UnauthorizedException('Missing webhook signature');
      }
      // Flutterwave sends a SHA256 hash of the payload as the verifi-hash
      const expectedHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      // Also check against the configured secret hash
      if (signature !== webhookHash && signature !== expectedHash) {
        this.logger.warn('Webhook signature mismatch');
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    const txRef: string | undefined =
      payload?.data?.tx_ref ?? payload?.tx_ref ?? payload?.data?.txRef;
    if (!txRef) return { ignored: true };

    const payment = await this.prisma.db.payment.findUnique({
      where: { reference: txRef },
    });
    if (!payment || payment.status === 'SUCCESS') {
      return { ignored: true };
    }
    await this.verifyPayment({ reference: txRef });
    return { processed: true, reference: txRef };
  }

  /** Process a Paystack webhook event. */
  async handlePaystackWebhook(payload: any, signature?: string) {
    // Verify webhook signature if PAYSTACK_WEBHOOK_SECRET is configured
    const webhookSecret = this.paystackGateway.webhookSecret;
    if (webhookSecret) {
      if (!signature) {
        this.logger.warn('Paystack webhook received without signature');
        throw new UnauthorizedException('Missing webhook signature');
      }
      // Paystack uses HMAC SHA256 signature
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
      if (signature !== expectedSignature) {
        this.logger.warn('Paystack webhook signature mismatch');
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    // Paystack sends various event types; we care about charge.success
    const event = payload?.event;
    const data = payload?.data;
    if (event !== 'charge.success') {
      return { ignored: true, reason: `Event ${event} not handled` };
    }

    const reference: string | undefined = data?.reference;
    if (!reference) return { ignored: true };

    const payment = await this.prisma.db.payment.findUnique({
      where: { reference },
    });
    if (!payment || payment.status === 'SUCCESS') {
      return { ignored: true };
    }
    await this.verifyPayment({ reference });
    return { processed: true, reference };
  }

  /**
   * Get available payment gateways for a school.
   * Reads SchoolSetting keys to determine which gateways are enabled,
   * and cross-references with env-level configuration.
   */
  async getAvailableGateways(schoolId: string | null): Promise<{
    gateways: { id: string; name: string; publicKey: string; enabled: boolean }[];
  }> {
    const gateways: { id: string; name: string; publicKey: string; enabled: boolean }[] = [];

    // Read gateway settings from DB
    let flutterwaveEnabled = true;
    let paystackEnabled = true;
    if (schoolId) {
      const settings = await this.prisma.db.schoolSetting.findMany({
        where: {
          schoolId,
          key: { in: ['payment.flutterwave_enabled', 'payment.paystack_enabled'] },
        },
      });
      for (const s of settings) {
        if (s.key === 'payment.flutterwave_enabled') flutterwaveEnabled = s.value !== false;
        if (s.key === 'payment.paystack_enabled') paystackEnabled = s.value !== false;
      }
    }

    // Flutterwave — include if enabled in settings (regardless of key configuration)
    if (flutterwaveEnabled) {
      gateways.push({
        id: 'FLUTTERWAVE',
        name: 'Flutterwave',
        publicKey: this.gateway.publicKey || '',
        enabled: true,
      });
    }

    // Paystack — include if enabled in settings (regardless of key configuration)
    if (paystackEnabled) {
      gateways.push({
        id: 'PAYSTACK',
        name: 'Paystack',
        publicKey: this.paystackGateway.publicKey || '',
        enabled: true,
      });
    }

    return { gateways };
  }

  /**
   * Get available payment gateways for Portal Access fee (secondary accounts).
   * Uses separate settings keys (payment.portal_access_*) so portal access
   * gateway visibility can be controlled independently from student payments.
   */
  async getPortalAccessGateways(schoolId: string | null): Promise<{
    gateways: { id: string; name: string; publicKey: string; enabled: boolean }[];
  }> {
    const gateways: { id: string; name: string; publicKey: string; enabled: boolean }[] = [];

    // Read portal-access-specific gateway settings from DB
    let flutterwaveEnabled = true;
    let paystackEnabled = true;
    if (schoolId) {
      const settings = await this.prisma.db.schoolSetting.findMany({
        where: {
          schoolId,
          key: { in: ['payment.portal_access_flutterwave_enabled', 'payment.portal_access_paystack_enabled'] },
        },
      });
      for (const s of settings) {
        if (s.key === 'payment.portal_access_flutterwave_enabled') flutterwaveEnabled = s.value !== false;
        if (s.key === 'payment.portal_access_paystack_enabled') paystackEnabled = s.value !== false;
      }
    }

    // Include gateways that are enabled in settings (regardless of key configuration)
    if (flutterwaveEnabled) {
      gateways.push({
        id: 'FLUTTERWAVE',
        name: 'Flutterwave',
        publicKey: this.gateway.portalAccessPublicKey || '',
        enabled: true,
      });
    }

    if (paystackEnabled) {
      gateways.push({
        id: 'PAYSTACK',
        name: 'Paystack',
        publicKey: this.paystackGateway.portalAccessPublicKey || '',
        enabled: true,
      });
    }

    // Fallback: if no portal access gateways, return primary gateways
    if (gateways.length === 0) {
      return this.getAvailableGateways(schoolId);
    }

    return { gateways };
  }

  // ---- Application fees (pre-submission) ----

  /** Return the configured APPLICATION_FORM and ENTRANCE_EXAM fee structures. */
  async getApplicationFees(schoolId: string | null) {
    const fees = await this.prisma.db.feeStructure.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        type: { in: ['APPLICATION_FORM', 'ENTRANCE_EXAM'] },
      },
      orderBy: { type: 'asc' },
    });
    return fees.map((f) => ({
      id: f.id,
      type: f.type,
      name: f.name,
      amount: Number(f.amount),
    }));
  }

  // ---- Refunds ----
  async refund(dto: RefundDto, approvedBy: string) {
    const payment = await this.prisma.db.payment.findUnique({
      where: { id: dto.paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const refund = await this.prisma.db.refund.create({
      data: {
        paymentId: payment.id,
        amount: dto.amount ?? Number(payment.amount),
        reason: dto.reason,
        approvedBy,
      },
    });

    await this.prisma.db.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED' },
    });

    return refund;
  }

  // ---- Scholarships ----
  listScholarships(schoolId: string | null) {
    return this.prisma.db.scholarship.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  createScholarship(schoolId: string | null, dto: CreateScholarshipDto) {
    return this.prisma.db.scholarship.create({
      data: {
        schoolId: schoolId ?? '',
        studentId: dto.studentId,
        name: dto.name,
        percentage: dto.percentage,
        amount: dto.amount,
        reason: dto.reason,
      },
    });
  }

  // ---- Ledger ----
  ledgerForStudent(studentId: string) {
    return this.prisma.db.ledgerEntry.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---- Student fee breakdown (admin) ----
  async studentFeeBreakdown(studentId: string) {
    const student = await this.prisma.db.student.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('Student not found');

    // Get current session
    const currentSession = await this.prisma.db.academicSession.findFirst({
      where: { schoolId: student.schoolId, isCurrent: true },
    });

    // Fetch ALL sessions for chronological ordering (used by two-level locking)
    const allSessions = await this.prisma.db.academicSession.findMany({
      where: { schoolId: student.schoolId },
      orderBy: { startDate: 'asc' },
    });
    const sessionOrder = new Map(allSessions.map((ses, idx) => [ses.id, idx]));

    // Determine current semester from latest course registration
    const latestReg = await this.prisma.db.courseRegistration.findFirst({
      where: { studentId: student.id, sessionId: currentSession?.id },
      orderBy: { createdAt: 'desc' },
    });
    const currentSemester = latestReg?.semester ?? 'FIRST';

    const [structures, payments] = await Promise.all([
      this.prisma.db.feeStructure.findMany({
        where: {
          schoolId: student.schoolId,
          AND: [
            { OR: [{ departmentId: null }, { departmentId: student.departmentId }] },
            { OR: [{ level: null }, { level: student.currentLevel }] },
          ],
        },
        include: { session: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.payment.findMany({
        where: { studentId: student.id, status: 'SUCCESS' },
        include: { receipt: true, feeStructure: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Include all fee structures — mandatory and optional (optional fees shown for student opt-in)
    const applicableFees = structures;

    // Define display order within a semester: Portal Access first, Tuition (SCHOOL) last
    const typeOrder: Record<string, number> = {
      PORTAL_ACCESS: 0,
      LIBRARY: 1,
      MEDICAL: 2,
      SPORTS_WEAR: 3,
      MATRICULATION: 4,
      HOSTEL: 5,
      GRADUATION: 6,
      ACCEPTANCE: 7,
      OTHER: 8,
      SCHOOL: 99, // Tuition is always last
    };

    const semesterOrder: Record<string, number> = { FIRST: 0, SECOND: 1, THIRD: 2 };

    // Build payment lookup maps for O(1) matching instead of O(n×m)
    const paymentsByFeeId = new Map<string, typeof payments>();
    const paymentsWithoutFeeId: typeof payments = [];
    for (const p of payments) {
      if (p.feeStructureId) {
        const arr = paymentsByFeeId.get(p.feeStructureId) ?? [];
        arr.push(p);
        paymentsByFeeId.set(p.feeStructureId, arr);
      } else {
        paymentsWithoutFeeId.push(p);
      }
    }

    // Track which payments have been matched so we don't double-count
    const matchedPaymentIds = new Set<string>();

    // Build items with session/semester metadata
    const items = applicableFees.map((f) => {
      // First: exact match by feeStructureId (O(1) lookup)
      let paid: typeof payments[0] | undefined;
      const candidates = paymentsByFeeId.get(f.id);
      if (candidates) {
        paid = candidates.find((p) => !matchedPaymentIds.has(p.id));
      }
      // Fallback: match by type + amount for payments not linked to a specific fee structure
      if (!paid) {
        paid = paymentsWithoutFeeId.find(
          (p) =>
            !matchedPaymentIds.has(p.id) &&
            p.feeStructure?.type === f.type &&
            Number(p.amount) === Number(f.amount),
        );
      }
      if (paid) matchedPaymentIds.add(paid.id);

      // Application form and entrance exam fees are always paid during admission
      const preAdmissionTypes = ['APPLICATION_FORM', 'ENTRANCE_EXAM'];
      const isPreAdmissionFee = preAdmissionTypes.includes(f.type);

      return {
        id: f.id,
        description: f.name,
        type: f.type,
        amount: Number(f.amount),
        status: (paid || isPreAdmissionFee) ? ('PAID' as const) : ('PENDING' as const),
        ref: paid?.reference ?? (isPreAdmissionFee ? 'PRE-ADMISSION' : null),
        paidAt: paid?.paidAt ?? null,
        isOptional: !f.isMandatory,
        sessionName: (f as any).session?.name ?? currentSession?.name ?? 'General',
        semester: (f.semester ?? 'FIRST') as string,
        sessionId: f.sessionId ?? currentSession?.id ?? null,
        typeOrder: typeOrder[f.type] ?? 9,
      };
    });

    // Group items by (sessionId, semester) for two-level locking
    const groupMap = new Map<string, typeof items>();
    for (const item of items) {
      const key = `${item.sessionId}|||${item.semester}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }

    // Sort within each group by typeOrder, then name
    for (const groupItems of groupMap.values()) {
      groupItems.sort((a, b) => {
        if (a.typeOrder !== b.typeOrder) return a.typeOrder - b.typeOrder;
        return a.description.localeCompare(b.description);
      });
    }

    // Sort groups chronologically: by session order, then semester order
    const sortedGroups = [...groupMap.entries()].sort(([keyA], [keyB]) => {
      const [sesA, semA] = keyA.split('|||');
      const [sesB, semB] = keyB.split('|||');
      const orderA = sessionOrder.get(sesA) ?? 999;
      const orderB = sessionOrder.get(sesB) ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return (semesterOrder[semA] ?? 0) - (semesterOrder[semB] ?? 0);
    });

    // Two-level locking: semester-level + item-level within semester
    let allPreviousSemestersPaid = true;
    const allItems: (Omit<typeof items[0], 'typeOrder'> & { locked: boolean })[] = [];

    for (const [, groupItems] of sortedGroups) {
      let foundUnpaidInGroup = false;
      for (const item of groupItems) {
        let locked: boolean;
        if (!allPreviousSemestersPaid) {
          locked = true;
        } else if (item.status === 'PAID') {
          locked = false;
        } else if (!foundUnpaidInGroup) {
          foundUnpaidInGroup = true;
          locked = false; // this is the next one to pay
        } else {
          locked = true;
        }
        const { typeOrder: _to, ...rest } = item;
        allItems.push({ ...rest, locked });
      }
      if (groupItems.some((i) => i.status === 'PENDING')) {
        allPreviousSemestersPaid = false;
      }
    }

    const total = allItems.reduce((sum, i) => sum + i.amount, 0);
    const paidTotal = allItems.filter((i) => i.status === 'PAID').reduce((sum, i) => sum + i.amount, 0);

    return { items: allItems, summary: { total, paid: paidTotal, outstanding: total - paidTotal } };
  }

  // ---- Dashboard summary ----
  async dashboardSummary(schoolId: string | null) {
    const where = schoolId ? { schoolId } : {};
    const [
      totalCollected,
      pendingCount,
      pendingAmount,
      totalCount,
      refundedCount,
      refundedAmount,
    ] = await Promise.all([
      this.prisma.db.payment.aggregate({
        where: { ...where, status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.db.payment.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.db.payment.aggregate({
        where: { ...where, status: 'PENDING' },
        _sum: { amount: true },
      }),
      this.prisma.db.payment.count({ where }),
      this.prisma.db.payment.count({ where: { ...where, status: 'REFUNDED' } }),
      this.prisma.db.payment.aggregate({
        where: { ...where, status: 'REFUNDED' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalCollected: Number(totalCollected._sum.amount ?? 0),
      pendingCount,
      pendingAmount: Number(pendingAmount._sum.amount ?? 0),
      totalCount,
      refundedCount,
      refundedAmount: Number(refundedAmount._sum.amount ?? 0),
    };
  }
}
