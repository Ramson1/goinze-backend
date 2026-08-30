import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { resolveGrade } from '../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import type { SaveScoresDto, UpdateProfileDto } from './dto/lecturers-me.dto';

/**
 * Lecturer self-service endpoints for the lecturer portal.
 * Every method resolves the Staff record linked to the authenticated user and
 * scopes data to courses allocated to that lecturer.
 */
@Injectable()
export class LecturersMeService {
  private readonly logger = new Logger(LecturersMeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationService,
  ) {}

  /** Resolve the Staff record (with department/faculty) for the authenticated user. */
  private async resolveStaff(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { staff: { include: { user: true, department: { include: { faculty: true } } } } },
    });
    if (!user?.staff) {
      throw new ForbiddenException('This account is not linked to a staff record.');
    }
    return user.staff;
  }

  private currentSession(schoolId: string) {
    return this.prisma.db.academicSession.findFirst({
      where: { schoolId, isCurrent: true },
    });
  }

  /** Ensure a course is allocated to this lecturer before they can act on it. */
  private async assertAllocated(staffId: string, courseId: string) {
    const allocation = await this.prisma.db.courseAllocation.findFirst({
      where: { staffId, courseId },
    });
    if (!allocation) {
      throw new ForbiddenException('This course is not allocated to you.');
    }
  }

  private computeScore(caScore: number, examScore: number) {
    const totalScore = Math.max(0, Math.min(100, caScore + examScore));
    const band = resolveGrade(totalScore);
    return { totalScore, grade: band.grade, gradePoint: band.point };
  }

  private semesterLabel(sem: string): string {
    if (sem === 'FIRST') return 'First';
    if (sem === 'SECOND') return 'Second';
    if (sem === 'THIRD') return 'Third';
    return sem;
  }

  /** Lecturer profile for the portal header. */
  async profile(userId: string) {
    const s = await this.resolveStaff(userId);
    const session = await this.currentSession(s.schoolId);
    return {
      id: s.id,
      staffNumber: s.staffNumber,
      firstName: s.firstName,
      lastName: s.lastName,
      title: s.title,
      email: s.email,
      phone: s.phone,
      designation: s.designation,
      qualification: s.qualification,
      department: s.department?.name ?? null,
      faculty: s.department?.faculty?.name ?? null,
      session: session?.name ?? null,
    };
  }

  /** Update the lecturer's own contact details (self-service fields only). */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const s = await this.resolveStaff(userId);
    await this.prisma.db.staff.update({
      where: { id: s.id },
      data: {
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.designation !== undefined ? { designation: dto.designation } : {}),
        ...(dto.qualification !== undefined ? { qualification: dto.qualification } : {}),
      },
    });
    return this.profile(userId);
  }

  /** Users this lecturer can message: students in their allocated courses. */
  async contacts(userId: string) {
    const s = await this.resolveStaff(userId);
    const session = await this.currentSession(s.schoolId);

    const allocations = await this.prisma.db.courseAllocation.findMany({
      where: {
        staffId: s.id,
        ...(session ? { OR: [{ sessionId: session.id }, { sessionId: null }] } : {}),
      },
      include: { course: true },
    });
    const byCourse = new Map<string, (typeof allocations)[number]>();
    for (const a of allocations) byCourse.set(a.courseId, a);
    const courseIds = Array.from(byCourse.keys());

    const items = session
      ? await this.prisma.db.courseRegistrationItem.findMany({
          where: { courseId: { in: courseIds }, registration: { sessionId: session.id } },
          include: { registration: { include: { student: true } } },
        })
      : [];

    const seen = new Map<
      string,
      { id: string; name: string; matricNo: string | null; courseCode: string }
    >();
    for (const it of items) {
      const st = it.registration.student;
      if (!st?.userId || seen.has(st.userId)) continue;
      seen.set(st.userId, {
        id: st.userId,
        name: `${st.firstName} ${st.lastName}`.trim(),
        matricNo: st.matricNumber,
        courseCode: byCourse.get(it.courseId)?.course.code ?? '',
      });
    }

    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Courses allocated to this lecturer (with enrolled-student counts). */
  async myCourses(userId: string) {
    const s = await this.resolveStaff(userId);
    const session = await this.currentSession(s.schoolId);

    const allocations = await this.prisma.db.courseAllocation.findMany({
      where: {
        staffId: s.id,
        ...(session ? { OR: [{ sessionId: session.id }, { sessionId: null }] } : {}),
      },
      include: { course: { include: { department: true } } },
    });

    // De-duplicate by course (a lecturer may have several allocation rows).
    const byCourse = new Map<string, (typeof allocations)[number]>();
    for (const a of allocations) byCourse.set(a.courseId, a);
    const courseIds = Array.from(byCourse.keys());

    // Count distinct students registered for each course in the current session.
    const items = session
      ? await this.prisma.db.courseRegistrationItem.findMany({
          where: { courseId: { in: courseIds }, registration: { sessionId: session.id } },
          include: { registration: true },
        })
      : [];
    const countByCourse = new Map<string, Set<string>>();
    for (const it of items) {
      if (!countByCourse.has(it.courseId)) countByCourse.set(it.courseId, new Set());
      countByCourse.get(it.courseId)!.add(it.registration.studentId);
    }

    return Array.from(byCourse.values())
      .map((a) => ({
        id: a.course.id,
        code: a.course.code,
        title: a.course.title,
        creditUnits: a.course.creditUnits,
        level: a.course.level,
        semester: this.semesterLabel(a.course.semester),
        department: a.course.department?.name ?? null,
        studentCount: countByCourse.get(a.course.id)?.size ?? 0,
      }))
      .sort((x, y) => x.code.localeCompare(y.code));
  }

  /** Aggregated dashboard data for the lecturer portal home screen. */
  async dashboard(userId: string) {
    const s = await this.resolveStaff(userId);
    const session = await this.currentSession(s.schoolId);
    const [profile, courses, pendingRegistrations] = await Promise.all([
      this.profile(userId),
      this.myCourses(userId),
      this.pendingRegistrations(userId),
    ]);

    const courseIds = courses.map((c) => c.id);
    const publishedResults = await this.prisma.db.result.count({
      where: { courseId: { in: courseIds }, status: 'PUBLISHED' },
    });

    return {
      profile,
      courses,
      pendingRegistrations,
      stats: {
        coursesAllocated: courses.length,
        totalStudents: courses.reduce((sum, c) => sum + c.studentCount, 0),
        pendingRegistrations: pendingRegistrations.length,
        publishedResults,
      },
      session: session?.name ?? null,
    };
  }

  /** Students registered for an allocated course, with any existing scores pre-filled. */
  async courseRoster(userId: string, courseId: string) {
    const s = await this.resolveStaff(userId);
    await this.assertAllocated(s.id, courseId);
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found.');
    const session = await this.currentSession(s.schoolId);
    if (!session) throw new BadRequestException('No active academic session.');

    const items = await this.prisma.db.courseRegistrationItem.findMany({
      where: { courseId, registration: { sessionId: session.id } },
      include: { registration: { include: { student: true } } },
    });

    // De-duplicate students.
    const seen = new Map<string, { studentId: string; matricNo: string | null; firstName: string; lastName: string; level: number | null; regStatus: string }>();
    for (const it of items) {
      const st = it.registration.student;
      if (st && !seen.has(st.id)) {
        seen.set(st.id, {
          studentId: st.id,
          matricNo: st.matricNumber,
          firstName: st.firstName,
          lastName: st.lastName,
          level: st.currentLevel,
          regStatus: it.registration.status,
        });
      }
    }

    const results = await this.prisma.db.result.findMany({
      where: { courseId, sessionId: session.id, semester: course.semester },
    });
    const resultByStudent = new Map(results.map((r) => [r.studentId, r]));

    // Fetch attendance counts for all students in this course (current session).
    const sessionStart = session.startDate ?? new Date(new Date().getFullYear(), 0, 1);
    const sessionEnd = session.endDate ?? new Date(new Date().getFullYear(), 11, 31);
    const attendanceRecords = await this.prisma.db.attendanceRecord.findMany({
      where: {
        courseId,
        date: { gte: sessionStart, lte: sessionEnd },
      },
      select: { studentId: true, status: true },
    });
    const attByStudent = new Map<string, { present: number; absent: number; late: number; excused: number }>();
    for (const rec of attendanceRecords) {
      if (!rec.studentId) continue;
      const entry = attByStudent.get(rec.studentId) ?? { present: 0, absent: 0, late: 0, excused: 0 };
      if (rec.status === 'PRESENT') entry.present++;
      else if (rec.status === 'ABSENT') entry.absent++;
      else if (rec.status === 'LATE') entry.late++;
      else if (rec.status === 'EXCUSED') entry.excused++;
      attByStudent.set(rec.studentId, entry);
    }

    const students = Array.from(seen.values()).map((st) => {
      const r = resultByStudent.get(st.studentId);
      const att = attByStudent.get(st.studentId) ?? { present: 0, absent: 0, late: 0, excused: 0 };
      const total = att.present + att.absent + att.late + att.excused;
      return {
        ...st,
        caScore: r ? Number(r.caScore) : null,
        examScore: r ? Number(r.examScore) : null,
        totalScore: r ? Number(r.totalScore) : null,
        grade: r?.grade ?? null,
        resultStatus: r?.status ?? null,
        attendance: {
          present: att.present,
          absent: att.absent,
          late: att.late,
          excused: att.excused,
          total,
          rate: total > 0 ? Math.round(((att.present + att.late) / total) * 100) : 0,
        },
      };
    });

    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        semester: this.semesterLabel(course.semester),
      },
      session: session.name,
      sessionId: session.id,
      students,
    };
  }

  /** Save (or update) scores for a course as DRAFT results. */
  async saveScores(userId: string, courseId: string, dto: SaveScoresDto) {
    const s = await this.resolveStaff(userId);
    await this.assertAllocated(s.id, courseId);
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found.');
    const session = await this.currentSession(s.schoolId);
    if (!session) throw new BadRequestException('No active academic session.');

    const semester = course.semester;
    const processed = await this.prisma.db.$transaction(
      dto.rows.map((row) => {
        const { totalScore, grade, gradePoint } = this.computeScore(row.caScore, row.examScore);
        return this.prisma.db.result.upsert({
          where: {
            studentId_courseId_sessionId_semester: {
              studentId: row.studentId,
              courseId,
              sessionId: session.id,
              semester,
            },
          },
          create: {
            schoolId: s.schoolId,
            studentId: row.studentId,
            courseId,
            sessionId: session.id,
            semester,
            caScore: row.caScore,
            examScore: row.examScore,
            totalScore,
            grade,
            gradePoint,
            status: 'DRAFT',
          },
          update: { caScore: row.caScore, examScore: row.examScore, totalScore, grade, gradePoint },
        });
      }),
    );

    return { processed: processed.length };
  }

  /** A lecturer's entered results for a course, with a status rollup. */
  async courseResults(userId: string, courseId: string) {
    const s = await this.resolveStaff(userId);
    await this.assertAllocated(s.id, courseId);
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found.');
    const session = await this.currentSession(s.schoolId);
    if (!session) throw new BadRequestException('No active academic session.');

    const results = await this.prisma.db.result.findMany({
      where: { courseId, sessionId: session.id, semester: course.semester },
      include: { student: true },
    });

    const rows = results
      .map((r) => ({
        studentId: r.studentId,
        matricNo: r.student?.matricNumber ?? null,
        name: `${r.student?.firstName ?? ''} ${r.student?.lastName ?? ''}`.trim(),
        caScore: Number(r.caScore),
        examScore: Number(r.examScore),
        totalScore: Number(r.totalScore),
        grade: r.grade,
        status: r.status,
      }))
      .sort((a, b) => (a.matricNo ?? '').localeCompare(b.matricNo ?? ''));

    const summary = {
      total: rows.length,
      draft: rows.filter((r) => r.status === 'DRAFT').length,
      submitted: rows.filter((r) => r.status === 'SUBMITTED').length,
      published: rows.filter((r) => r.status === 'PUBLISHED').length,
    };

    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        semester: this.semesterLabel(course.semester),
      },
      session: session.name,
      rows,
      summary,
    };
  }

  /** Submit all DRAFT results for a course for approval. */
  async submitCourseResults(userId: string, courseId: string) {
    const s = await this.resolveStaff(userId);
    await this.assertAllocated(s.id, courseId);
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found.');
    const session = await this.currentSession(s.schoolId);
    if (!session) throw new BadRequestException('No active academic session.');

    const updated = await this.prisma.db.result.updateMany({
      where: { courseId, sessionId: session.id, semester: course.semester, status: 'DRAFT' },
      data: { status: 'SUBMITTED' },
    });
    return { updated: updated.count };
  }

  /** Publish a course's results so students can see them. */
  async publishCourseResults(userId: string, courseId: string) {
    const s = await this.resolveStaff(userId);
    await this.assertAllocated(s.id, courseId);
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found.');
    const session = await this.currentSession(s.schoolId);
    if (!session) throw new BadRequestException('No active academic session.');

    const updated = await this.prisma.db.result.updateMany({
      where: {
        courseId,
        sessionId: session.id,
        semester: course.semester,
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
      },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    // Notify students enrolled in this course + admin
    if (course.departmentId) {
      this.comms
        .notifyStudentsByDepartment(
          s.schoolId,
          course.departmentId,
          'Results Published',
          `Results for ${course.code} — ${course.title} have been published and are now available.`,
        )
        .catch((err) => this.logger.error('Failed to send results notification', err instanceof Error ? err.stack : ''));

      this.comms
        .notifyUsersByRole(
          s.schoolId,
          'SCHOOL_ADMIN',
          'Results Published',
          `${s.user?.firstName ?? 'A lecturer'} ${s.user?.lastName ?? ''} published results for ${course.code} — ${course.title}.`,
        )
        .catch((err) => this.logger.error('Failed to send results notification to admin', err instanceof Error ? err.stack : ''));
    }

    return { published: updated.count };
  }

  /** Pending course registrations for students in the lecturer's department. */
  async pendingRegistrations(userId: string) {
    const s = await this.resolveStaff(userId);
    const registrations = await this.prisma.db.courseRegistration.findMany({
      where: {
        status: 'PENDING',
        ...(s.departmentId ? { student: { departmentId: s.departmentId } } : {}),
      },
      include: {
        student: { include: { department: true } },
        items: { include: { course: true } },
        session: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return registrations.map((r) => ({
      id: r.id,
      studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
      matricNo: r.student.matricNumber,
      level: r.level,
      department: r.student.department?.name ?? null,
      session: r.session?.name ?? '',
      semester: this.semesterLabel(r.semester),
      totalUnits: r.totalUnits,
      courseCount: r.items.length,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /** Approve a pending course registration (adviser action). */
  async approveRegistration(userId: string, registrationId: string) {
    const registration = await this.prisma.db.courseRegistration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) throw new NotFoundException('Registration not found.');
    if (registration.status !== 'PENDING') {
      throw new BadRequestException('Only pending registrations can be approved.');
    }
    return this.prisma.db.courseRegistration.update({
      where: { id: registrationId },
      data: { status: 'APPROVED', approvedBy: userId },
    });
  }
}
