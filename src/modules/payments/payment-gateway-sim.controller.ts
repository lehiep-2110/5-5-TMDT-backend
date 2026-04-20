import {
  Controller,
  Get,
  Header,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';

/**
 * Serves the mock VNPAY bank-ish HTML page.
 * No auth — the user reaches this via a signed URL from the order confirmation step.
 */
@Controller('payments/vnpay')
export class PaymentGatewaySimController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('sim')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async sim(
    @Query('orderId') orderId: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.payments.getSimPage(orderId, sig);
    res.send(html);
  }
}
