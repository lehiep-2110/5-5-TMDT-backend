import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { VoucherScope } from '../../../common/enums/voucher-scope.enum';
import { VoucherType } from '../../../common/enums/voucher-type.enum';

export class CreateVoucherDto {
  @IsString()
  @Length(2, 50, { message: 'Mã voucher phải từ 2 đến 50 ký tự.' })
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'Mã voucher chỉ gồm chữ hoa, chữ số và dấu gạch ngang.',
  })
  code!: string;

  @IsEnum(VoucherType, { message: 'Loại voucher không hợp lệ.' })
  type!: VoucherType;

  @IsNumber({}, { message: 'Giá trị voucher phải là số.' })
  @Min(0.01, { message: 'Giá trị voucher phải > 0.' })
  value!: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giảm giá tối đa phải là số.' })
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá trị đơn tối thiểu phải là số.' })
  @Min(0)
  minOrderAmount?: number;

  @IsInt({ message: 'Tổng số lượng phải là số nguyên.' })
  @Min(1, { message: 'Tổng số lượng phải >= 1.' })
  totalQuantity!: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Giới hạn mỗi người dùng phải >= 1.' })
  perUserLimit?: number;

  @IsISO8601({}, { message: 'startDate phải là ISO8601.' })
  startDate!: string;

  @IsISO8601({}, { message: 'endDate phải là ISO8601.' })
  endDate!: string;

  @IsOptional()
  @IsEnum(VoucherScope)
  scopeType?: VoucherScope;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ValidatePercentageConstraints {
  // Helper used only inside service to check percentage-specific rules.
  static check(type: VoucherType, value: number, maxDiscount?: number): void {
    if (type === VoucherType.PERCENTAGE) {
      if (value < 1 || value > 100) {
        throw new Error('Voucher phần trăm phải trong khoảng 1-100.');
      }
      if (maxDiscount === undefined || maxDiscount === null) {
        throw new Error(
          'Voucher phần trăm bắt buộc phải có maxDiscount.',
        );
      }
    }
  }
}

// Exported helper consts for convenience.
export const PERCENTAGE_MIN = 1;
export const PERCENTAGE_MAX = 100;
