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
  Min,
} from 'class-validator';
import { VoucherScope } from '../../../common/enums/voucher-scope.enum';
import { VoucherType } from '../../../common/enums/voucher-type.enum';

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Z0-9-]+$/)
  code?: string;

  @IsOptional()
  @IsEnum(VoucherType)
  type?: VoucherType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsEnum(VoucherScope)
  scopeType?: VoucherScope;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
