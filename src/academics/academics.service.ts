import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Paginated } from '../../../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { paginated } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CommunicationService } from '../communication/communication.service';

/**
 * Academic management: faculties, departments, programmes, sessions,
 * courses and course allocations — grouped under a single service.
 */
@Injectable()
export class AcademicsService {
  private readonly logger = new Logger(AcademicsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationService,
  ) {}

  // ---- Faculties ----
  listFaculties(schoolId: string | null) {
    return this.prisma.db.faculty.findMany({
      where: schoolId ? { schoolId } : {},
      include: { departments: true },
      orderBy: { name: 'asc' },
    });
  }

  createFaculty(schoolId: string | null, data: Record<string, any>) {
    return this.prisma.db.faculty.create({
      data: { schoolId: schoolId ?? '', name: data.name, code: data.code },
    });
  }

  // ---- Departments ----
  listDepartments(schoolId: string | null, facultyId?: string) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (facultyId) where.facultyId = facultyId;
    return this.prisma.db.department.findMany({
      where,
      include: { faculty: true, programmes: true },
      orderBy: { name: 'asc' },
    });
  }

  createDepartment(schoolId: string | null, data: Record<string, any>) {
    return this.prisma.db.department.create({
      data: {
        schoolId: schoolId ?? '',
        facultyId: data.facultyId,
        name: data.name,
        code: data.code,
        description: data.description,
      },
    });
  }

  async updateDepartment(id: string, data: Record<string, any>) {
    const department = await this.prisma.db.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');
    return this.prisma.db.department.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        facultyId: data.facultyId,
        description: data.description,
      },
    });
  }

  async deleteDepartment(id: string) {
    const department = await this.prisma.db.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');
    return this.prisma.db.department.delete({ where: { id } });
  }

  // ---- Programmes ----
  listProgrammes(schoolId: string | null, departmentId?: string) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (departmentId) where.departmentId = departmentId;
    return this.prisma.db.programme.findMany({
      where,
      include: { department: true },
      orderBy: { name: 'asc' },
    });
  }

  createProgramme(schoolId: string | null, data: Record<string, any>) {
    return this.prisma.db.programme.create({
      data: {
        schoolId: schoolId ?? '',
        departmentId: data.departmentId,
        name: data.name,
        code: data.code,
        degreeType: data.degreeType,
        durationYears: data.durationYears ?? 4,
      },
    });
  }

  async updateProgramme(id: string, data: Record<string, any>) {
    const programme = await this.prisma.db.programme.findUnique({ where: { id } });
    if (!programme) throw new NotFoundException('Programme not found');
    return this.prisma.db.programme.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        degreeType: data.degreeType,
        durationYears: data.durationYears,
      },
    });
  }

  async deleteProgramme(id: string) {
    const programme = await this.prisma.db.programme.findUnique({ where: { id } });
    if (!programme) throw new NotFoundException('Programme not found');
    return this.prisma.db.programme.delete({ where: { id } });
  }

  // ---- Sessions ----
  listSessions(schoolId: string | null) {
    return this.prisma.db.academicSession.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: { name: 'desc' },
    });
  }

  async createSession(schoolId: string | null, data: Record<string, any>) {
    // Marking a session current unsets all others for the school.
    if (data.isCurrent && schoolId) {
      await this.prisma.db.academicSession.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      });
    }
    return this.prisma.db.academicSession.create({
      data: {
        schoolId: schoolId ?? '',
        name: data.name,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        isCurrent: Boolean(data.isCurrent),
      },
    });
  }

  /** Set a session as the current one, unsetting all others for the school. */
  async activateSession(schoolId: string | null, id: string) {
    const session = await this.prisma.db.academicSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    if (schoolId) {
      await this.prisma.db.academicSession.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      });
    }
    return this.prisma.db.academicSession.update({
      where: { id },
      data: { isCurrent: true },
    });
  }

  async updateSession(id: string, data: Record<string, any>) {
    const session = await this.prisma.db.academicSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    // If marking this session as current, unset all others for the same school
    if (data.isCurrent === true) {
      await this.prisma.db.academicSession.updateMany({
        where: { schoolId: session.schoolId },
        data: { isCurrent: false },
      });
    }
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.isCurrent !== undefined) updateData.isCurrent = Boolean(data.isCurrent);
    return this.prisma.db.academicSession.update({ where: { id }, data: updateData });
  }

  async deleteSession(id: string) {
    const session = await this.prisma.db.academicSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return this.prisma.db.academicSession.delete({ where: { id } });
  }

  // ---- Courses ----
  async listCourses(
    schoolId: string | null,
    query: PaginationDto,
    filters: { departmentId?: string; level?: number; semester?: string } = {},
  ): Promise<Paginated<any>> {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.level) where.level = filters.level;
    if (filters.semester) where.semester = filters.semester;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return paginated(this.prisma.db.course, {
      where,
      page: query.page,
      pageSize: query.pageSize,
      include: { department: true, allocations: { include: { staff: true } } },
    });
  }

  async createCourse(schoolId: string | null, data: Record<string, any>) {
    const course = await this.prisma.db.course.create({
      data: {
        schoolId: schoolId ?? '',
        departmentId: data.departmentId,
        code: data.code,
        title: data.title,
        creditUnits: data.creditUnits ?? 3,
        level: data.level ?? 100,
        semester: (data.semester as any) ?? 'FIRST',
        description: data.description,
      },
    });

    // Notify admin + lecturers in department about new course
    if (schoolId) {
      this.comms
        .notifyUsersByRole(
          schoolId,
          'SCHOOL_ADMIN',
          'New Course Created',
          `${course.code} — ${course.title} has been added to the course catalogue.`,
        )
        .catch((err) => this.logger.error('Failed to send course notification', err instanceof Error ? err.stack : ''));
    }

    return course;
  }

  async getCourse(id: string) {
    const course = await this.prisma.db.course.findUnique({
      where: { id },
      include: { department: true, allocations: { include: { staff: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async updateCourse(id: string, data: Record<string, any>) {
    const course = await this.prisma.db.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');
    return this.prisma.db.course.update({
      where: { id },
      data: {
        code: data.code,
        title: data.title,
        departmentId: data.departmentId,
        creditUnits: data.creditUnits,
        level: data.level,
        semester: data.semester,
        description: data.description,
      },
    });
  }

  async deleteCourse(id: string) {
    const course = await this.prisma.db.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');
    return this.prisma.db.course.delete({ where: { id } });
  }

  // ---- Course allocation ----
  allocateCourse(data: {
    courseId: string;
    staffId: string;
    sessionId?: string;
  }) {
    return this.prisma.db.courseAllocation.create({
      data: {
        courseId: data.courseId,
        staffId: data.staffId,
        sessionId: data.sessionId,
      },
    });
  }

  listAllocations(courseId: string) {
    return this.prisma.db.courseAllocation.findMany({
      where: { courseId },
      include: { staff: true, course: true },
    });
  }

  async updateCourseAllocation(courseId: string, staffId: string) {
    // Delete existing allocations for this course
    await this.prisma.db.courseAllocation.deleteMany({
      where: { courseId },
    });
    // Create new allocation if staffId is provided
    if (staffId) {
      return this.prisma.db.courseAllocation.create({
        data: {
          courseId,
          staffId,
        },
        include: { staff: true, course: true },
      });
    }
    return null;
  }
}
