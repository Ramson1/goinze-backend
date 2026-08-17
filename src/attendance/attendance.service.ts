import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Attendance: manual marking, QR / digital-id stubs and simple reports.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mark attendance manually for a list of students. */
  async markManual(
    schoolId: string | null,
    data: {
      courseId?: string;
      date?: string;
      records: { studentId: string; status?: string }[];
    },
  ) {
    const date = data.date ? new Date(data.date) : new Date();
    const created = await this.prisma.db.attendanceRecord.createMany({
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
  }

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

  /** List attendance records with optional filters. */
  list(
    schoolId: string | null,
    filters: { studentId?: string; courseId?: string; date?: string } = {},
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
      take: 200,
    });
  }

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
