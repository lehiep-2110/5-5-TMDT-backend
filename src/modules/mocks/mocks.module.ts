import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ShippingService } from './shipping.service';

@Global()
@Module({
  providers: [EmailService, ShippingService],
  exports: [EmailService, ShippingService],
})
export class MocksModule {}
