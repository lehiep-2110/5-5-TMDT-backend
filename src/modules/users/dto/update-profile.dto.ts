import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 255, { message: 'Họ tên phải từ 2 đến 255 ký tự.' })
  fullName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s]{8,20}$/, {
    message: 'Số điện thoại không hợp lệ.',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  avatarUrl?: string;
}
