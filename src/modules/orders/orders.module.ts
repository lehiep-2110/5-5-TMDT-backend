import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from '../../database/entities/address.entity';
import { BookImage } from '../../database/entities/book-image.entity';
import { Book } from '../../database/entities/book.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusLog } from '../../database/entities/order-status-log.entity';
import { Order } from '../../database/entities/order.entity';
import { StockLog } from '../../database/entities/stock-log.entity';
import { User } from '../../database/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { StaffOrdersController } from './controllers/staff-orders.controller';
import { OrderStateService } from './services/order-state.service';
import { OrdersService } from './services/orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderStatusLog,
      CartItem,
      Book,
      BookImage,
      Address,
      User,
      StockLog,
    ]),
    AuthModule,
  ],
  controllers: [
    CustomerOrdersController,
    AdminOrdersController,
    StaffOrdersController,
  ],
  providers: [OrdersService, OrderStateService],
  exports: [OrdersService, OrderStateService],
})
export class OrdersModule {}
