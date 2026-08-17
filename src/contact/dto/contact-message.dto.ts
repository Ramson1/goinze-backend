import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ContactMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  phone?: string;
}
