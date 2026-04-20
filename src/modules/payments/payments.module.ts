import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '../../database/entities/book.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusLog } from '../../database/entities/order-status-log.entity';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { StockLog } from '../../database/entities/stock-log.entity';
import { AuthModule } from '../auth/auth.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { PaymentGatewaySimController } from './payment-gateway-sim.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderStatusLog,
      Payment,
      Book,
      StockLog,
    ]),
    ConfigModule,
    AuthModule,
    VouchersModule,
  ],
  controllers: [PaymentsController, PaymentGatewaySimController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
