import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { SseGateway } from './sse.gateway';

export interface NotificationPayload {
  type: string;
  title: string;
  content: string;
  link?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly sseGateway: SseGateway,
  ) {}

  async saveAndEmit(
    userId: string,
    payload: NotificationPayload,
  ): Promise<Notification> {
    const row = this.notifications.create({
      userId,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      link: payload.link ?? null,
      isRead: false,
    });
    const saved = await this.notifications.save(row);
    try {
      this.sseGateway.broadcastTo(userId, {
        type: 'notification',
        data: saved,
      });
    } catch (err) {
      this.logger.warn(
        `Saved notification ${saved.id} but broadcast failed: ${(err as Error).message}`,
      );
    }
    return saved;
  }

  emit(userId: string, event: unknown): void {
    this.sseGateway.broadcastTo(userId, event);
  }

  async list(
    userId: string,
    opts: { page?: number; limit?: number; unreadOnly?: boolean },
  ): Promise<{
    items: Notification[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    unreadCount: number;
  }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));

    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId });
    if (opts.unreadOnly) {
      qb.andWhere('n.isRead = false');
    }
    qb.orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const unreadCount = await this.notifications.count({
      where: { userId, isRead: false },
    });
    return {
      items: rows,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      unreadCount,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const row = await this.notifications.findOne({ where: { id } });
    if (!row || row.userId !== userId) {
      // Silently return a no-op so IDs from another user can't be probed.
      throw new Error('Thông báo không tồn tại.');
    }
    if (!row.isRead) {
      row.isRead = true;
      await this.notifications.save(row);
    }
    return row;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true })
      .where('user_id = :userId', { userId })
      .andWhere('is_read = false')
      .execute();
    return { updated: result.affected ?? 0 };
  }
}
