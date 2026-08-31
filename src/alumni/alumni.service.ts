import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import { CreateAlumniRegistrationDto } from './dto/alumni-registration.dto';

@Injectable()
export class AlumniService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationService,
  ) {}

  async create(dto: CreateAlumniRegistrationDto) {
    const registration = await this.prisma.db.alumniRegistration.create({
      data: {
        name: dto.name,
        email: dto.email,
        programme: dto.programme,
        graduationYear: dto.graduationYear,
        currentRole: dto.currentRole ?? null,
        status: 'PENDING',
      },
    });

    // Notify SCHOOL_ADMIN and SUPER_ADMIN about new alumni registration
    if (dto.name) {
      const notifyAdmin = this.comms
        .notifyUsersByRole('', 'SCHOOL_ADMIN', 'New Alumni Registration Request', `${dto.name} has registered as an alumnus (${dto.programme}, Class of ${dto.graduationYear}). Please review.`, { alumniRegistrationId: registration.id })
        .catch(() => {});
      const notifySuper = this.comms
        .notifyUsersByRole('', 'SUPER_ADMIN', 'New Alumni Registration Request', `${dto.name} has registered as an alumnus (${dto.programme}, Class of ${dto.graduationYear}). Please review.`, { alumniRegistrationId: registration.id })
        .catch(() => {});
      Promise.allSettled([notifyAdmin, notifySuper]);
    }

    return registration;
  }

  list(status?: string) {
    const where: Record<string, any> = {};
    if (status) where.status = status;
    return this.prisma.db.alumniRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  listApproved() {
    return this.prisma.db.alumniRegistration.findMany({
      where: { status: 'APPROVED' },
      orderBy: { graduationYear: 'desc' },
    });
  }

  async approve(id: string) {
    const registration = await this.prisma.db.alumniRegistration.findUnique({ where: { id } });
    if (!registration) throw new NotFoundException('Alumni registration not found');
    return this.prisma.db.alumniRegistration.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
  }

  async decline(id: string) {
    const registration = await this.prisma.db.alumniRegistration.findUnique({ where: { id } });
    if (!registration) throw new NotFoundException('Alumni registration not found');
    return this.prisma.db.alumniRegistration.update({
      where: { id },
      data: { status: 'DECLINED' },
    });
  }

  async delete(id: string) {
    const registration = await this.prisma.db.alumniRegistration.findUnique({ where: { id } });
    if (!registration) throw new NotFoundException('Alumni registration not found');
    return this.prisma.db.alumniRegistration.delete({ where: { id } });
  }
}
