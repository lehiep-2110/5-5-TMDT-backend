import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { User } from '../../database/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SseAuthGuard } from './sse-auth.guard';
import { SseGateway } from './sse.gateway';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, User]), AuthModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, SseGateway, SseAuthGuard],
  exports: [NotificationsService, SseGateway],
})
export class NotificationsModule {}
