import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';

export class UpdateStatusDto {
  @IsEnum(OrderStatus, { message: 'Trạng thái đơn hàng không hợp lệ.' })
  toStatus!: OrderStatus;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus, { message: 'Trạng thái thanh toán không hợp lệ.' })
  paymentStatus!: PaymentStatus;
}
