import { Injectable, NotFoundException } from '@nestjs/common';
import {
  generateCardNumber,
  generateVerificationCode,
} from '../../../lib/utils';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Digital ID cards: generate for a student or staff member, verify by code,
 * and revoke.
 */
@Injectable()
export class IdCardsService {
  constructor(private readonly prisma: PrismaService) {}

  private async schoolCode(schoolId: string | null): Promise<string> {
    if (!schoolId) return 'GIS';
    const school = await this.prisma.db.school.findUnique({
      where: { id: schoolId },
      select: { code: true },
    });
    return school?.code ?? 'GIS';
  }

  /** Generate an ID card for a student or staff member. */
  async generate(
    schoolId: string | null,
    data: { type: 'STUDENT' | 'STAFF'; studentId?: string; staffId?: string },
  ) {
    const code = await this.schoolCode(schoolId);
    const cardNumber = generateCardNumber(code);
    const verificationCode = generateVerificationCode();

    return this.prisma.db.idCard.create({
      data: {
        schoolId: schoolId ?? '',
        type: data.type as any,
        studentId: data.studentId,
        staffId: data.staffId,
        cardNumber,
        verificationCode,
        qrData: `goinzeschool://id/${verificationCode}`,
        barcode: cardNumber,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 4 * 365 * 24 * 60 * 60 * 1000)
      },
    });
  }

  list(schoolId: string | null, type?: string) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (type) where.type = type;
    return this.prisma.db.idCard.findMany({
      where,
      include: { student: true, staff: true },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
  }

  /** Verify an ID card by its verification code. */
  async verify(code: string) {
    const card = await this.prisma.db.idCard.findUnique({
      where: { verificationCode: code.toUpperCase() },
      include: { student: true, staff: true },
    });
    if (!card) throw new NotFoundException('ID card not found or invalid code');
    return {
      valid: card.status === 'ACTIVE',
      status: card.status,
      card,
    };
  }

  /** Revoke an ID card. */
  async revoke(id: string) {
    const card = await this.prisma.db.idCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('ID card not found');
    return this.prisma.db.idCard.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
  }

  /** Batch generate ID cards for multiple students or staff. */
  async batchGenerate(
    schoolId: string | null,
    data: { type: 'STUDENT' | 'STAFF'; studentIds?: string[]; staffIds?: string[] },
  ) {
    const code = await this.schoolCode(schoolId);
    const results: any[] = [];

    if (data.type === 'STUDENT' && data.studentIds?.length) {
      for (const studentId of data.studentIds) {
        // Skip if already has an active card
        const existing = await this.prisma.db.idCard.findFirst({
          where: { studentId, status: 'ACTIVE' },
        });
        if (existing) {
          results.push(existing);
          continue;
        }
        const cardNumber = generateCardNumber(code);
        const verificationCode = generateVerificationCode();
        const card = await this.prisma.db.idCard.create({
          data: {
            schoolId: schoolId ?? '',
            type: 'STUDENT',
            studentId,
            cardNumber,
            verificationCode,
            qrData: `goinzeschool://id/${verificationCode}`,
            barcode: cardNumber,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 4 * 365 * 24 * 60 * 60 * 1000)
          },
        });
        results.push(card);
      }
    }

    if (data.type === 'STAFF' && data.staffIds?.length) {
      for (const staffId of data.staffIds) {
        const existing = await this.prisma.db.idCard.findFirst({
          where: { staffId, status: 'ACTIVE' },
        });
        if (existing) {
          results.push(existing);
          continue;
        }
        const cardNumber = generateCardNumber(code);
        const verificationCode = generateVerificationCode();
        const card = await this.prisma.db.idCard.create({
          data: {
            schoolId: schoolId ?? '',
            type: 'STAFF',
            staffId,
            cardNumber,
            verificationCode,
            qrData: `goinzeschool://id/${verificationCode}`,
            barcode: cardNumber,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 4 * 365 * 24 * 60 * 60 * 1000)
          },
        });
        results.push(card);
      }
    }

    return results;
  }

  /** Return a map of personId -> latest active card for status tracking. */
  async getStatusMap(schoolId: string | null): Promise<Record<string, any>> {
    const where: Record<string, any> = { status: 'ACTIVE' };
    if (schoolId) where.schoolId = schoolId;

    const cards = await this.prisma.db.idCard.findMany({
      where,
      include: { student: true, staff: true },
      orderBy: { issuedAt: 'desc' },
    });

    const map: Record<string, any> = {};
    for (const card of cards) {
      const key = card.studentId ?? card.staffId;
      if (key && !map[key]) {
        map[key] = card;
      }
    }
    return map;
  }
}
