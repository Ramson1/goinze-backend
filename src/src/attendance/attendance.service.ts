import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';

/**
 * Attendance: manual marking, QR scanning, digital-id stubs, overview and reports.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly comms: CommunicationService) {}

  // -----------------------------------------------------------------------
  // Manual attendance — "replace all" semantics to prevent duplicates
  // -----------------------------------------------------------------------

  /** Mark attendance manually for a list of students (overwrites existing records for the same course+date). */
  async markManual(
    schoolId: string | null,
    data: {
      courseId?: string;
      date?: string;
      records: { studentId: string; status?: string }[];
    },
  ) {
    const date = data.date ? new Date(data.date) : new Date();
    // Normalise to the start of the day so the delete window matches the insert
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Delete-then-insert inside a transaction → "replace all" semantics
    const result = await this.prisma.db.$transaction(async (tx) => {
      // Remove any existing records for this course + date to prevent duplicates
      if (data.courseId) {
        await tx.attendanceRecord.deleteMany({
          where: {
            schoolId: schoolId ?? '',
            courseId: data.courseId,
            date: { gte: dayStart, lt: dayEnd },
          },
        });
      }

      const created = await tx.attendanceRecord.createMany({
        data: data.records.map((r) => ({
          schoolId: schoolId ?? '',
          studentId: r.studentId,
          courseId: data.courseId,
          date,
          status: (r.status as any) ?? 'PRESENT',
          method: 'MANUAL',
        })),
      });
      return { marked: created.count };
    });

    // Notify SCHOOL_ADMIN about attendance being marked (fire-and-forget)
    this.notifyAttendanceMarked(schoolId, data.courseId, dayStart, result.marked).catch(() => {});

    return result;
  }

  private async notifyAttendanceMarked(
    schoolId: string | null,
    courseId: string | undefined,
    dayStart: Date,
    count: number,
  ) {
    if (!schoolId || !courseId) return;
    const course = await this.prisma.db.course.findUnique({
      where: { id: courseId },
      select: { code: true, title: true },
    });
    const courseName = course ? `${course.code} — ${course.title}` : courseId;
    const dateStr = dayStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    this.comms
      .notifyUsersByRole(
        schoolId,
        'SCHOOL_ADMIN',
        'Attendance Marked',
        `Attendance for ${courseName} on ${dateStr} has been recorded (${count} student(s)).`,
        { courseId, date: dateStr, count },
      )
      .catch(() => {});
  }

  // -----------------------------------------------------------------------
  // QR scan — lecturer scans a student's ID card QR code
  // -----------------------------------------------------------------------

  /**
   * Parse a QR payload and return the verification code.
   * Supports both URI format (`goinzeschool://id/CODE`) and
   * JSON format (`{"t":"STUDENT_ID", …, "code":"CODE"}`).
   */
  private parseQrPayload(qrData: string): string {
    // Try URI format first: goinzeschool://id/{verificationCode}
    const uriMatch = qrData.match(/goinzeschool:\/\/id\/(.+)/);
    if (uriMatch) return uriMatch[1];

    // Try JSON format: { t: "STUDENT_ID", code: "XXXX-XXXX", … }
    try {
      const parsed = JSON.parse(qrData);
      if (parsed.code) return parsed.code;
    } catch {
      // not JSON — fall through
    }

    throw new BadRequestException('Unrecognised QR code format.');
  }

  /** Lecturer-initiated QR scan: validate the ID card, resolve the student, create attendance. */
  async scanQr(
    schoolId: string | null,
    data: { qrData: string; courseId: string },
  ) {
    const verificationCode = this.parseQrPayload(data.qrData);

    // Look up the ID card
    const card = await this.prisma.db.idCard.findFirst({
      where: {
        verificationCode,
        status: 'ACTIVE',
        ...(schoolId ? { schoolId } : {}),
      },
      include: { student: { select: { id: true, firstName: true, lastName: true, matricNumber: true } } },
    });

    if (!card) {
      throw new NotFoundException('No active ID card found with this QR code.');
    }
    if (card.expiresAt && card.expiresAt < new Date()) {
      throw new BadRequestException('This ID card has expired.');
    }
    if (!card.studentId || !card.student) {
      throw new BadRequestException('This ID card is not linked to a student.');
    }

    // Check for duplicate attendance (same student + course + same day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const existing = await this.prisma.db.attendanceRecord.findFirst({
      where: {
        studentId: card.studentId,
        courseId: data.courseId,
        date: { gte: todayStart, lt: todayEnd },
      },
    });

    if (existing) {
      return {
        student: card.student,
        record: { id: existing.id, status: existing.status, method: existing.method, date: existing.date },
        duplicate: true,
      };
    }

    // Create attendance record
    const record = await this.prisma.db.attendanceRecord.create({
      data: {
        schoolId: schoolId ?? '',
        studentId: card.studentId,
        courseId: data.courseId,
        status: 'PRESENT',
        method: 'QR_CODE',
      },
    });

    return {
      student: card.student,
      record: { id: record.id, status: record.status, method: record.method, date: record.date },
      duplicate: false,
    };
  }

  // -----------------------------------------------------------------------
  // Legacy stubs (student self-check-in) — kept for backward compatibility
  // -----------------------------------------------------------------------

  /** QR check-in stub — records a single PRESENT entry via QR_CODE method. */
  async qrCheckIn(
    schoolId: string | null,
    data: { studentId: string; courseId?: string; token?: string },
  ) {
    return this.prisma.db.attendanceRecord.create({
      data: {
        schoolId: schoolId ?? '',
        studentId: data.studentId,
        courseId: data.courseId,
        status: 'PRESENT',
        method: 'QR_CODE',
      },
    });
  }

  /** Digital-ID check-in stub. */
  async digitalIdCheckIn(
    schoolId: string | null,
    data: { studentId: string; cardNumber?: string; courseId?: string },
  ) {
    return this.prisma.db.attendanceRecord.create({
      data: {
        schoolId: schoolId ?? '',
        studentId: data.studentId,
        courseId: data.courseId,
        status: 'PRESENT',
        method: 'DIGITAL_ID',
      },
    });
  }

  // -----------------------------------------------------------------------
  // List / query
  // -----------------------------------------------------------------------

  /** List attendance records with optional filters. */
  list(
    schoolId: string | null,
    filters: { studentId?: string; courseId?: string; date?: string; limit?: number } = {},
  ) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (filters.studentId) where.studentId = filters.studentId;
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.date) {
      const start = new Date(filters.date);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }
    return this.prisma.db.attendanceRecord.findMany({
      where,
      include: { student: true },
      orderBy: { date: 'desc' },
      take: filters.limit ?? 1000,
    });
  }

  // -----------------------------------------------------------------------
  // Overview — grouped session summaries for the lecturer dashboard
  // -----------------------------------------------------------------------

  /** Return attendance sessions grouped by (courseId, date). */
  async overview(
    schoolId: string | null,
    filters: { courseId?: string } = {},
  ) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (filters.courseId) where.courseId = filters.courseId;

    const records = await this.prisma.db.attendanceRecord.findMany({
      where,
      include: {
        student: { select: { id: true } },
      },
      orderBy: { date: 'desc' },
      take: 5000,
    });

    // Group by courseId + date (day-level)
    const sessionMap = new Map<string, {
      courseId: string;
      date: string;
      presentCount: number;
      absentCount: number;
      lateCount: number;
      excusedCount: number;
      methods: Set<string>;
    }>();

    for (const rec of records) {
      const dayKey = new Date(rec.date).toISOString().slice(0, 10);
      const key = `${rec.courseId ?? 'none'}|||${dayKey}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          courseId: rec.courseId ?? '',
          date: dayKey,
          presentCount: 0,
          absentCount: 0,
          lateCount: 0,
          excusedCount: 0,
          methods: new Set(),
        });
      }
      const s = sessionMap.get(key)!;
      s.methods.add(rec.method);
      if (rec.status === 'PRESENT') s.presentCount++;
      else if (rec.status === 'ABSENT') s.absentCount++;
      else if (rec.status === 'LATE') s.lateCount++;
      else if (rec.status === 'EXCUSED') s.excusedCount++;
    }

    // Fetch course info for all unique courseIds
    const courseIds = [...new Set([...sessionMap.values()].map((s) => s.courseId).filter(Boolean))];
    const courses = courseIds.length > 0
      ? await this.prisma.db.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, code: true, title: true },
        })
      : [];
    const courseMap = new Map(courses.map((c) => [c.id, { code: c.code, title: c.title }]));

    // Fetch lecturer names from course allocations
    const allocations = courseIds.length > 0
      ? await this.prisma.db.courseAllocation.findMany({
          where: { courseId: { in: courseIds } },
          include: { staff: { select: { firstName: true, lastName: true, title: true } } },
        })
      : [];
    const lecturerMap = new Map<string, string[]>();
    for (const a of allocations) {
      const name = [a.staff?.title, a.staff?.firstName, a.staff?.lastName].filter(Boolean).join(' ');
      if (!lecturerMap.has(a.courseId)) lecturerMap.set(a.courseId, []);
      lecturerMap.get(a.courseId)!.push(name);
    }

    // Build final array
    const sessions = [...sessionMap.values()]
      .map((s) => ({
        courseId: s.courseId,
        courseCode: courseMap.get(s.courseId)?.code ?? '—',
        courseTitle: courseMap.get(s.courseId)?.title ?? 'Unknown Course',
        lecturers: lecturerMap.get(s.courseId) ?? [],
        date: s.date,
        totalMarked: s.presentCount + s.absentCount + s.lateCount + s.excusedCount,
        presentCount: s.presentCount,
        absentCount: s.absentCount,
        lateCount: s.lateCount,
        methods: [...s.methods],
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return sessions;
  }

  /** Return individual attendance records for a specific course + date. */
  async sessionDetail(schoolId: string | null, courseId: string, date: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const records = await this.prisma.db.attendanceRecord.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        courseId,
        date: { gte: start, lt: end },
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, matricNumber: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    // Fetch overall attendance counts for each student in this course.
    const allCourseRecords = await this.prisma.db.attendanceRecord.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        courseId,
      },
      select: { studentId: true, status: true },
    });
    const countByStudent = new Map<string, { present: number; absent: number; late: number; total: number }>();
    for (const rec of allCourseRecords) {
      if (!rec.studentId) continue;
      const entry = countByStudent.get(rec.studentId) ?? { present: 0, absent: 0, late: 0, total: 0 };
      if (rec.status === 'PRESENT') entry.present++;
      else if (rec.status === 'ABSENT') entry.absent++;
      else if (rec.status === 'LATE') entry.late++;
      entry.total++;
      countByStudent.set(rec.studentId, entry);
    }

    return records.map((r) => {
      const counts = countByStudent.get(r.studentId ?? '') ?? { present: 0, absent: 0, late: 0, total: 0 };
      return {
        id: r.id,
        studentId: r.studentId,
        firstName: r.student?.firstName ?? '—',
        lastName: r.student?.lastName ?? '—',
        matricNumber: r.student?.matricNumber ?? null,
        status: r.status,
        method: r.method,
        date: r.date.toISOString(),
        overallAttendance: {
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          total: counts.total,
          rate: counts.total > 0 ? Math.round(((counts.present + counts.late) / counts.total) * 100) : 0,
        },
      };
    });
  }

  // -----------------------------------------------------------------------
  // Student report
  // -----------------------------------------------------------------------

  /** Attendance report: counts grouped by status for a student. */
  async reportForStudent(studentId: string) {
    const records = await this.prisma.db.attendanceRecord.groupBy({
      by: ['status'],
      where: { studentId },
      _count: { _all: true },
    });

    const summary: Record<string, number> = {
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      EXCUSED: 0,
    };
    for (const row of records) {
      summary[row.status] = row._count._all;
    }
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    return {
      studentId,
      total,
      ...summary,
      attendanceRate: total > 0 ? (summary.PRESENT / total) * 100 : 0,
    };
  }
}
