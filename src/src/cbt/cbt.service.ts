import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import {
  CreateQuestionBankDto,
  CreateQuestionDto,
  CreateExamDto,
  AddExamQuestionsDto,
  StartAttemptDto,
  SubmitAttemptDto,
  UpdateExamStatusDto,
  RedeemCodeDto,
  BulkCreateQuestionsDto,
} from './dto/cbt.dto';

/**
 * Computer-Based Testing: question banks, questions, exams, exam questions,
 * attempts and auto-grading of objective questions.
 */
@Injectable()
export class CbtService {
  private readonly logger = new Logger(CbtService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommunicationService,
    private readonly config: ConfigService,
  ) {}

  // ---- Question banks ----
  listBanks(schoolId: string | null) {
    return this.prisma.db.questionBank.findMany({
      where: schoolId ? { schoolId } : {},
      include: { _count: { select: { questions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  createBank(schoolId: string | null, dto: CreateQuestionBankDto) {
    return this.prisma.db.questionBank.create({
      data: {
        schoolId: schoolId ?? '',
        title: dto.title,
        courseId: dto.courseId,
        category: dto.category,
      },
    });
  }

  // ---- Questions ----
  listQuestions(bankId: string) {
    return this.prisma.db.question.findMany({
      where: { bankId },
      include: { options: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  createQuestion(dto: CreateQuestionDto) {
    return this.prisma.db.question.create({
      data: {
        bankId: dto.bankId,
        type: (dto.type as any) ?? 'OBJECTIVE',
        text: dto.text,
        marks: dto.marks ?? 1,
        difficulty: dto.difficulty ?? 'medium',
        explanation: dto.explanation,
        options: dto.options?.length
          ? {
              create: dto.options.map((o, i) => ({
                text: o.text,
                isCorrect: o.isCorrect ?? false,
                order: o.order ?? i,
              })),
            }
          : undefined,
      },
      include: { options: true },
    });
  }

  // ---- Exams ----
  listExams(schoolId: string | null) {
    return this.prisma.db.exam.findMany({
      where: schoolId ? { schoolId } : {},
      include: {
        course: true,
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getExam(id: string) {
    const exam = await this.prisma.db.exam.findUnique({
      where: { id },
      include: {
        questions: { include: { question: { include: { options: true } } } },
        course: true,
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  createExam(schoolId: string | null, dto: CreateExamDto) {
    return this.prisma.db.exam.create({
      data: {
        schoolId: schoolId ?? '',
        title: dto.title,
        courseId: dto.courseId,
        sessionId: dto.sessionId,
        instructions: dto.instructions,
        durationMins: dto.durationMins ?? 60,
        passMark: dto.passMark ?? 40,
        shuffleQuestions: dto.shuffleQuestions ?? true,
        lockBrowser: dto.lockBrowser ?? false,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        status: 'DRAFT',
      },
    });
  }

  async updateExamStatus(id: string, dto: UpdateExamStatusDto) {
    const exam = await this.prisma.db.exam.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException('Exam not found');
    return this.prisma.db.exam.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  addExamQuestions(examId: string, dto: AddExamQuestionsDto) {
    return this.prisma.db.examQuestion.createMany({
      data: dto.questionIds.map((questionId, order) => ({
        examId,
        questionId,
        order,
      })),
      skipDuplicates: true,
    });
  }

  async removeExamQuestions(examId: string, questionIds: string[]) {
    return this.prisma.db.examQuestion.deleteMany({
      where: {
        examId,
        questionId: { in: questionIds },
      },
    });
  }

  // ---- Attempts ----
  async startAttempt(dto: StartAttemptDto) {
    const exam = await this.prisma.db.exam.findUnique({
      where: { id: dto.examId },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    // Validate and redeem access code if provided
    if (dto.code) {
      await this.redeemCode({
        examId: dto.examId,
        code: dto.code,
        studentId: dto.studentId,
      });
    }

    const existing = await this.prisma.db.examAttempt.findUnique({
      where: {
        examId_studentId: { examId: dto.examId, studentId: dto.studentId },
      },
    });
    if (existing) return existing;

    return this.prisma.db.examAttempt.create({
      data: {
        examId: dto.examId,
        studentId: dto.studentId,
        status: 'IN_PROGRESS',
      },
    });
  }

  /**
   * Submit an attempt: persist responses and auto-grade objective questions
   * by comparing selected options against the correct ones.
   */
  async submitAttempt(attemptId: string, dto: SubmitAttemptDto) {
    const attempt = await this.prisma.db.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt already submitted');
    }

    let totalScore = 0;

    for (const answer of dto.answers) {
      const question = await this.prisma.db.question.findUnique({
        where: { id: answer.questionId },
        include: { options: true },
      });
      if (!question) continue;

      const correctOptionIds = question.options
        .filter((o) => o.isCorrect)
        .map((o) => o.id)
        .sort();
      const selected = [...(answer.selectedOptions ?? [])].sort();

      const isObjective =
        question.type === 'OBJECTIVE' || question.type === 'TRUE_FALSE';
      const isCorrect =
        isObjective &&
        correctOptionIds.length > 0 &&
        correctOptionIds.length === selected.length &&
        correctOptionIds.every((id, i) => id === selected[i]);

      const awardedMarks = isCorrect ? question.marks : 0;
      totalScore += awardedMarks;

      await this.prisma.db.answerResponse.upsert({
        where: {
          attemptId_questionId: {
            attemptId,
            questionId: answer.questionId,
          },
        },
        create: {
          attemptId,
          questionId: answer.questionId,
          selectedOptions: answer.selectedOptions ?? [],
          essayText: answer.essayText,
          isCorrect,
          awardedMarks,
        },
        update: {
          selectedOptions: answer.selectedOptions ?? [],
          essayText: answer.essayText,
          isCorrect,
          awardedMarks,
        },
      });
    }

    const graded = await this.prisma.db.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'GRADED',
        score: totalScore,
        submittedAt: new Date(),
      },
      include: { responses: true, exam: { include: { course: true } } },
    });

    // Notify lecturers allocated to the exam's course
    if (graded.exam?.course) {
      const course = graded.exam.course;
      const allocations = await this.prisma.db.courseAllocation.findMany({
        where: { courseId: course.id },
        include: { staff: { include: { user: true } } },
      });
      const lecturerUserIds = allocations
        .map((a) => a.staff?.userId)
        .filter((id): id is string => !!id);
      if (lecturerUserIds.length) {
        const student = await this.prisma.db.student.findUnique({ where: { id: attempt.studentId } });
        const studentName = student ? `${student.firstName} ${student.lastName}` : 'A student';
        this.comms
          .notifyUsers(
            lecturerUserIds,
            'CBT Exam Graded',
            `${studentName} completed the exam for ${course.code} — ${course.title} with a score of ${totalScore}.`,
          )
          .catch((err) => this.logger.error('Failed to send CBT notification', err instanceof Error ? err.stack : ''));
      }
    }

    return graded;
  }

  listAttempts(examId: string) {
    return this.prisma.db.examAttempt.findMany({
      where: { examId },
      include: { student: true },
      orderBy: { startedAt: 'desc' },
    });
  }

  // ---- Access Codes ----
  async generateCodes(examId: string) {
    const exam = await this.prisma.db.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    
    // Generate 10 unique codes
    for (let i = 0; i < 10; i++) {
      let code: string;
      let isUnique = false;
      
      while (!isUnique) {
        const part1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        code = `EXAM-${part1}-${part2}`;
        
        // Check if code already exists
        const existing = await this.prisma.db.examAccessCode.findUnique({ where: { code } });
        if (!existing) {
          isUnique = true;
        }
      }
      
      codes.push(code!);
    }

    // Create all codes in the database
    return this.prisma.db.examAccessCode.createMany({
      data: codes.map((code) => ({ examId, code })),
    });
  }

  async listCodes(examId: string) {
    const codes = await this.prisma.db.examAccessCode.findMany({
      where: { examId },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch student data for used codes
    const studentIds = codes
      .filter((c) => c.usedBy)
      .map((c) => c.usedBy as string);
    
    const uniqueStudentIds = [...new Set(studentIds)];
    
    const students = uniqueStudentIds.length > 0
      ? await this.prisma.db.student.findMany({
          where: { id: { in: uniqueStudentIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        })
      : [];

    const studentMap = new Map(students.map((s) => [s.id, s]));

    return codes.map((code) => ({
      ...code,
      usedBy: code.usedBy ? studentMap.get(code.usedBy) ?? null : null,
    }));
  }

  async redeemCode(dto: RedeemCodeDto) {
    const accessCode = await this.prisma.db.examAccessCode.findUnique({
      where: { code: dto.code },
    });

    if (!accessCode) {
      throw new BadRequestException('Invalid access code');
    }

    if (accessCode.examId !== dto.examId) {
      throw new BadRequestException('Access code is not valid for this exam');
    }

    if (accessCode.usedBy) {
      throw new BadRequestException('Access code has already been used');
    }

    return this.prisma.db.examAccessCode.update({
      where: { id: accessCode.id },
      data: {
        usedBy: dto.studentId,
        usedAt: new Date(),
      },
    });
  }

  // ---- Bulk Questions ----
  async bulkCreateQuestions(dto: BulkCreateQuestionsDto) {
    const bank = await this.prisma.db.questionBank.findUnique({
      where: { id: dto.bankId },
    });
    if (!bank) throw new NotFoundException('Question bank not found');

    const created: any[] = [];
    for (const q of dto.questions) {
      const question = await this.prisma.db.question.create({
        data: {
          bankId: dto.bankId,
          type: (q.type as any) ?? 'OBJECTIVE',
          text: q.text,
          marks: q.marks ?? 1,
          difficulty: q.difficulty ?? 'medium',
          explanation: q.explanation,
          options: q.options?.length
            ? {
                create: q.options.map((o, i) => ({
                  text: o.text,
                  isCorrect: o.isCorrect ?? false,
                  order: o.order ?? i,
                })),
              }
            : undefined,
        },
        include: { options: true },
      });
      created.push(question);
    }

    return { count: created.length, questions: created };
  }

  // ---- Auto-save ----
  async autoSaveAttempt(attemptId: string, dto: import('./dto/cbt.dto').AutoSaveAttemptDto) {
    const attempt = await this.prisma.db.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt is no longer in progress');
    }

    await this.prisma.db.examAttempt.update({
      where: { id: attemptId },
      data: { autoSaveData: { answers: dto.answers, savedAt: new Date().toISOString() } as any },
    });

    return { success: true };
  }

  // ---- Encrypted backup import ----
  async importEncryptedBackup(dto: import('./dto/cbt.dto').ImportEncryptedBackupDto) {
    const encryptionKey = this.config.get<string>('CBT_ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new BadRequestException('Server encryption key not configured');
    }

    // Parse the encrypted payload
    let envelope: { iv: string; salt: string; data: string };
    try {
      envelope = JSON.parse(dto.encryptedPayload);
    } catch {
      throw new BadRequestException('Invalid encrypted payload format');
    }

    if (!envelope.iv || !envelope.salt || !envelope.data) {
      throw new BadRequestException('Missing iv, salt, or data in encrypted payload');
    }

    // Derive AES key from shared secret + salt via PBKDF2
    const iv = Buffer.from(envelope.iv, 'base64');
    const salt = Buffer.from(envelope.salt, 'base64');
    const encryptedData = Buffer.from(envelope.data, 'base64');

    const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, 'sha256');

    let decrypted: string;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      // The last 16 bytes are the GCM auth tag
      const authTag = encryptedData.subarray(encryptedData.length - 16);
      const actualCiphertext = encryptedData.subarray(0, encryptedData.length - 16);
      decipher.setAuthTag(authTag);
      decrypted = Buffer.concat([
        decipher.update(actualCiphertext),
        decipher.final(),
      ]).toString('utf-8');
    } catch {
      throw new BadRequestException('Decryption failed — file may be corrupted or tampered with');
    }

    // Parse and verify the backup data
    let backup: {
      attemptId: string;
      examId: string;
      studentId: string;
      answers: any[];
      texts: Record<string, string>;
      checksum: string;
    };
    try {
      backup = JSON.parse(decrypted);
    } catch {
      throw new BadRequestException('Decrypted data is not valid JSON');
    }

    // Verify checksum
    const answersTextsStr = JSON.stringify({ answers: backup.answers, texts: backup.texts });
    const expectedChecksum = crypto.createHash('sha256').update(answersTextsStr).digest('hex');
    if (expectedChecksum !== backup.checksum) {
      throw new BadRequestException('Checksum verification failed — data has been tampered with');
    }

    // Verify exam matches
    if (backup.examId !== dto.examId) {
      throw new BadRequestException('Backup file does not belong to the selected exam');
    }

    // Find the attempt
    const attempt = await this.prisma.db.examAttempt.findFirst({
      where: {
        id: backup.attemptId,
        examId: dto.examId,
        studentId: backup.studentId,
      },
      include: { exam: true, student: true },
    });
    if (!attempt) {
      throw new NotFoundException('Matching attempt not found for this exam and student');
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Attempt is already ${attempt.status} — cannot import`);
    }

    // Build answer payload and submit using existing grading logic
    const submitAnswers = backup.answers.map((a: any) => ({
      questionId: a.questionId,
      selectedOptions: a.selectedOptions ?? [],
      essayText: a.essayText ?? backup.texts?.[a.questionId] ?? undefined,
    }));

    const result = await this.submitAttempt(attempt.id, { answers: submitAnswers });

    return {
      success: true,
      studentName: attempt.student
        ? `${attempt.student.firstName} ${attempt.student.lastName}`
        : 'Unknown',
      score: result.score,
      attemptId: attempt.id,
    };
  }
}
