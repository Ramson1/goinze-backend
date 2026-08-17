import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LecturerScoreRow {
  @IsString()
  studentId!: string;

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

/** Body for POST /lecturers/me/courses/:courseId/scores. */
export class SaveScoresDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LecturerScoreRow)
  rows!: LecturerScoreRow[];
}

/** Body for PATCH /lecturers/me — self-service profile fields. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  qualification?: string;
}
