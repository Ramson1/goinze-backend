import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { AuthTokens, JwtPayload, SessionUser } from '../lib/types';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from '../security/security.service';
import { CommunicationService } from '../communication/communication.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SelfRegisterDto } from './dto/self-register.dto';
import { LecturerSelfRegisterDto } from './dto/lecturer-self-register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
    private readonly comms: CommunicationService,
  ) {}

  /** Register a new user account and issue tokens. */
  async register(dto: RegisterDto): Promise<AuthTokens> {
    const exists = await this.prisma.db.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.db.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        schoolId: dto.schoolId,
        role: (dto.role as any) ?? 'STUDENT',
        status: 'ACTIVE',
      },
    });

    return this.issueTokens(user);
  }

  /** Validate credentials and issue tokens. */
  async login(dto: LoginDto, ipAddress?: string): Promise<AuthTokens> {
    let user: Awaited<ReturnType<AuthService['validateUser']>>;
    try {
      user = await this.validateUser(dto.email, dto.password);
    } catch (err) {
      await this.security
        .log({
          action: 'auth.login_failed',
          entity: 'User',
          metadata: { email: dto.email.toLowerCase(), reason: 'Invalid credentials' },
          ipAddress,
        })
        .catch(() => undefined);
      throw err;
    }
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.db.loginHistory.create({
      data: { userId: user.id, success: true, ipAddress },
    });
    await this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'auth.login',
        entity: 'User',
        entityId: user.id,
        metadata: { email: user.email },
        ipAddress,
      })
      .catch(() => undefined);
    return this.issueTokens(user);
  }

  /** Verify an email/password pair and return the user (sans password hash). */
  async validateUser(email: string, password: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === 'PENDING') {
      throw new UnauthorizedException('Your account is pending admin approval. Please contact the school admin.');
    }
    const { passwordHash, ...result } = user;
    return result;
  }

  /** Rotate tokens given a valid refresh token. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>(
          'JWT_REFRESH_SECRET',
          'change-me-refresh-secret',
        ),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.issueTokens(user);
  }

  /** Logout is stateless for JWTs; the client discards the tokens. */
  async logout(): Promise<{ success: true }> {
    return { success: true };
  }

  /** Return the current user's profile (without the password hash). */
  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as SessionUser['role'],
      schoolId: user.schoolId,
      avatarUrl: user.avatarUrl,
    };
  }

  /** Change the current user's password after verifying the existing one. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string,
  ): Promise<{ success: true }> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.security
      .log({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'auth.password_changed',
        entity: 'User',
        entityId: user.id,
        metadata: { changedField: 'password' },
        ipAddress,
      })
      .catch(() => undefined);
    return { success: true };
  }

  /** Update the current user's profile fields (firstName, lastName, email, avatarUrl). */
  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; email?: string; avatarUrl?: string },
    ipAddress?: string,
  ): Promise<SessionUser> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing
    if (data.email && data.email !== user.email) {
      const existing = await this.prisma.db.user.findUnique({ where: { email: data.email } });
      if (existing) {
        throw new ConflictException('Email is already in use');
      }
    }

    // Track what changed
    const changes: Record<string, { old: string; new: string }> = {};
    if (data.firstName !== undefined && data.firstName !== user.firstName) {
      changes.firstName = { old: user.firstName, new: data.firstName };
    }
    if (data.lastName !== undefined && data.lastName !== user.lastName) {
      changes.lastName = { old: user.lastName, new: data.lastName };
    }
    if (data.email !== undefined && data.email !== user.email) {
      changes.email = { old: user.email, new: data.email };
    }
    if (data.avatarUrl !== undefined && data.avatarUrl !== (user.avatarUrl ?? '')) {
      changes.avatarUrl = { old: user.avatarUrl ?? '', new: data.avatarUrl };
    }

    const updated = await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
    });

    // Log the changes
    if (Object.keys(changes).length > 0) {
      await this.security
        .log({
          schoolId: user.schoolId,
          userId: user.id,
          action: 'auth.profile_updated',
          entity: 'User',
          entityId: user.id,
          metadata: { changes },
          ipAddress,
        })
        .catch(() => undefined);
    }

    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: updated.role as SessionUser['role'],
      schoolId: updated.schoolId,
      avatarUrl: updated.avatarUrl,
    };
  }

  /** Sign an access + refresh JWT pair for a user. */
  private async issueTokens(user: {
    id: string;
    email: string;
    role: string;
    schoolId: string | null;
  }): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
      schoolId: user.schoolId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET', 'change-me-access-secret'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      }),
      this.jwt.signAsync(
        { sub: user.id },
        {
          secret: this.config.get<string>(
            'JWT_REFRESH_SECRET',
            'change-me-refresh-secret',
          ),
          expiresIn: this.config.get<string>('JWT_REFRESH_TTL', '7d'),
        },
      ),
    ]);

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  /**
   * Self-registration for existing students: verify identity via matric number + personal details,
   * create a PENDING user account linked to the student record. Admin must approve before login.
   */
  async selfRegister(dto: SelfRegisterDto): Promise<{ success: true; message: string }> {
    // 1. Check no User already exists with the provided email
    const existingUser = await this.prisma.db.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    // 2. Try to find an existing student record by matric number + school
    const student = await this.prisma.db.student.findFirst({
      where: { matricNumber: dto.matricNumber, schoolId: dto.schoolId },
      include: { department: true },
    });

    const passwordHash = await bcrypt.hash(dto.password, 10);

    if (student) {
      // --- Existing flow: verify identity + link to Student ---
      if (student.userId) {
        throw new ConflictException('This student record already has a portal account. Contact the admin if you need help.');
      }
      if (student.departmentId && student.departmentId !== dto.departmentId) {
        throw new BadRequestException('The department provided does not match our records.');
      }
      if (student.firstName.toLowerCase() !== dto.firstName.trim().toLowerCase() ||
          student.lastName.toLowerCase() !== dto.lastName.trim().toLowerCase()) {
        throw new BadRequestException('The names provided do not match our records.');
      }

      await this.prisma.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone,
            schoolId: dto.schoolId,
            role: 'STUDENT',
            status: 'PENDING',
          },
        });
        await tx.student.update({
          where: { id: student.id },
          data: {
            userId: user.id,
            ...(dto.currentLevel !== undefined ? { currentLevel: dto.currentLevel } : {}),
          },
        });
      });
    } else {
      // --- NEW: No student record — create standalone PENDING user with metadata ---
      await this.prisma.db.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone,
          schoolId: dto.schoolId,
          role: 'STUDENT',
          status: 'PENDING',
          metadata: { matricNumber: dto.matricNumber, departmentId: dto.departmentId, currentLevel: dto.currentLevel ?? null },
        } as any,
      });
    }

    // 3. Notify admins about the new self-registration (fire-and-forget)
    const notifyStudentReg = this.comms
      .notifyUsersByRole(
        dto.schoolId,
        'SCHOOL_ADMIN',
        'New Portal Account Registration',
        `${dto.firstName} ${dto.lastName} (Matric: ${dto.matricNumber}) has registered for a portal account and is awaiting approval.`,
      )
      .catch((err) => this.logger.error('Failed to notify SCHOOL_ADMIN of self-registration', err instanceof Error ? err.stack : ''));
    const notifySuperReg = this.comms
      .notifyUsersByRole(
        dto.schoolId,
        'SUPER_ADMIN',
        'New Portal Account Registration',
        `${dto.firstName} ${dto.lastName} (Matric: ${dto.matricNumber}) has registered for a portal account and is awaiting approval.`,
      )
      .catch((err) => this.logger.error('Failed to notify SUPER_ADMIN of self-registration', err instanceof Error ? err.stack : ''));
    Promise.allSettled([notifyStudentReg, notifySuperReg]);

    return {
      success: true,
      message: 'Registration submitted successfully. Your account is awaiting admin approval.',
    };
  }

  /**
   * Self-registration for existing lecturers: verify identity via staff number + personal details,
   * create a PENDING user account linked to the staff record. Admin must approve before login.
   */
  async selfRegisterLecturer(dto: LecturerSelfRegisterDto): Promise<{ success: true; message: string }> {
    // 1. Check no User already exists with the provided email
    const existingUser = await this.prisma.db.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    // 2. Try to find an existing staff record by staff number + school
    const staff = await this.prisma.db.staff.findFirst({
      where: { staffNumber: dto.staffNumber, schoolId: dto.schoolId },
      include: { department: true },
    });

    const passwordHash = await bcrypt.hash(dto.password, 10);

    if (staff) {
      // --- Existing flow: verify identity + link to Staff ---
      if (staff.userId) {
        throw new ConflictException('This staff record already has a portal account. Contact the admin if you need help.');
      }
      if (!staff.isLecturer) {
        throw new BadRequestException('This staff record is not marked as a lecturer. Contact the admin.');
      }
      if (staff.departmentId && staff.departmentId !== dto.departmentId) {
        throw new BadRequestException('The department provided does not match our records.');
      }
      if (staff.firstName.toLowerCase() !== dto.firstName.trim().toLowerCase() ||
          staff.lastName.toLowerCase() !== dto.lastName.trim().toLowerCase()) {
        throw new BadRequestException('The names provided do not match our records.');
      }

      await this.prisma.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone,
            schoolId: dto.schoolId,
            role: 'LECTURER',
            status: 'PENDING',
          },
        });
        await tx.staff.update({
          where: { id: staff.id },
          data: { userId: user.id },
        });
        // Create course allocations if courses were specified
        if (dto.courseIds && dto.courseIds.length > 0) {
          for (const courseId of dto.courseIds) {
            await tx.courseAllocation.create({
              data: { courseId, staffId: staff.id },
            }).catch(() => { /* ignore duplicate allocation errors */ });
          }
        }
      });
    } else {
      // --- NEW: No staff record — create standalone PENDING user with metadata ---
      await this.prisma.db.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone,
          schoolId: dto.schoolId,
          role: 'LECTURER',
          status: 'PENDING',
          metadata: { staffNumber: dto.staffNumber, departmentId: dto.departmentId, courseIds: dto.courseIds ?? [] },
        } as any,
      });
    }

    // 3. Notify admins about the new self-registration (fire-and-forget)
    const notifyLectReg = this.comms
      .notifyUsersByRole(
        dto.schoolId,
        'SCHOOL_ADMIN',
        'New Lecturer Portal Account Registration',
        `${dto.firstName} ${dto.lastName} (Staff: ${dto.staffNumber}) has registered for a lecturer portal account and is awaiting approval.`,
      )
      .catch((err) => this.logger.error('Failed to notify SCHOOL_ADMIN of lecturer self-registration', err instanceof Error ? err.stack : ''));
    const notifySuperLect = this.comms
      .notifyUsersByRole(
        dto.schoolId,
        'SUPER_ADMIN',
        'New Lecturer Portal Account Registration',
        `${dto.firstName} ${dto.lastName} (Staff: ${dto.staffNumber}) has registered for a lecturer portal account and is awaiting approval.`,
      )
      .catch((err) => this.logger.error('Failed to notify SUPER_ADMIN of lecturer self-registration', err instanceof Error ? err.stack : ''));
    Promise.allSettled([notifyLectReg, notifySuperLect]);

    return {
      success: true,
      message: 'Registration submitted successfully. Your account is awaiting admin approval.',
    };
  }
}
