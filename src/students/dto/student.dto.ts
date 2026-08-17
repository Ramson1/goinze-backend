import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsEmail,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const STUDENT_STATUSES = [
  'APPLICANT',
  'ACTIVE',
  'SUSPENDED',
  'GRADUATED',
  'WITHDRAWN',
  'ARCHIVED',
] as const;

export class CreateStudentDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsEnum(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  stateOfOrigin?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  matricNumber?: string;

  @IsOptional()
  @IsString()
  regNumber?: string;

  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentLevel?: number;

  @IsOptional()
  @IsEnum(STUDENT_STATUSES)
  status?: (typeof STUDENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  passportUrl?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsEnum(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  stateOfOrigin?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentLevel?: number;

  @IsOptional()
  @IsEnum(STUDENT_STATUSES)
  status?: (typeof STUDENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  passportUrl?: string;
}

export class ImportStudentsDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  /** Rows to import; each row mirrors CreateStudentDto. */
  records!: CreateStudentDto[];
}
