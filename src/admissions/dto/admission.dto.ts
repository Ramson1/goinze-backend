import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  IsObject,
} from 'class-validator';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'INTERVIEW',
  'APPROVED',
  'REJECTED',
  'ADMITTED',
] as const;

export class ApplyDto {
  @IsOptional()
  @IsString()
  schoolSlug?: string;

  @IsOptional()
  @IsString()
  schoolCode?: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  // Extended personal information
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  @IsString()
  stateOfOrigin?: string;

  @IsOptional()
  @IsString()
  localGovernment?: string;

  @IsOptional()
  @IsString()
  postalAddress?: string;

  @IsOptional()
  @IsString()
  homeAddress?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  guardianGsm?: string;

  @IsOptional()
  @IsString()
  medicalHistory?: string;

  // Course choices
  @IsOptional()
  @IsString()
  firstChoice?: string;

  @IsOptional()
  @IsString()
  secondChoice?: string;

  @IsOptional()
  @IsString()
  thirdChoice?: string;

  // Structured table data
  @IsOptional()
  @IsObject()
  educationData?: Record<string, any>;

  // Declaration
  @IsOptional()
  @IsString()
  declarationName?: string;

  @IsOptional()
  @IsDateString()
  declarationDate?: string;

  @IsOptional()
  @IsBoolean()
  declarationAgreed?: boolean;

  /** Payment reference from a successful pre-admission fee payment. */
  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class ReviewApplicationDto {
  @IsEnum(APPLICATION_STATUSES)
  status!: (typeof APPLICATION_STATUSES)[number];

  @IsOptional()
  score?: number;

  @IsOptional()
  @IsDateString()
  interviewDate?: string;
}

export class ApproveApplicationDto {
  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class UpdateVerificationDto {
  @IsOptional()
  @IsBoolean()
  verificationDocumentsReviewed?: boolean;

  @IsOptional()
  @IsBoolean()
  verificationDocumentsMatch?: boolean;

  @IsOptional()
  @IsBoolean()
  verificationReceiptAttached?: boolean;

  @IsOptional()
  @IsBoolean()
  verificationCourseApproved?: boolean;
}
