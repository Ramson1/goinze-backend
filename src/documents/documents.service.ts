import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/utils/cloudinary.service';

/**
 * Documents: record upload metadata, list by student/owner and delete.
 * File storage is handled via Cloudinary through CloudinaryService.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /** Upload a raw file buffer to Cloudinary and return the hosted URL. */
  async uploadFile(file: Buffer, folder = 'goinzeschool') {
    return this.cloudinary.uploadImage(file, folder);
  }

  /** Record metadata for an uploaded document. */
  create(
    schoolId: string | null,
    data: {
      name: string;
      url: string;
      type?: string;
      mimeType?: string;
      sizeBytes?: number;
      studentId?: string;
      applicationId?: string;
      ownerUserId?: string;
    },
  ) {
    return this.prisma.db.document.create({
      data: {
        schoolId: schoolId ?? '',
        name: data.name,
        url: data.url,
        type: (data.type as any) ?? 'OTHER',
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        studentId: data.studentId,
        applicationId: data.applicationId,
        ownerUserId: data.ownerUserId,
      },
    });
  }

  async listByStudent(studentId: string) {
    const student = await this.prisma.db.student.findUnique({
      where: { id: studentId },
      include: {
        application: {
          select: { id: true, admissionLetterUrl: true },
        },
      },
    });

    if (!student) return { documents: [], admissionLetterUrl: null };

    // Build OR condition: documents linked to student OR to their application
    const orConditions: any[] = [{ studentId }];
    if (student.application?.id) {
      orConditions.push({ applicationId: student.application.id });
    }

    const documents = await this.prisma.db.document.findMany({
      where: { OR: orConditions },
      orderBy: { createdAt: 'desc' },
    });

    // De-duplicate (a document could have both studentId and applicationId set)
    const seen = new Set<string>();
    const unique = documents.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    // Include the admission letter as a virtual document entry if it exists
    const admissionLetterUrl = student.application?.admissionLetterUrl ?? null;
    if (admissionLetterUrl) {
      unique.unshift({
        id: 'admission-letter',
        schoolId: student.schoolId,
        ownerUserId: null,
        studentId,
        applicationId: student.application?.id ?? null,
        type: 'ADMISSION_LETTER',
        name: 'Admission Letter',
        url: admissionLetterUrl,
        mimeType: 'text/html',
        sizeBytes: null,
        createdAt: new Date(),
      } as any);
    }

    return { documents: unique, admissionLetterUrl };
  }

  list(schoolId: string | null) {
    return this.prisma.db.document.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async remove(id: string) {
    const document = await this.prisma.db.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document not found');
    return this.prisma.db.document.delete({ where: { id } });
  }
}
