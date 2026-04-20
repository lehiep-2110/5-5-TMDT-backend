import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';

export class CreateOrderDto {
  @IsUUID('4', { message: 'addressId không hợp lệ.' })
  addressId!: string;

  @IsEnum(PaymentMethod, { message: 'Phương thức thanh toán không hợp lệ.' })
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'Mã voucher chỉ gồm chữ hoa, chữ số và dấu gạch ngang.',
  })
  voucherCode?: string;
}
