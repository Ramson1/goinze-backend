import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reports: aggregate summaries across students, admissions, payments,
 * results and attendance.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(schoolId: string | null) {
    return schoolId ? { schoolId } : {};
  }

  async studentsReport(schoolId: string | null) {
    const [total, byStatus, byGender] = await Promise.all([
      this.prisma.db.student.count({ where: this.where(schoolId) }),
      this.prisma.db.student.groupBy({
        by: ['status'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
      this.prisma.db.student.groupBy({
        by: ['gender'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byGender: byGender.map((r) => ({ gender: r.gender, count: r._count._all })),
    };
  }

  async admissionsReport(schoolId: string | null) {
    const [total, byStatus] = await Promise.all([
      this.prisma.db.application.count({ where: this.where(schoolId) }),
      this.prisma.db.application.groupBy({
        by: ['status'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    };
  }

  async paymentsReport(schoolId: string | null) {
    const [byStatus, totalCollected] = await Promise.all([
      this.prisma.db.payment.groupBy({
        by: ['status'],
        where: this.where(schoolId),
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.db.payment.aggregate({
        where: { ...this.where(schoolId), status: 'SUCCESS' },
        _sum: { amount: true },
      }),
    ]);
    return {
      totalCollected: Number(totalCollected._sum.amount ?? 0),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        amount: Number(r._sum.amount ?? 0),
      })),
    };
  }

  async resultsReport(schoolId: string | null) {
    const [total, byGrade] = await Promise.all([
      this.prisma.db.result.count({ where: this.where(schoolId) }),
      this.prisma.db.result.groupBy({
        by: ['grade'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      byGrade: byGrade.map((r) => ({ grade: r.grade, count: r._count._all })),
    };
  }

  async attendanceReport(schoolId: string | null) {
    const byStatus = await this.prisma.db.attendanceRecord.groupBy({
      by: ['status'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    return {
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    };
  }
}
