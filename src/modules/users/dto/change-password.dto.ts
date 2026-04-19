import { IsString, Matches, MinLength } from 'class-validator';
import { Match } from '../../../common/validators/match.validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Mật khẩu hiện tại không được để trống.' })
  oldPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Mật khẩu mới phải bao gồm cả chữ và số.',
  })
  newPassword!: string;

  @IsString()
  @Match('newPassword', { message: 'Xác nhận mật khẩu không khớp.' })
  confirmPassword!: string;
}
