import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

/** Body for POST /students/me/course-registration. */
export class RegisterCoursesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  courseIds!: string[];

  @IsOptional()
  @IsIn(['FIRST', 'SECOND', 'THIRD'])
  semester?: 'FIRST' | 'SECOND' | 'THIRD';
}
