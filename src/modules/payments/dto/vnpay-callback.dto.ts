import { IsString, IsUUID } from 'class-validator';

export class VnpayCallbackDto {
  @IsUUID('4', { message: 'orderId không hợp lệ.' })
  orderId!: string;

  @IsString()
  sig!: string;
}
