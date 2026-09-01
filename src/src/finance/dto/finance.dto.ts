import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const FEE_TYPES = [
  'SCHOOL',
  'ACCEPTANCE',
  'MEDICAL',
  'HOSTEL',
  'LIBRARY',
  'GRADUATION',
  'APPLICATION_FORM',
  'ENTRANCE_EXAM',
  'PORTAL_ACCESS',
  'SPORTS_WEAR',
  'MATRICULATION',
  'OTHER',
] as const;

const GATEWAYS = ['FLUTTERWAVE', 'PAYSTACK', 'BANK_TRANSFER', 'CASH'] as const;

export class CreateFeeStructureDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(FEE_TYPES)
  type?: (typeof FEE_TYPES)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  level?: number;

  @IsOptional()
  @IsEnum(['FIRST', 'SECOND', 'THIRD'])
  semester?: string;

  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  allowInstallment?: boolean;
}

export class UpdateFeeStructureDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(FEE_TYPES)
  type?: (typeof FEE_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  level?: number;

  @IsOptional()
  @IsEnum(['FIRST', 'SECOND', 'THIRD'])
  semester?: string;

  @IsOptional()
  @IsString()
  programmeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  allowInstallment?: boolean;
}

export class InitPaymentDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsOptional()
  @IsString()
  feeStructureId?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;

  /** Purpose of payment — distinguishes application-form fees from acceptance fees. */
  @IsOptional()
  @IsString()
  purpose?: string;

  /** School slug — used to resolve the school when no applicationId/studentId is provided. */
  @IsOptional()
  @IsString()
  schoolSlug?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsEnum(GATEWAYS)
  gateway?: (typeof GATEWAYS)[number];

  @IsOptional()
  @IsString()
  currency?: string;
}

export class VerifyPaymentDto {
  @IsString()
  reference!: string;

  @IsOptional()
  @IsString()
  gatewayRef?: string;
}

export class RefundDto {
  @IsString()
  paymentId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateScholarshipDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateManualPaymentDto {
  @IsString()
  studentId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  feeStructureId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  narration?: string;
}
