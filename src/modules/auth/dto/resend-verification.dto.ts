import { IsEmail } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;
}
