import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Brackets, QueryRunner, Repository } from 'typeorm';
import { VoucherScope } from '../../common/enums/voucher-scope.enum';
import { VoucherType } from '../../common/enums/voucher-type.enum';
import { VoucherUsage } from '../../database/entities/voucher-usage.entity';
import { Voucher } from '../../database/entities/voucher.entity';
import { REDIS_CLIENT } from '../../config/redis.module';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';

export interface VoucherListItem {
  id: string;
  code: string;
  type: VoucherType;
  value: string;
  maxDiscount: string | null;
  minOrderAmount: string;
  totalQuantity: number;
  usedQuantity: number;
  perUserLimit: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  scopeType: VoucherScope;
  createdBy: string | null;
  createdAt: Date;
  isActiveNow: boolean;
  isExpired: boolean;
  isScheduled: boolean;
  progress: number;
  remaining: number;
}

export interface ValidatedVoucher {
  voucherId: string;
  code: string;
  type: VoucherType;
  value: string;
  discountAmount: number;
  finalSubtotal: number;
}

@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly vouchers: Repository<Voucher>,
    @InjectRepository(VoucherUsage)
    private readonly voucherUsages: Repository<VoucherUsage>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------
  // Redis helpers
  // ---------------------------------------------------------------------------
  private redisKey(code: string): string {
    return `voucher:remaining:${code}`;
  }

  private ttlSeconds(endDate: Date): number {
    const diffMs = endDate.getTime() - Date.now();
    if (diffMs <= 0) return 60; // small positive TTL so key cleans up naturally
    return Math.max(60, Math.ceil(diffMs / 1000));
  }

  private async syncRedisCounter(
    code: string,
    remaining: number,
    endDate: Date,
  ): Promise<void> {
    const key = this.redisKey(code);
    const ttl = this.ttlSeconds(endDate);
    await this.redis.set(key, String(Math.max(0, remaining)), 'EX', ttl);
  }

  // ---------------------------------------------------------------------------
  // Admin: create
  // ---------------------------------------------------------------------------
  async create(
    dto: CreateVoucherDto,
    creatorId: string,
  ): Promise<VoucherListItem> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const now = new Date();

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate / endDate không hợp lệ.');
    }
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('startDate phải <= endDate.');
    }
    if (end.getTime() <= now.getTime()) {
      throw new BadRequestException('endDate phải ở tương lai.');
    }

    if (dto.type === VoucherType.PERCENTAGE) {
      if (dto.value < 1 || dto.value > 100) {
        throw new BadRequestException(
          'Voucher phần trăm phải trong khoảng 1-100.',
        );
      }
      if (dto.maxDiscount === undefined || dto.maxDiscount === null) {
        throw new BadRequestException(
          'Voucher phần trăm bắt buộc phải có maxDiscount.',
        );
      }
    }

    const existing = await this.vouchers.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Mã voucher đã tồn tại.');
    }

    const row = this.vouchers.create({
      code: dto.code,
      type: dto.type,
      value: String(dto.value),
      maxDiscount:
        dto.maxDiscount !== undefined && dto.maxDiscount !== null
          ? String(dto.maxDiscount)
          : null,
      minOrderAmount: String(dto.minOrderAmount ?? 0),
      totalQuantity: dto.totalQuantity,
      usedQuantity: 0,
      perUserLimit: dto.perUserLimit ?? 1,
      startDate: start,
      endDate: end,
      isActive: dto.isActive ?? true,
      scopeType: dto.scopeType ?? VoucherScope.ALL,
      createdBy: creatorId,
    });
    const saved = await this.vouchers.save(row);

    await this.syncRedisCounter(saved.code, saved.totalQuantity, saved.endDate);

    return this.toListItem(saved);
  }

  // ---------------------------------------------------------------------------
  // Admin: update
  // ---------------------------------------------------------------------------
  async update(id: string, dto: UpdateVoucherDto): Promise<VoucherListItem> {
    const row = await this.vouchers.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Voucher không tồn tại.');

    const newCode = dto.code ?? row.code;
    if (dto.code && dto.code !== row.code) {
      const conflict = await this.vouchers.findOne({ where: { code: dto.code } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('Mã voucher đã tồn tại.');
      }
    }

    const newType = dto.type ?? row.type;
    const newValue =
      dto.value !== undefined ? String(dto.value) : row.value;
    const newMax =
      dto.maxDiscount === null
        ? null
        : dto.maxDiscount !== undefined
          ? String(dto.maxDiscount)
          : row.maxDiscount;

    if (newType === VoucherType.PERCENTAGE) {
      const v = Number(newValue);
      if (!(v >= 1 && v <= 100)) {
        throw new BadRequestException(
          'Voucher phần trăm phải trong khoảng 1-100.',
        );
      }
      if (newMax === null || newMax === undefined) {
        throw new BadRequestException(
          'Voucher phần trăm bắt buộc phải có maxDiscount.',
        );
      }
    }

    const newStart = dto.startDate ? new Date(dto.startDate) : row.startDate;
    const newEnd = dto.endDate ? new Date(dto.endDate) : row.endDate;
    if (newStart.getTime() > newEnd.getTime()) {
      throw new BadRequestException('startDate phải <= endDate.');
    }

    const newTotalQty = dto.totalQuantity ?? row.totalQuantity;
    if (newTotalQty < row.usedQuantity) {
      throw new BadRequestException(
        `Không thể giảm tổng số lượng xuống dưới số đã sử dụng (${row.usedQuantity}).`,
      );
    }

    row.code = newCode;
    row.type = newType;
    row.value = newValue;
    row.maxDiscount = newMax;
    row.minOrderAmount =
      dto.minOrderAmount !== undefined
        ? String(dto.minOrderAmount)
        : row.minOrderAmount;
    row.totalQuantity = newTotalQty;
    row.perUserLimit = dto.perUserLimit ?? row.perUserLimit;
    row.startDate = newStart;
    row.endDate = newEnd;
    row.scopeType = dto.scopeType ?? row.scopeType;
    row.isActive = dto.isActive ?? row.isActive;

    const saved = await this.vouchers.save(row);

    // Re-sync Redis counter if totalQuantity changed or endDate changed.
    await this.syncRedisCounter(
      saved.code,
      saved.totalQuantity - saved.usedQuantity,
      saved.endDate,
    );

    return this.toListItem(saved);
  }

  // ---------------------------------------------------------------------------
  // Admin: delete (hard if unused, else soft)
  // ---------------------------------------------------------------------------
  async remove(id: string): Promise<{ deleted: boolean; softDeleted: boolean }> {
    const row = await this.vouchers.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Voucher không tồn tại.');
    if (row.usedQuantity === 0) {
      await this.vouchers.delete({ id });
      await this.redis.del(this.redisKey(row.code));
      return { deleted: true, softDeleted: false };
    }
    row.isActive = false;
    await this.vouchers.save(row);
    throw new BadRequestException(
      'Voucher đã phát sinh lượt sử dụng, không thể xoá vĩnh viễn. Đã tự động vô hiệu hoá.',
    );
  }

  // ---------------------------------------------------------------------------
  // Admin: list
  // ---------------------------------------------------------------------------
  async adminList(opts: {
    keyword?: string;
    status?: 'active' | 'scheduled' | 'expired' | 'all';
    page?: number;
    limit?: number;
  }): Promise<{
    items: VoucherListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
    const status = opts.status ?? 'all';
    const now = new Date();

    const qb = this.vouchers.createQueryBuilder('v');
    if (opts.keyword) {
      qb.andWhere(
        new Brackets((sub) => {
          sub.where('v.code ILIKE :kw', { kw: `%${opts.keyword}%` });
        }),
      );
    }
    if (status === 'active') {
      qb.andWhere('v.is_active = true')
        .andWhere('v.start_date <= :now', { now })
        .andWhere('v.end_date > :now', { now });
    } else if (status === 'scheduled') {
      qb.andWhere('v.start_date > :now', { now });
    } else if (status === 'expired') {
      qb.andWhere('v.end_date <= :now', { now });
    }
    qb.orderBy('v.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const items = rows.map((r) => this.toListItem(r));
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Admin: detail
  // ---------------------------------------------------------------------------
  async adminDetail(id: string): Promise<
    VoucherListItem & {
      recentUsages: Array<{
        id: string;
        userId: string;
        userEmail: string | null;
        orderId: string;
        orderCode: string | null;
        discountAmount: string;
        usedAt: Date;
      }>;
    }
  > {
    const row = await this.vouchers.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Voucher không tồn tại.');

    const usages = await this.voucherUsages
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.user', 'user')
      .leftJoinAndSelect('u.order', 'order')
      .where('u.voucher_id = :id', { id })
      .orderBy('u.used_at', 'DESC')
      .limit(10)
      .getMany();

    return {
      ...this.toListItem(row),
      recentUsages: usages.map((u) => ({
        id: u.id,
        userId: u.userId,
        userEmail: u.user?.email ?? null,
        orderId: u.orderId,
        orderCode: u.order?.orderCode ?? null,
        discountAmount: u.discountAmount,
        usedAt: u.usedAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Customer: validate
  // ---------------------------------------------------------------------------
  async validateForCheckout(
    code: string,
    subtotal: number,
    userId: string,
  ): Promise<ValidatedVoucher> {
    const row = await this.vouchers.findOne({ where: { code } });
    if (!row || !row.isActive) {
      throw new BadRequestException('Mã không hợp lệ.');
    }
    const now = new Date();
    if (row.startDate.getTime() > now.getTime() || row.endDate.getTime() <= now.getTime()) {
      throw new BadRequestException('Ngoài thời gian hiệu lực.');
    }
    if (row.usedQuantity >= row.totalQuantity) {
      throw new BadRequestException('Đã hết lượt sử dụng.');
    }
    const minOrder = Number(row.minOrderAmount);
    if (subtotal < minOrder) {
      throw new BadRequestException(
        `Không đủ giá trị đơn tối thiểu ${minOrder.toLocaleString('vi-VN')}₫.`,
      );
    }
    const usedByUser = await this.voucherUsages.count({
      where: { voucherId: row.id, userId },
    });
    if (usedByUser >= row.perUserLimit) {
      throw new BadRequestException(
        `Đã dùng ${usedByUser}/${row.perUserLimit} lần tối đa cho mã này.`,
      );
    }

    const discountAmount = this.computeDiscount(row, subtotal);
    return {
      voucherId: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      discountAmount,
      finalSubtotal: Math.max(0, subtotal - discountAmount),
    };
  }

  computeDiscount(row: Voucher, subtotal: number): number {
    const v = Number(row.value);
    if (row.type === VoucherType.PERCENTAGE) {
      const pct = (subtotal * v) / 100;
      const cap =
        row.maxDiscount !== null && row.maxDiscount !== undefined
          ? Number(row.maxDiscount)
          : Infinity;
      return Math.floor(Math.min(pct, cap));
    }
    // FIXED_AMOUNT
    return Math.floor(Math.min(v, subtotal));
  }

  // ---------------------------------------------------------------------------
  // Redeem / restore inside order transaction
  // ---------------------------------------------------------------------------
  async redeemVoucher(
    voucherId: string,
    userId: string,
    orderId: string,
    discountAmount: number,
    qr: QueryRunner,
  ): Promise<void> {
    const manager = qr.manager;
    const voucher = await manager.findOne(Voucher, { where: { id: voucherId } });
    if (!voucher) {
      throw new BadRequestException('Voucher không tồn tại.');
    }

    const key = this.redisKey(voucher.code);
    const exists = await this.redis.exists(key);
    if (!exists) {
      // Re-initialize if key expired / evicted.
      await this.syncRedisCounter(
        voucher.code,
        Math.max(0, voucher.totalQuantity - voucher.usedQuantity),
        voucher.endDate,
      );
    }

    // Atomic DECR. If negative -> over-subscribed.
    const remaining = await this.redis.decr(key);
    if (remaining < 0) {
      // Roll counter back so it represents reality.
      await this.redis.incr(key);
      throw new BadRequestException('Voucher đã hết lượt sử dụng.');
    }

    // Persist the DB side.
    await manager
      .createQueryBuilder()
      .update(Voucher)
      .set({ usedQuantity: () => 'used_quantity + 1' })
      .where('id = :id', { id: voucherId })
      .execute();

    const usage = manager.create(VoucherUsage, {
      voucherId,
      userId,
      orderId,
      discountAmount: String(discountAmount),
    });
    await manager.save(VoucherUsage, usage);
  }

  async restoreVoucher(
    voucherId: string,
    userId: string,
    qr: QueryRunner,
  ): Promise<void> {
    const manager = qr.manager;
    const voucher = await manager.findOne(Voucher, { where: { id: voucherId } });
    if (!voucher) return; // idempotent no-op

    // Idempotent Redis increment — we only bump if there is an existing usage record.
    const usage = await manager.findOne(VoucherUsage, {
      where: { voucherId, userId },
    });
    if (!usage) {
      return;
    }

    const key = this.redisKey(voucher.code);
    try {
      const exists = await this.redis.exists(key);
      if (exists) {
        await this.redis.incr(key);
      } else {
        // Rebuild counter from DB state (post-decrement).
        const remainingPostRestore = Math.max(
          0,
          voucher.totalQuantity - (voucher.usedQuantity - 1),
        );
        await this.syncRedisCounter(
          voucher.code,
          remainingPostRestore,
          voucher.endDate,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Redis incr failed while restoring voucher ${voucher.code}: ${(err as Error).message}`,
      );
    }

    await manager
      .createQueryBuilder()
      .update(Voucher)
      .set({ usedQuantity: () => 'GREATEST(used_quantity - 1, 0)' })
      .where('id = :id', { id: voucherId })
      .execute();

    await manager.delete(VoucherUsage, { id: usage.id });
  }

  // ---------------------------------------------------------------------------
  // Computed-field mapper
  // ---------------------------------------------------------------------------
  private toListItem(v: Voucher): VoucherListItem {
    const now = Date.now();
    const start = v.startDate.getTime();
    const end = v.endDate.getTime();
    const isExpired = end <= now;
    const isScheduled = start > now;
    const isActiveNow = v.isActive && !isExpired && !isScheduled;
    const progress =
      v.totalQuantity > 0 ? v.usedQuantity / v.totalQuantity : 0;
    return {
      id: v.id,
      code: v.code,
      type: v.type,
      value: v.value,
      maxDiscount: v.maxDiscount,
      minOrderAmount: v.minOrderAmount,
      totalQuantity: v.totalQuantity,
      usedQuantity: v.usedQuantity,
      perUserLimit: v.perUserLimit,
      startDate: v.startDate,
      endDate: v.endDate,
      isActive: v.isActive,
      scopeType: v.scopeType,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      isActiveNow,
      isExpired,
      isScheduled,
      progress: Number(progress.toFixed(4)),
      remaining: Math.max(0, v.totalQuantity - v.usedQuantity),
    };
  }
}
