import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @Length(2, 255, { message: 'Tên người nhận phải từ 2 đến 255 ký tự.' })
  recipientName!: string;

  @IsString()
  @Matches(/^[0-9+\-\s]{8,20}$/, {
    message: 'Số điện thoại không hợp lệ.',
  })
  phone!: string;

  @IsString()
  @Length(1, 100)
  province!: string;

  @IsString()
  @Length(1, 100)
  district!: string;

  @IsString()
  @Length(1, 100)
  ward!: string;

  @IsString()
  @Length(1, 500)
  streetAddress!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @Length(2, 255)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s]{8,20}$/, {
    message: 'Số điện thoại không hợp lệ.',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  province?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  district?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  ward?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  streetAddress?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
