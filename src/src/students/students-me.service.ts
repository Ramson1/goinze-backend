import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeGpa, generateCardNumber, generateVerificationCode } from '../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import type { RegisterCoursesDto } from './dto/students-me.dto';

/**
 * Student-scoped "me" data for the student portal.
 * Every method resolves the Student record linked to the authenticated user.
 */
@Injectable()
export class StudentsMeService {
  private readonly logger = new Logger(StudentsMeService.name);

  /** Credit-unit bounds enforced when a student submits a registration. */
  static readonly MIN_UNITS = 15;
  static readonly MAX_UNITS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationService,
  ) {}

  /** Resolve the Student record for the authenticated user. */
  async resolveStudent(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { student: true },
    });
    if (!user?.student) {
      throw new ForbiddenException('This account is not linked to a student record.');
    }
    const student = await this.prisma.db.student.findUnique({
      where: { id: user.student.id },
      include: {
        programme: true,
        department: { include: { faculty: true } },
        entrySession: true,
      },
    });
    if (!student) throw new NotFoundException('Student record not found.');
    return student;
  }

  /** Full profile for the portal (bio-data, programme, guardian, medical). */
  async profile(userId: string) {
    const s = await this.resolveStudent(userId);
    const currentSession = await this.prisma.db.academicSession.findFirst({
      where: { schoolId: s.schoolId, isCurrent: true },
    });
    return {
      id: s.id,
      matricNo: s.matricNumber,
      regNumber: s.regNumber,
      firstName: s.firstName,
      middleName: s.middleName,
      lastName: s.lastName,
      gender: s.gender,
      dateOfBirth: s.dateOfBirth,
      email: s.email,
      phone: s.phone,
      address: s.address,
      stateOfOrigin: s.stateOfOrigin,
      nationality: s.nationality,
      passportUrl: s.passportUrl,
      status: s.status,
      currentLevel: s.currentLevel,
      faculty: s.department?.faculty?.name ?? null,
      department: s.department?.name ?? null,
      programme: s.programme?.name ?? null,
      session: currentSession?.name ?? s.entrySession?.name ?? null,
      guardian: {
        name: s.guardianName,
        relationship: s.guardianRelation,
        phone: s.guardianPhone,
        email: s.guardianEmail,
      },
      medical: {
        bloodGroup: s.bloodGroup,
        genotype: s.genotype,
        notes: s.medicalNotes,
      },
    };
  }

  /** Digital ID card — fetch existing or issue a new one. */
  async digitalId(userId: string) {
    const s = await this.resolveStudent(userId);
    let card = await this.prisma.db.idCard.findFirst({
      where: { studentId: s.id, status: 'ACTIVE' },
      orderBy: { issuedAt: 'desc' },
    });

    if (!card) {
      const school = await this.prisma.db.school.findUnique({ where: { id: s.schoolId } });
      const cardNumber = generateCardNumber(school?.code ?? 'GDU');
      const verificationCode = generateVerificationCode();
      card = await this.prisma.db.idCard.create({
        data: {
          schoolId: s.schoolId,
          type: 'STUDENT',
          studentId: s.id,
          cardNumber,
          verificationCode,
          qrData: JSON.stringify({
            t: 'STUDENT_ID',
            matric: s.matricNumber,
            name: `${s.firstName} ${s.lastName}`,
            code: verificationCode,
          }),
          photoUrl: s.passportUrl,
          expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
          status: 'ACTIVE',
        },
      });
    }

    return {
      cardNumber: card.cardNumber,
      verificationCode: card.verificationCode,
      qrData: card.qrData,
      photoUrl: card.photoUrl,
      issuedAt: card.issuedAt,
      expiresAt: card.expiresAt,
      status: card.status,
      student: {
        firstName: s.firstName,
        lastName: s.lastName,
        matricNo: s.matricNumber,
        programme: s.programme?.name ?? null,
        department: s.department?.name ?? null,
        level: s.currentLevel,
      },
    };
  }

  /** Fees (from fee structures) reconciled against the student's payments. */
  async fees(userId: string) {
    const s = await this.resolveStudent(userId);

    // Get current session
    const currentSession = await this.prisma.db.academicSession.findFirst({
      where: { schoolId: s.schoolId, isCurrent: true },
    });

    // Fetch ALL sessions for chronological ordering (used by two-level locking)
    const allSessions = await this.prisma.db.academicSession.findMany({
      where: { schoolId: s.schoolId },
      orderBy: { startDate: 'asc' },
    });
    const sessionOrder = new Map(allSessions.map((ses, idx) => [ses.id, idx]));

    // Determine current semester from latest course registration
    const latestReg = await this.prisma.db.courseRegistration.findFirst({
      where: { studentId: s.id, sessionId: currentSession?.id },
      orderBy: { createdAt: 'desc' },
    });
    const currentSemester = latestReg?.semester ?? 'FIRST';

    const [structures, payments] = await Promise.all([
      this.prisma.db.feeStructure.findMany({
        where: {
          schoolId: s.schoolId,
          AND: [
            { OR: [{ departmentId: null }, { departmentId: s.departmentId }] },
            { OR: [{ level: null }, { level: s.currentLevel }] },
          ],
        },
        include: { session: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.payment.findMany({
        where: { studentId: s.id, status: 'SUCCESS' },
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
        paidAt: paid?.paidAt ?? (isPreAdmissionFee ? null : null),
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

    const receipts = payments
      .map((p) => ({
        id: p.id,
        receiptNo: p.receipt?.receiptNumber ?? p.reference,
        description: p.feeStructure?.name ?? (p.feeStructureId ? 'Fee payment' : 'Payment'),
        amount: Number(p.amount),
        date: p.paidAt ?? p.createdAt,
        method: p.gateway,
        verificationCode: p.receipt?.verificationCode ?? null,
        status: 'SUCCESS' as const,
        reference: p.reference,
      }));

    return { items: allItems, receipts, summary: { total, paid: paidTotal, outstanding: total - paidTotal } };
  }

  /** Results grouped by session/semester with GPA + cumulative GPA. */
  async results(userId: string) {
    const s = await this.resolveStudent(userId);
    const results = await this.prisma.db.result.findMany({
      where: { studentId: s.id, status: 'PUBLISHED' },
      include: { course: true, session: true },
      orderBy: [{ sessionId: 'asc' }, { semester: 'asc' }],
    });

    const groups = new Map<string, typeof results>();
    for (const r of results) {
      const key = `${r.sessionId}|${r.semester}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const semesters = Array.from(groups.values()).map((rows) => {
      const first = rows[0];
      const courses = rows.map((r) => ({
        resultId: r.id,
        code: r.course.code,
        title: r.course.title,
        units: r.course.creditUnits,
        session: r.session?.name ?? '',
        score: Number(r.totalScore),
        grade: r.grade,
      }));
      const gpa = computeGpa(courses.map((c) => ({ creditUnits: c.units, score: c.score })));
      return {
        id: `${first.sessionId}-${first.semester}`,
        session: first.session?.name ?? '',
        semester: this.semesterLabel(first.semester),
        level: first.course.level,
        courses,
        gpa: gpa.gpa,
      };
    });

    const allCourses = results.map((r) => ({
      creditUnits: r.course.creditUnits,
      score: Number(r.totalScore),
    }));
    const cumulative = computeGpa(allCourses);

    const passed = results.filter((r) => Number(r.totalScore) >= 40).length;
    const failed = results.filter((r) => Number(r.totalScore) < 40).length;

    return {
      semesters,
      cgpa: cumulative.gpa,
      classification: cumulative.classification,
      totalUnits: cumulative.totalUnits,
      passed,
      failed,
    };
  }

  /** The student's registered courses for the current/latest registration. */
  async registeredCourses(userId: string) {
    const s = await this.resolveStudent(userId);
    const registration = await this.prisma.db.courseRegistration.findFirst({
      where: { studentId: s.id },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { course: true } }, session: true },
    });

    if (!registration) {
      return { registration: null, courses: [], totalUnits: 0 };
    }

    const courses = registration.items.map((item) => ({
      code: item.course.code,
      title: item.course.title,
      units: item.course.creditUnits,
      semester: item.course.semester,
      status: registration.status,
    }));

    return {
      registration: {
        id: registration.id,
        session: registration.session?.name ?? '',
        semester: this.semesterLabel(registration.semester),
        level: registration.level,
        status: registration.status,
      },
      courses,
      totalUnits: courses.reduce((sum, c) => sum + c.units, 0),
    };
  }

  /** Aggregated dashboard data for the portal home screen. */
  async dashboard(userId: string) {
    const s = await this.resolveStudent(userId);
    const [profile, results, fees, registered, announcements, exams] = await Promise.all([
      this.profile(userId),
      this.results(userId),
      this.fees(userId),
      this.registeredCourses(userId),
      this.prisma.db.announcement.findMany({
        where: { schoolId: s.schoolId },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      }),
      this.prisma.db.exam.findMany({
        where: {
          schoolId: s.schoolId,
          status: { in: ['SCHEDULED', 'ACTIVE'] },
          OR: [
            // Exams with no course (general exams for all students)
            { courseId: null },
            // Exams for courses in the student's department
            { course: { departmentId: s.departmentId } },
            // Exams for courses with no department (all students)
            { course: { departmentId: null } },
          ],
        },
        include: {
          course: { select: { code: true, title: true, department: { select: { name: true } } } },
        },
        orderBy: { startsAt: 'asc' },
        take: 5,
      }),
    ]);

    return {
      profile,
      cgpa: results.cgpa,
      classification: results.classification,
      outstandingFees: fees.summary.outstanding,
      registeredUnits: registered.totalUnits,
      registeredCount: registered.courses.length,
      upcomingExams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        courseCode: e.course?.code ?? null,
        courseTitle: e.course?.title ?? null,
        department: e.course?.department?.name ?? null,
        startsAt: e.startsAt,
        durationMins: e.durationMins,
        status: e.status,
      })),
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        date: a.publishedAt,
      })),
    };
  }

  /**
   * Courses the student may register for in a given semester, scoped to their
   * department, level and the current academic session. Also returns any
   * existing registration for that semester so the portal can pre-fill/lock.
   */
  async availableCourses(userId: string, semester: string = 'FIRST') {
    const s = await this.resolveStudent(userId);
    const level = s.currentLevel ?? 100;
    const session = await this.prisma.db.academicSession.findFirst({
      where: { schoolId: s.schoolId, isCurrent: true },
    });

    const courses = await this.prisma.db.course.findMany({
      where: {
        schoolId: s.schoolId,
        level,
        semester: semester as any,
        ...(s.departmentId ? { departmentId: s.departmentId } : {}),
      },
      orderBy: { code: 'asc' },
    });

    const existing = session
      ? await this.prisma.db.courseRegistration.findUnique({
          where: {
            studentId_sessionId_semester: {
              studentId: s.id,
              sessionId: session.id,
              semester: semester as any,
            },
          },
          include: { items: true },
        })
      : null;

    const locked = existing?.status === 'LOCKED' || existing?.status === 'APPROVED';

    return {
      semester,
      session: session?.name ?? null,
      sessionId: session?.id ?? null,
      level,
      minUnits: StudentsMeService.MIN_UNITS,
      maxUnits: StudentsMeService.MAX_UNITS,
      locked,
      courses: courses.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        creditUnits: c.creditUnits,
        semester: c.semester,
      })),
      existing: existing
        ? {
            id: existing.id,
            status: existing.status,
            totalUnits: existing.totalUnits,
            courseIds: existing.items.map((i) => i.courseId),
          }
        : null,
    };
  }

  /**
   * Submit (or re-submit) the student's course registration for a semester.
   * Validates that every course belongs to the student's level/semester and that
   * the total credit load is within bounds, then upserts a PENDING registration.
   */
  async submitRegistration(userId: string, dto: RegisterCoursesDto) {
    const semester = dto.semester ?? 'FIRST';
    const s = await this.resolveStudent(userId);
    const level = s.currentLevel ?? 100;
    const session = await this.prisma.db.academicSession.findFirst({
      where: { schoolId: s.schoolId, isCurrent: true },
    });
    if (!session) {
      throw new BadRequestException('No active academic session. Contact the school admin.');
    }

    // Only courses offered for this student's level/semester (and department) are allowed.
    const requested = await this.prisma.db.course.findMany({
      where: {
        id: { in: dto.courseIds },
        schoolId: s.schoolId,
        level,
        semester: semester as any,
      },
    });
    const validIds = new Set(requested.map((c) => c.id));
    if (dto.courseIds.some((id) => !validIds.has(id))) {
      throw new BadRequestException('One or more courses are not available for your level/semester.');
    }

    const totalUnits = requested.reduce((sum, c) => sum + c.creditUnits, 0);
    if (totalUnits < StudentsMeService.MIN_UNITS || totalUnits > StudentsMeService.MAX_UNITS) {
      throw new BadRequestException(
        `Select between ${StudentsMeService.MIN_UNITS} and ${StudentsMeService.MAX_UNITS} credit units.`,
      );
    }

    const uniqueIds = Array.from(validIds);

    const registration = await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.courseRegistration.findUnique({
        where: {
          studentId_sessionId_semester: {
            studentId: s.id,
            sessionId: session.id,
            semester: semester as any,
          },
        },
      });

      if (existing) {
        if (existing.status === 'LOCKED' || existing.status === 'APPROVED') {
          throw new BadRequestException(
            'This registration is already approved or locked and cannot be edited.',
          );
        }
        await tx.courseRegistrationItem.deleteMany({ where: { registrationId: existing.id } });
        await tx.courseRegistrationItem.createMany({
          data: uniqueIds.map((courseId) => ({ registrationId: existing.id, courseId })),
        });
        return tx.courseRegistration.update({
          where: { id: existing.id },
          data: { totalUnits, status: 'PENDING' },
          include: { items: { include: { course: true } }, session: true },
        });
      }

      return tx.courseRegistration.create({
        data: {
          studentId: s.id,
          sessionId: session.id,
          semester: semester as any,
          level,
          status: 'PENDING',
          totalUnits,
          items: { create: uniqueIds.map((courseId) => ({ courseId })) },
        },
        include: { items: { include: { course: true } }, session: true },
      });
    });

    // Notify lecturer/adviser about pending registration
    if (s.departmentId) {
      const studentName = `${s.firstName} ${s.lastName}`;
      this.comms
        .notifyUsersByRole(
          s.schoolId,
          'LECTURER',
          'Course Registration Submitted',
          `${studentName} (${s.matricNumber}) has submitted a course registration for review.`,
        )
        .catch((err) => this.logger.error('Failed to send registration notification', err instanceof Error ? err.stack : ''));
    }

    return {
      id: registration.id,
      status: registration.status,
      semester: this.semesterLabel(registration.semester),
      session: registration.session?.name ?? session.name,
      level: registration.level,
      totalUnits: registration.totalUnits,
      courses: registration.items.map((i) => ({
        code: i.course.code,
        title: i.course.title,
        units: i.course.creditUnits,
      })),
    };
  }

  private semesterLabel(sem: string): string {
    if (sem === 'FIRST') return 'First';
    if (sem === 'SECOND') return 'Second';
    if (sem === 'THIRD') return 'Third';
    return sem;
  }
}
