import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Analytics: dashboard metrics — counts, revenue sum and admissions trend.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(schoolId: string | null) {
    return schoolId ? { schoolId } : {};
  }

  /** Top-line counts and revenue for the dashboard. */
  async dashboard(schoolId: string | null) {
    const [
      students,
      staff,
      applications,
      activeExams,
      revenue,
      pendingPayments,
      staffBreakdown,
    ] = await Promise.all([
      this.prisma.db.student.count({ where: this.where(schoolId) }),
      this.prisma.db.staff.count({ where: this.where(schoolId) }),
      this.prisma.db.application.count({ where: this.where(schoolId) }),
      this.prisma.db.exam.count({
        where: { ...this.where(schoolId), status: 'ACTIVE' },
      }),
      this.prisma.db.payment.aggregate({
        where: { ...this.where(schoolId), status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.db.payment.count({
        where: { ...this.where(schoolId), status: 'PENDING' },
      }),
      this.prisma.db.staff.findMany({
        where: this.where(schoolId),
        select: { isLecturer: true, staffCategory: true },
      }),
    ]);

    let lecturers = 0;
    let nonAcademic = 0;
    let administrative = 0;
    for (const s of staffBreakdown) {
      if (s.staffCategory === 'ADMINISTRATIVE') administrative++;
      else if (s.isLecturer || s.staffCategory === 'ACADEMIC') lecturers++;
      else nonAcademic++;
    }

    return {
      counts: { students, staff, applications, activeExams, pendingPayments },
      staffCounts: { lecturers, nonAcademic, administrative },
      revenue: Number(revenue._sum.amount ?? 0),
    };
  }

  /** Admissions trend: applications grouped by status (lightweight proxy). */
  async admissionsTrend(schoolId: string | null) {
    const byStatus = await this.prisma.db.application.groupBy({
      by: ['status'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    return byStatus.map((r) => ({ status: r.status, count: r._count._all }));
  }

  /** Revenue broken down by payment status. */
  async revenueBreakdown(schoolId: string | null) {
    const byStatus = await this.prisma.db.payment.groupBy({
      by: ['status'],
      where: this.where(schoolId),
      _sum: { amount: true },
      _count: { _all: true },
    });
    return byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      amount: Number(r._sum.amount ?? 0),
    }));
  }

  /** Build the last `n` month buckets (oldest first) with stable keys. */
  private monthBuckets(n: number) {
    const now = new Date();
    const buckets: Array<{ key: string; label: string }> = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('en', { month: 'short' }),
      });
    }
    return buckets;
  }

  private bucketKey(date: Date | null | undefined): string {
    const d = date ? new Date(date) : new Date();
    return `${d.getFullYear()}-${d.getMonth()}`;
  }

  /** Monthly collected revenue for the last 12 months (SUCCESS payments). */
  async revenueByMonth(schoolId: string | null) {
    const buckets = this.monthBuckets(12);
    const totals = new Map(buckets.map((b) => [b.key, 0]));

    const payments = await this.prisma.db.payment.findMany({
      where: { ...this.where(schoolId), status: 'SUCCESS' },
      select: { amount: true, paidAt: true, createdAt: true },
    });
    for (const p of payments) {
      const key = this.bucketKey(p.paidAt ?? p.createdAt);
      if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Number(p.amount));
    }

    return buckets.map((b) => ({ month: b.label, revenue: totals.get(b.key) ?? 0 }));
  }

  /** Monthly applications vs admits for the last 12 months. */
  async admissionsByMonth(schoolId: string | null) {
    const buckets = this.monthBuckets(12);
    const apps = new Map(buckets.map((b) => [b.key, 0]));
    const admitted = new Map(buckets.map((b) => [b.key, 0]));

    const applications = await this.prisma.db.application.findMany({
      where: this.where(schoolId),
      select: { createdAt: true, status: true },
    });
    for (const a of applications) {
      const key = this.bucketKey(a.createdAt);
      if (apps.has(key)) {
        apps.set(key, (apps.get(key) ?? 0) + 1);
        if (a.status === 'ADMITTED') admitted.set(key, (admitted.get(key) ?? 0) + 1);
      }
    }

    return buckets.map((b) => ({
      month: b.label,
      applications: apps.get(b.key) ?? 0,
      admitted: admitted.get(b.key) ?? 0,
    }));
  }

  /** Students grouped by department (name + count). */
  async enrollmentByDepartment(schoolId: string | null) {
    const rows = await this.prisma.db.student.groupBy({
      by: ['departmentId'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    const deptIds = rows.map((r) => r.departmentId).filter((id): id is string => Boolean(id));
    const depts = await this.prisma.db.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(depts.map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      name: r.departmentId ? nameMap.get(r.departmentId) ?? 'Unknown' : 'Unassigned',
      value: r._count._all,
    }));
  }

  /** Students grouped by gender. */
  async genderDistribution(schoolId: string | null) {
    const rows = await this.prisma.db.student.groupBy({
      by: ['gender'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    return rows.map((r) => ({ name: r.gender ?? 'UNKNOWN', value: r._count._all }));
  }

  /** Payments grouped by gateway (count). */
  async paymentMethods(schoolId: string | null) {
    const rows = await this.prisma.db.payment.groupBy({
      by: ['gateway'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    return rows.map((r) => ({ name: r.gateway, value: r._count._all }));
  }

  /** Staff count per department. */
  async staffByDepartment(schoolId: string | null) {
    const rows = await this.prisma.db.staff.groupBy({
      by: ['departmentId'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    const deptIds = rows.map((r) => r.departmentId).filter((id): id is string => Boolean(id));
    const depts = await this.prisma.db.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(depts.map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      name: r.departmentId ? nameMap.get(r.departmentId) ?? 'Unknown' : 'Unassigned',
      value: r._count._all,
    }));
  }

  /** Staff breakdown by category (ACADEMIC / NON_ACADEMIC / ADMINISTRATIVE). */
  async staffByCategory(schoolId: string | null) {
    const rows = await this.prisma.db.staff.groupBy({
      by: ['staffCategory'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    return rows.map((r) => ({
      name: r.staffCategory ?? 'UNCATEGORIZED',
      value: r._count._all,
    }));
  }

  /** Per-department breakdown: lecturers vs non-academic staff. */
  async staffBreakdown(schoolId: string | null) {
    const staff = await this.prisma.db.staff.findMany({
      where: this.where(schoolId),
      select: { departmentId: true, isLecturer: true, staffCategory: true },
    });

    const deptMap = new Map<string, { lecturers: number; nonAcademic: number; administrative: number }>();

    for (const s of staff) {
      const key = s.departmentId ?? 'unassigned';
      if (!deptMap.has(key)) deptMap.set(key, { lecturers: 0, nonAcademic: 0, administrative: 0 });
      const entry = deptMap.get(key)!;
      if (s.staffCategory === 'ADMINISTRATIVE') {
        entry.administrative++;
      } else if (s.isLecturer || s.staffCategory === 'ACADEMIC') {
        entry.lecturers++;
      } else {
        entry.nonAcademic++;
      }
    }

    const deptIds = [...deptMap.keys()].filter((id) => id !== 'unassigned');
    const depts = await this.prisma.db.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(depts.map((d) => [d.id, d.name]));

    return [...deptMap.entries()].map(([id, counts]) => ({
      name: id === 'unassigned' ? 'Unassigned' : (nameMap.get(id) ?? 'Unknown'),
      lecturers: counts.lecturers,
      nonAcademic: counts.nonAcademic,
      administrative: counts.administrative,
    }));
  }

  /** Student-to-staff ratio per department. */
  async studentStaffRatio(schoolId: string | null) {
    const [studentRows, staffRows] = await Promise.all([
      this.prisma.db.student.groupBy({
        by: ['departmentId'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
      this.prisma.db.staff.groupBy({
        by: ['departmentId'],
        where: this.where(schoolId),
        _count: { _all: true },
      }),
    ]);
    const deptIds = [
      ...new Set([
        ...studentRows.map((r) => r.departmentId),
        ...staffRows.map((r) => r.departmentId),
      ]),
    ].filter((id): id is string => Boolean(id));
    const depts = await this.prisma.db.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(depts.map((d) => [d.id, d.name]));
    const studentMap = new Map(studentRows.map((r) => [r.departmentId, r._count._all]));
    const staffMap = new Map(staffRows.map((r) => [r.departmentId, r._count._all]));
    return deptIds.map((id) => ({
      name: nameMap.get(id) ?? 'Unknown',
      students: studentMap.get(id) ?? 0,
      staff: staffMap.get(id) ?? 0,
    }));
  }

  /** Payment status breakdown: count + total amount per status. */
  async paymentStatusBreakdown(schoolId: string | null) {
    const rows = await this.prisma.db.payment.groupBy({
      by: ['status'],
      where: this.where(schoolId),
      _count: { _all: true },
      _sum: { amount: true },
    });
    return rows.map((r) => ({
      name: r.status,
      count: r._count._all,
      amount: Number(r._sum.amount ?? 0),
    }));
  }

  /** New student enrollment trend: students created per month for last 12 months. */
  async enrollmentTrend(schoolId: string | null) {
    const buckets = this.monthBuckets(12);
    const totals = new Map(buckets.map((b) => [b.key, 0]));

    const students = await this.prisma.db.student.findMany({
      where: this.where(schoolId),
      select: { createdAt: true },
    });
    for (const s of students) {
      const key = this.bucketKey(s.createdAt);
      if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    return buckets.map((b) => ({ month: b.label, count: totals.get(b.key) ?? 0 }));
  }

  /** Students per programme. */
  async programmeEnrollment(schoolId: string | null) {
    const rows = await this.prisma.db.student.groupBy({
      by: ['programmeId'],
      where: this.where(schoolId),
      _count: { _all: true },
    });
    const progIds = rows.map((r) => r.programmeId).filter((id): id is string => Boolean(id));
    const programmes = await this.prisma.db.programme.findMany({
      where: { id: { in: progIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(programmes.map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      name: r.programmeId ? nameMap.get(r.programmeId) ?? 'Unknown' : 'Unassigned',
      value: r._count._all,
    }));
  }
}
