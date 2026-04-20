import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoucherUsage } from '../../database/entities/voucher-usage.entity';
import { Voucher } from '../../database/entities/voucher.entity';
import { AuthModule } from '../auth/auth.module';
import { AdminVouchersController } from './admin-vouchers.controller';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Voucher, VoucherUsage]), AuthModule],
  controllers: [AdminVouchersController, VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
