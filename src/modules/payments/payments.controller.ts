import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { VnpayCallbackDto } from './dto/vnpay-callback.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('vnpay/callback-success')
  @HttpCode(HttpStatus.OK)
  success(@Body() dto: VnpayCallbackDto) {
    return this.payments.handleSuccess(dto.orderId, dto.sig);
  }

  @Post('vnpay/callback-cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Body() dto: VnpayCallbackDto) {
    return this.payments.handleCancel(dto.orderId, dto.sig);
  }
}
