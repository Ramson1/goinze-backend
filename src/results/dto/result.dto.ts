import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const SEMESTERS = ['FIRST', 'SECOND', 'THIRD'] as const;

export class EnterScoreDto {
  @IsString()
  studentId!: string;

  @IsString()
  courseId!: string;

  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsEnum(SEMESTERS)
  semester?: (typeof SEMESTERS)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  caScore!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  examScore!: number;
}

export class ScoreRow {
  @IsString()
  studentId!: string;

  @Type(() => Number)
  @IsNumber()
  caScore!: number;

  @Type(() => Number)
  @IsNumber()
  examScore!: number;
}

export class BulkUploadDto {
  @IsString()
  courseId!: string;

  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsEnum(SEMESTERS)
  semester?: (typeof SEMESTERS)[number];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreRow)
  rows!: ScoreRow[];
}

export class VerifyResultPinDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  serial?: string;
}

export class UpdateScoreDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  caScore!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  examScore!: number;
}
