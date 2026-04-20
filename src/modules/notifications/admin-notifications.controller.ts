import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '../../database/entities/user.entity';
import { BroadcastNotificationDto } from './dto/broadcast.dto';
import { NotificationsService } from './notifications.service';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNotificationsController {
  constructor(
    private readonly service: NotificationsService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async broadcast(
    @Body() dto: BroadcastNotificationDto,
  ): Promise<{ sent: number }> {
    let userIds: string[];
    if (dto.target === 'all') {
      const rows = await this.users
        .createQueryBuilder('u')
        .select('u.id', 'id')
        .where('u.role = :role', { role: UserRole.CUSTOMER })
        .andWhere('u.status = :status', { status: UserStatus.ACTIVE })
        .getRawMany<{ id: string }>();
      userIds = rows.map((r) => r.id);
    } else if (Array.isArray(dto.target)) {
      userIds = dto.target.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
    } else {
      throw new BadRequestException("target phải là 'all' hoặc mảng userIds.");
    }

    let sent = 0;
    for (const userId of userIds) {
      try {
        await this.service.saveAndEmit(userId, {
          type: dto.type ?? 'ANNOUNCEMENT',
          title: dto.title,
          content: dto.content,
          link: dto.link ?? null,
        });
        sent += 1;
      } catch {
        // Skip users that failed (e.g. deleted) and continue.
      }
    }
    return { sent };
  }
}
