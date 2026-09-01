import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const QUESTION_TYPES = [
  'OBJECTIVE',
  'MULTI_SELECT',
  'TRUE_FALSE',
  'ESSAY',
  'FILL_BLANK',
] as const;

export class CreateQuestionBankDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class QuestionOptionDto {
  @IsString()
  text!: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order?: number;
}

export class CreateQuestionDto {
  @IsString()
  bankId!: string;

  @IsOptional()
  @IsEnum(QUESTION_TYPES)
  type?: (typeof QUESTION_TYPES)[number];

  @IsString()
  text!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class CreateExamDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMins?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  passMark?: number;

  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  @IsOptional()
  @IsBoolean()
  lockBrowser?: boolean;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;
}

const EXAM_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;

export class UpdateExamStatusDto {
  @IsEnum(EXAM_STATUSES)
  status!: (typeof EXAM_STATUSES)[number];
}

export class AddExamQuestionsDto {
  @IsArray()
  @IsString({ each: true })
  questionIds!: string[];
}

export class StartAttemptDto {
  @IsString()
  examId!: string;

  @IsString()
  studentId!: string;

  @IsOptional()
  @IsString()
  code?: string;
}

export class AnswerDto {
  @IsString()
  questionId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptions?: string[];

  @IsOptional()
  @IsString()
  essayText?: string;
}

export class SubmitAttemptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}

export class RedeemCodeDto {
  @IsString()
  examId!: string;

  @IsString()
  code!: string;

  @IsString()
  studentId!: string;
}

export class BulkQuestionItemDto {
  @IsOptional()
  @IsEnum(QUESTION_TYPES)
  type?: (typeof QUESTION_TYPES)[number];

  @IsString()
  text!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marks?: number;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class BulkCreateQuestionsDto {
  @IsString()
  bankId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkQuestionItemDto)
  questions!: BulkQuestionItemDto[];
}

export class AutoSaveAttemptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}

export class ImportEncryptedBackupDto {
  @IsString()
  examId!: string;

  @IsString()
  encryptedPayload!: string;
}
