import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
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
}
