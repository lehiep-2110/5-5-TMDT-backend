import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Mật khẩu không được để trống.' })
  password!: string;
}
