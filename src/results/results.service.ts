import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { computeGpa, resolveGrade, generateResultPin } from '../lib/utils';
import type { CourseGrade } from '../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import {
  EnterScoreDto,
  BulkUploadDto,
  VerifyResultPinDto,
  UpdateScoreDto,
} from './dto/result.dto';

/**
 * Result management: score entry, grade computation, approval/lock/publish
 * workflow, GPA calculation and result-pin verification.
 */
@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService, private readonly comms: CommunicationService) {}

  private computeScore(caScore: number, examScore: number) {
    const totalScore = Math.max(0, Math.min(100, caScore + examScore));
    const band = resolveGrade(totalScore);
    return { totalScore, grade: band.grade, gradePoint: band.point };
  }

  /** Enter / update a single result and compute its grade. */
  async enterScore(schoolId: string | null, dto: EnterScoreDto) {
    const { totalScore, grade, gradePoint } = this.computeScore(
      dto.caScore,
      dto.examScore,
    );

    return this.prisma.db.result.upsert({
      where: {
        studentId_courseId_sessionId_semester: {
          studentId: dto.studentId,
          courseId: dto.courseId,
          sessionId: dto.sessionId,
          semester: (dto.semester as any) ?? 'FIRST',
        },
      },
      create: {
        schoolId: schoolId ?? '',
        studentId: dto.studentId,
        courseId: dto.courseId,
        sessionId: dto.sessionId,
        semester: (dto.semester as any) ?? 'FIRST',
        caScore: dto.caScore,
        examScore: dto.examScore,
        totalScore,
        grade,
        gradePoint,
        status: 'DRAFT',
      },
      update: {
        caScore: dto.caScore,
        examScore: dto.examScore,
        totalScore,
        grade,
        gradePoint,
      },
    });
  }

  /** Bulk upload stub — upserts many rows in a transaction. */
  async bulkUpload(schoolId: string | null, dto: BulkUploadDto) {
    const semester = (dto.semester as any) ?? 'FIRST';
    const results = await this.prisma.db.$transaction(
      dto.rows.map((row) => {
        const { totalScore, grade, gradePoint } = this.computeScore(
          row.caScore,
          row.examScore,
        );
        return this.prisma.db.result.upsert({
          where: {
            studentId_courseId_sessionId_semester: {
              studentId: row.studentId,
              courseId: dto.courseId,
              sessionId: dto.sessionId,
              semester,
            },
          },
          create: {
            schoolId: schoolId ?? '',
            studentId: row.studentId,
            courseId: dto.courseId,
            sessionId: dto.sessionId,
            semester,
            caScore: row.caScore,
            examScore: row.examScore,
            totalScore,
            grade,
            gradePoint,
            status: 'DRAFT',
          },
          update: {
            caScore: row.caScore,
            examScore: row.examScore,
            totalScore,
            grade,
            gradePoint,
          },
        });
      }),
    );
    return { processed: results.length };
  }

  /** List results for a student (optionally filtered by session). */
  listForStudent(studentId: string, sessionId?: string) {
    const where: Record<string, any> = { studentId };
    if (sessionId) where.sessionId = sessionId;
    return this.prisma.db.result.findMany({
      where,
      include: { course: true, session: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async setStatus(
    id: string,
    status: string,
    extra: Record<string, any> = {},
  ) {
    const result = await this.prisma.db.result.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');
    return this.prisma.db.result.update({
      where: { id },
      data: { status: status as any, ...extra },
    });
  }

  approve(id: string, approvedBy: string) {
    return this.setStatus(id, 'APPROVED', { approvedBy });
  }

  lock(id: string) {
    return this.setStatus(id, 'LOCKED');
  }

  publish(id: string) {
    return this.setStatus(id, 'PUBLISHED', { publishedAt: new Date() });
  }

  /** Update an individual result's scores and recalculate grade. Resets status to DRAFT. */
  async updateScore(id: string, dto: UpdateScoreDto) {
    const result = await this.prisma.db.result.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');

    const { totalScore, grade, gradePoint } = this.computeScore(dto.caScore, dto.examScore);

    return this.prisma.db.result.update({
      where: { id },
      data: {
        caScore: dto.caScore,
        examScore: dto.examScore,
        totalScore,
        grade,
        gradePoint,
        status: 'DRAFT',
        approvedBy: null,
        publishedAt: null,
      },
    });
  }

  // ---- Admin: course-grouped result approval ----

  private currentSession(schoolId: string) {
    return this.prisma.db.academicSession.findFirst({
      where: { schoolId, isCurrent: true },
    });
  }

  private semesterLabel(sem: string): string {
    if (sem === 'FIRST') return 'First';
    if (sem === 'SECOND') return 'Second';
    if (sem === 'THIRD') return 'Third';
    return sem;
  }

  /**
   * Group a school's results by course (+semester) for the active session, with
   * per-status counts. Powers the admin results-approval overview screen.
   */
  async adminCourseSummaries(schoolId: string | null) {
    if (!schoolId) return { session: null, courses: [] as any[] };
    const session = await this.currentSession(schoolId);
    if (!session) return { session: null, courses: [] as any[] };

    const results = await this.prisma.db.result.findMany({
      where: { schoolId, sessionId: session.id },
      include: { course: { include: { department: true } } },
    });

    const groups = new Map<
      string,
      { course: (typeof results)[number]['course']; semester: string; counts: Record<string, number> }
    >();
    for (const r of results) {
      const key = `${r.courseId}:${r.semester}`;
      if (!groups.has(key)) {
        groups.set(key, { course: r.course, semester: r.semester, counts: {} });
      }
      const g = groups.get(key)!;
      g.counts[r.status] = (g.counts[r.status] ?? 0) + 1;
    }

    const courses = Array.from(groups.values())
      .map((g) => {
        const total = Object.values(g.counts).reduce((a, b) => a + b, 0);
        return {
          courseId: g.course.id,
          code: g.course.code,
          title: g.course.title,
          level: g.course.level,
          semester: this.semesterLabel(g.semester),
          department: g.course.department?.name ?? null,
          total,
          draft: g.counts['DRAFT'] ?? 0,
          submitted: g.counts['SUBMITTED'] ?? 0,
          approved: g.counts['APPROVED'] ?? 0,
          locked: g.counts['LOCKED'] ?? 0,
          published: g.counts['PUBLISHED'] ?? 0,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    return { session: session.name, courses };
  }

  /** Individual result rows for one course in the active session. */
  async adminCourseResults(schoolId: string | null, courseId: string) {
    if (!schoolId) return { session: null, course: null, rows: [] as any[] };
    const session = await this.currentSession(schoolId);
    if (!session) return { session: null, course: null, rows: [] as any[] };
    const course = await this.prisma.db.course.findUnique({ where: { id: courseId } });

    const results = await this.prisma.db.result.findMany({
      where: { schoolId, courseId, sessionId: session.id },
      include: { student: true },
      orderBy: { updatedAt: 'desc' },
    });

    const rows = results.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      courseId: r.courseId,
      sessionId: r.sessionId,
      studentName: `${r.student?.firstName ?? ''} ${r.student?.lastName ?? ''}`.trim(),
      matricNo: r.student?.matricNumber ?? null,
      semester: this.semesterLabel(r.semester),
      caScore: Number(r.caScore),
      examScore: Number(r.examScore),
      totalScore: Number(r.totalScore),
      grade: r.grade,
      gradePoint: Number(r.gradePoint),
      status: r.status,
      publishedAt: r.publishedAt,
    }));

    return {
      session: session.name,
      course: course
        ? { id: course.id, code: course.code, title: course.title, level: course.level }
        : null,
      rows,
    };
  }

  private async batchSetStatus(
    schoolId: string | null,
    courseId: string,
    fromStatuses: string[],
    toStatus: string,
    extra: Record<string, any> = {},
  ) {
    if (!schoolId) return { updated: 0 };
    const session = await this.currentSession(schoolId);
    if (!session) return { updated: 0 };
    const updated = await this.prisma.db.result.updateMany({
      where: {
        schoolId,
        courseId,
        sessionId: session.id,
        status: { in: fromStatuses as any[] },
      },
      data: { status: toStatus as any, ...extra },
    });
    return { updated: updated.count };
  }

  /** Approve every submitted result for a course (adviser/exams officer action). */
  approveCourse(schoolId: string | null, courseId: string, approvedBy: string) {
    return this.batchSetStatus(schoolId, courseId, ['SUBMITTED'], 'APPROVED', { approvedBy });
  }

  /** Lock every approved result for a course so it can no longer change. */
  lockCourse(schoolId: string | null, courseId: string) {
    return this.batchSetStatus(schoolId, courseId, ['APPROVED'], 'LOCKED');
  }

  /** Publish a course's approved/locked results so students can see them. */
  async publishCourse(schoolId: string | null, courseId: string) {
    const result = await this.batchSetStatus(schoolId, courseId, ['APPROVED', 'LOCKED'], 'PUBLISHED', {
      publishedAt: new Date(),
    });

    // Notify students and SCHOOL_ADMIN about published results (fire-and-forget)
    if (schoolId) {
      const sid: string = schoolId;
      const course = await this.prisma.db.course.findUnique({
        where: { id: courseId },
        select: { code: true, title: true, departmentId: true },
      });
      if (course) {
        const courseName = `${course.code} — ${course.title}`;
        if (course.departmentId) {
          this.comms
            .notifyStudentsByDepartment(
              sid,
              course.departmentId,
            'Results Published',
            `Results for ${courseName} have been published. You can now view your results.`,
            { courseId },
          )
          .catch(() => {});
        }
        this.comms
          .notifyUsersByRole(
            sid,
            'SCHOOL_ADMIN',
            'Results Published',
            `Results for ${courseName} have been published by an admin.`,
            { courseId },
          )
          .catch(() => {});
      }
    }

    return result;
  }

  /** Compute GPA/CGPA for a student across all published results. */
  async computeStudentGpa(studentId: string) {
    const results = await this.prisma.db.result.findMany({
      where: { studentId, status: 'PUBLISHED' },
      include: { course: true },
    });

    const courses: CourseGrade[] = results.map((r) => ({
      creditUnits: r.course?.creditUnits ?? 0,
      score: Number(r.totalScore),
    }));

    return {
      studentId,
      courseCount: courses.length,
      ...computeGpa(courses),
    };
  }

  // ---- Result pins ----
  async generatePin(schoolId: string | null) {
    const code = generateResultPin();
    const serial = `SN-${Date.now()}`;
    return this.prisma.db.resultPin.create({
      data: {
        schoolId: schoolId ?? '',
        code,
        serial,
        usesLeft: 5,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /** Verify a result checker pin and decrement its remaining uses. */
  async verifyPin(dto: VerifyResultPinDto) {
    const pin = await this.prisma.db.resultPin.findUnique({
      where: { code: dto.code },
    });
    if (!pin) throw new NotFoundException('Invalid result pin');
    if (pin.usesLeft <= 0) {
      throw new BadRequestException('Result pin has no uses left');
    }
    if (pin.expiresAt && pin.expiresAt < new Date()) {
      throw new BadRequestException('Result pin has expired');
    }

    await this.prisma.db.resultPin.update({
      where: { id: pin.id },
      data: { usesLeft: { decrement: 1 }, studentId: dto.serial ?? pin.studentId },
    });

    return { valid: true, usesLeft: pin.usesLeft - 1 };
  }
}
