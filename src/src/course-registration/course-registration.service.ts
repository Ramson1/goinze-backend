import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Course registration: register courses for a session/semester, add/drop
 * individual courses, approve and lock registrations.
 */
@Injectable()
export class CourseRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get or create a registration shell for a student/session/semester. */
  async register(data: {
    studentId: string;
    sessionId: string;
    semester?: string;
    level?: number;
    courseIds?: string[];
  }) {
    const semester = (data.semester as any) ?? 'FIRST';
    const existing = await this.prisma.db.courseRegistration.findUnique({
      where: {
        studentId_sessionId_semester: {
          studentId: data.studentId,
          sessionId: data.sessionId,
          semester,
        },
      },
    });

    if (existing) {
      return this.findOne(existing.id);
    }

    const registration = await this.prisma.db.courseRegistration.create({
      data: {
        studentId: data.studentId,
        sessionId: data.sessionId,
        semester,
        level: data.level ?? 100,
        status: 'PENDING',
      },
    });

    if (data.courseIds?.length) {
      await this.addCourses(registration.id, data.courseIds);
    }
    return this.findOne(registration.id);
  }

  async findOne(id: string) {
    const registration = await this.prisma.db.courseRegistration.findUnique({
      where: { id },
      include: { items: { include: { course: true } }, student: true, session: true },
    });
    if (!registration) throw new NotFoundException('Registration not found');
    return registration;
  }

  listForStudent(studentId: string) {
    return this.prisma.db.courseRegistration.findMany({
      where: { studentId },
      include: { items: { include: { course: true } }, session: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recomputeUnits(registrationId: string) {
    const items = await this.prisma.db.courseRegistrationItem.findMany({
      where: { registrationId },
      include: { course: true },
    });
    const totalUnits = items.reduce(
      (sum, item) => sum + (item.course?.creditUnits ?? 0),
      0,
    );
    await this.prisma.db.courseRegistration.update({
      where: { id: registrationId },
      data: { totalUnits },
    });
  }

  /** Add courses to a registration. */
  async addCourses(registrationId: string, courseIds: string[]) {
    await this.findOne(registrationId);
    await this.prisma.db.courseRegistrationItem.createMany({
      data: courseIds.map((courseId) => ({ registrationId, courseId })),
      skipDuplicates: true,
    });
    await this.recomputeUnits(registrationId);
    return this.findOne(registrationId);
  }

  /** Drop a single course from a registration. */
  async dropCourse(registrationId: string, courseId: string) {
    const item = await this.prisma.db.courseRegistrationItem.findFirst({
      where: { registrationId, courseId },
    });
    if (!item) throw new NotFoundException('Course not in registration');
    await this.prisma.db.courseRegistrationItem.delete({
      where: { id: item.id },
    });
    await this.recomputeUnits(registrationId);
    return this.findOne(registrationId);
  }

  /** Approve a registration (advisor action). */
  async approve(id: string, approvedBy: string) {
    await this.findOne(id);
    return this.prisma.db.courseRegistration.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy },
    });
  }

  /** Lock a registration so it can no longer be edited. */
  async lock(id: string) {
    const registration = await this.findOne(id);
    if (registration.status !== 'APPROVED') {
      throw new BadRequestException('Registration must be approved before locking');
    }
    return this.prisma.db.courseRegistration.update({
      where: { id },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
  }
}
