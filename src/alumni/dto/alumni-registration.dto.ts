import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateAlumniRegistrationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  programme: string;

  @IsInt()
  @Min(1950)
  graduationYear: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  currentRole?: string;
}
