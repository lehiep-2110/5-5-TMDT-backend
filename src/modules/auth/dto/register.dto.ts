import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { Match } from '../../../common/validators/match.validator';

export class RegisterDto {
  @IsString({ message: 'Họ tên không hợp lệ.' })
  @Length(2, 255, { message: 'Họ tên phải từ 2 đến 255 ký tự.' })
  fullName!: string;

  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Mật khẩu phải bao gồm cả chữ và số.',
  })
  password!: string;

  @IsString()
  @Match('password', { message: 'Xác nhận mật khẩu không khớp.' })
  confirmPassword!: string;
}
