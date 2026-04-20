import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';
import { StockReason } from '../../../common/enums/stock-reason.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { Address } from '../../../database/entities/address.entity';
import { BookImage } from '../../../database/entities/book-image.entity';
import { Book } from '../../../database/entities/book.entity';
import { CartItem } from '../../../database/entities/cart-item.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { OrderStatusLog } from '../../../database/entities/order-status-log.entity';
import { Order } from '../../../database/entities/order.entity';
import { StockLog } from '../../../database/entities/stock-log.entity';
import { User } from '../../../database/entities/user.entity';
import { EmailService } from '../../mocks/email.service';
import { ShippingService } from '../../mocks/shipping.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { VouchersService } from '../../vouchers/vouchers.service';
import { CancelOrderDto } from '../dto/cancel-order.dto';
import { CreateOrderDto } from '../dto/create-order.dto';
import {
  AdminListOrdersDto,
  ListOrdersDto,
  StaffListOrdersDto,
} from '../dto/list-query.dto';
import { ShipOrderDto } from '../dto/ship-order.dto';
import {
  UpdatePaymentStatusDto,
  UpdateStatusDto,
} from '../dto/update-status.dto';
import { OrderStateService } from './order-state.service';

function effectivePrice(book: Book): number {
  if (book.discountPrice) {
    const end = book.discountEndDate;
    if (!end || end.getTime() > Date.now()) {
      return Number(book.discountPrice);
    }
  }
  return Number(book.price);
}

export interface OrderSummary {
  id: string;
  orderCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalAmount: string;
  subtotal: string;
  shippingFee: string;
  discountAmount: string;
  itemCount: number;
  firstBookTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOrderSummary extends OrderSummary {
  userEmail: string | null;
  userFullName: string | null;
}

export interface OrderItemView {
  id: string;
  bookId: string;
  quantity: number;
  priceAtTime: string;
  bookTitleSnapshot: string;
  book: {
    id: string;
    slug: string;
    title: string;
    primaryImage: string | null;
  } | null;
}

export interface OrderStatusLogView {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: Date;
  changedBy: string | null;
  changedByName: string | null;
}

export interface OrderDetail extends OrderSummary {
  userId: string;
  user?: { id: string; email: string; fullName: string } | null;
  addressSnapshot: {
    id: string;
    recipientName: string;
    phone: string;
    province: string;
    district: string;
    ward: string;
    streetAddress: string;
  } | null;
  shippingMethod: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  note: string | null;
  items: OrderItemView[];
  statusLogs: OrderStatusLogView[];
  voucherId?: string | null;
  paymentUrl?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(OrderStatusLog)
    private readonly orderStatusLogs: Repository<OrderStatusLog>,
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
    @InjectRepository(BookImage)
    private readonly bookImages: Repository<BookImage>,
    @InjectRepository(Address)
    private readonly addresses: Repository<Address>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(StockLog)
    private readonly stockLogs: Repository<StockLog>,
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
    private readonly shippingService: ShippingService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
    private readonly vouchersService: VouchersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  private async notify(
    userId: string,
    payload: {
      type: string;
      title: string;
      content: string;
      link?: string | null;
    },
  ): Promise<void> {
    try {
      await this.notifications.saveAndEmit(userId, payload);
    } catch (err) {
      this.logger.warn(
        `Notification emit failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Create order (checkout)
  // ---------------------------------------------------------------------------
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderDetail> {
    if (
      dto.paymentMethod !== PaymentMethod.COD &&
      dto.paymentMethod !== PaymentMethod.VNPAY
    ) {
      throw new BadRequestException(
        'Phương thức thanh toán sẽ ra mắt trong phase 2.',
      );
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');

    const address = await this.addresses.findOne({
      where: { id: dto.addressId },
    });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Địa chỉ giao hàng không hợp lệ.');
    }

    // Fetch ShippingService quote outside tx; the mock is deterministic.
    const quote = await this.shippingService.calculateFee(address, 0);

    const isVnpay = dto.paymentMethod === PaymentMethod.VNPAY;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let createdOrderId: string;
    try {
      const manager = qr.manager;
      const cart = await manager.find(CartItem, {
        where: { userId },
        relations: { book: true },
        order: { createdAt: 'ASC' },
      });
      if (cart.length === 0) {
        throw new BadRequestException('Giỏ hàng đang trống.');
      }

      // Lock rows + validate stock.
      const bookIds = cart.map((c) => c.bookId);
      const lockedBooks = await manager
        .createQueryBuilder(Book, 'b')
        .setLock('pessimistic_write')
        .where('b.id IN (:...ids)', { ids: bookIds })
        .getMany();
      const byId = new Map(lockedBooks.map((b) => [b.id, b] as const));

      const problems: string[] = [];
      for (const c of cart) {
        const b = byId.get(c.bookId);
        if (!b) {
          problems.push(`Sách ${c.bookId} không tồn tại.`);
          continue;
        }
        if (b.status !== 'ACTIVE') {
          problems.push(`Sách "${b.title}" không còn được bán.`);
          continue;
        }
        if (b.stockQuantity < c.quantity) {
          problems.push(
            `Sách "${b.title}" chỉ còn ${b.stockQuantity} quyển (bạn đặt ${c.quantity}).`,
          );
        }
      }
      if (problems.length > 0) {
        throw new BadRequestException(
          `Không thể đặt hàng: ${problems.join(' ')}`,
        );
      }

      // Compute subtotal.
      let subtotal = 0;
      for (const c of cart) {
        const b = byId.get(c.bookId)!;
        subtotal += effectivePrice(b) * c.quantity;
      }

      // Apply voucher if requested.
      let voucherId: string | null = null;
      let discountAmount = 0;
      if (dto.voucherCode) {
        const validated = await this.vouchersService.validateForCheckout(
          dto.voucherCode,
          subtotal,
          userId,
        );
        voucherId = validated.voucherId;
        discountAmount = validated.discountAmount;
      }

      const shippingFee = quote.fee;
      const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

      // Generate orderCode with a race-safe MAX()+1 pattern inside tx.
      const orderCode = await this.generateOrderCode(manager);

      // Create the order.
      const order = manager.create(Order, {
        orderCode,
        userId,
        addressId: address.id,
        shippingFee: String(shippingFee),
        shippingMethod: 'Tiêu chuẩn',
        voucherId,
        discountAmount: String(discountAmount),
        subtotal: String(subtotal),
        totalAmount: String(totalAmount),
        paymentMethod: dto.paymentMethod,
        paymentStatus: PaymentStatus.UNPAID,
        // COD auto-confirms; VNPAY waits for gateway success.
        status: isVnpay ? OrderStatus.PENDING : OrderStatus.CONFIRMED,
        trackingNumber: null,
        carrier: quote.carrier,
        note: dto.note ?? null,
      });
      const savedOrder = await manager.save(Order, order);

      // Create order_items snapshot.
      const itemsToSave: OrderItem[] = cart.map((c) => {
        const b = byId.get(c.bookId)!;
        return manager.create(OrderItem, {
          orderId: savedOrder.id,
          bookId: b.id,
          quantity: c.quantity,
          priceAtTime: String(effectivePrice(b)),
          bookTitleSnapshot: b.title,
          isReviewed: false,
        });
      });
      await manager.save(OrderItem, itemsToSave);

      // Reserve stock immediately for both COD and VNPAY — VNPAY restores on cancel/timeout.
      for (const c of cart) {
        const b = byId.get(c.bookId)!;
        const newQty = b.stockQuantity - c.quantity;
        b.stockQuantity = newQty;
        await manager.save(Book, b);
        const log = manager.create(StockLog, {
          bookId: b.id,
          changeAmount: -c.quantity,
          newQuantity: newQty,
          reason: StockReason.SALE,
          orderId: savedOrder.id,
          createdBy: userId,
          note: `Bán theo đơn ${orderCode}.`,
        });
        await manager.save(StockLog, log);
      }

      // Status log.
      const initialLog = manager.create(OrderStatusLog, {
        orderId: savedOrder.id,
        fromStatus: null,
        toStatus: isVnpay ? OrderStatus.PENDING : OrderStatus.CONFIRMED,
        changedBy: userId,
        note: isVnpay
          ? 'Tạo đơn VNPAY, chờ thanh toán.'
          : 'Đặt đơn COD, tự động xác nhận.',
      });
      await manager.save(OrderStatusLog, initialLog);

      // Redeem voucher inside the same transaction (atomic).
      if (voucherId) {
        await this.vouchersService.redeemVoucher(
          voucherId,
          userId,
          savedOrder.id,
          discountAmount,
          qr,
        );
      }

      // Clear cart.
      await manager.delete(CartItem, { userId });

      createdOrderId = savedOrder.id;
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Post-commit side effects.
    const createdOrder = await this.orders.findOne({
      where: { id: createdOrderId },
    });

    if (isVnpay) {
      // TODO phase 2 auto-cancel PENDING VNPAY after 15 minutes
      const detail = await this.getById(createdOrderId, { asAdmin: false });
      return {
        ...detail,
        paymentUrl: this.paymentsService.buildPaymentUrl(createdOrderId),
      };
    }

    try {
      if (createdOrder) {
        await this.emailService.sendOrderConfirmation(
          user.email,
          createdOrder.orderCode,
        );
      }
    } catch {
      // Email is a mock; failure should not break the checkout response.
    }

    if (createdOrder) {
      await this.notify(userId, {
        type: 'ORDER_CONFIRMED',
        title: `Đơn ${createdOrder.orderCode} đã xác nhận`,
        content: `Cảm ơn bạn đã đặt hàng. Tổng ${createdOrder.totalAmount}đ.`,
        link: `/orders/${createdOrder.id}`,
      });
    }

    return this.getById(createdOrderId, { asAdmin: false });
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------
  async listForCustomer(
    userId: string,
    dto: ListOrdersDto,
  ): Promise<{
    items: OrderSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(dto.limit) || 20));

    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.userId = :userId', { userId });
    if (dto.status) qb.andWhere('o.status = :status', { status: dto.status });
    qb.orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const items = await this.enrichSummaries(rows);
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async adminList(dto: AdminListOrdersDto): Promise<{
    items: AdminOrderSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(dto.limit) || 20));

    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u');
    if (dto.status) qb.andWhere('o.status = :status', { status: dto.status });
    if (dto.paymentStatus)
      qb.andWhere('o.paymentStatus = :ps', { ps: dto.paymentStatus });
    if (dto.from) qb.andWhere('o.createdAt >= :from', { from: dto.from });
    if (dto.to) qb.andWhere('o.createdAt <= :to', { to: dto.to });
    if (dto.keyword) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('o.orderCode ILIKE :kw', { kw: `%${dto.keyword}%` })
            .orWhere('u.email ILIKE :kw', { kw: `%${dto.keyword}%` })
            .orWhere('u.fullName ILIKE :kw', { kw: `%${dto.keyword}%` });
        }),
      );
    }
    qb.orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const summaries = await this.enrichSummaries(rows);
    const byId = new Map(summaries.map((s) => [s.id, s] as const));
    const items: AdminOrderSummary[] = rows.map((r) => ({
      ...byId.get(r.id)!,
      userEmail: r.user?.email ?? null,
      userFullName: r.user?.fullName ?? null,
    }));
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async staffList(dto: StaffListOrdersDto): Promise<{
    items: AdminOrderSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(dto.limit) || 20));

    const status = dto.status ?? OrderStatus.CONFIRMED;
    if (
      status === OrderStatus.DELIVERED ||
      status === OrderStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Nhân viên kho không truy cập trạng thái đã giao/hoàn thành.',
      );
    }

    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.status = :status', { status })
      .orderBy('o.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const summaries = await this.enrichSummaries(rows);
    const byId = new Map(summaries.map((s) => [s.id, s] as const));
    const items: AdminOrderSummary[] = rows.map((r) => ({
      ...byId.get(r.id)!,
      userEmail: r.user?.email ?? null,
      userFullName: r.user?.fullName ?? null,
    }));
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------
  async getForCustomer(
    userId: string,
    orderId: string,
  ): Promise<OrderDetail> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
    if (order.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem đơn này.');
    }
    return this.getById(orderId, { asAdmin: false });
  }

  async getForAdmin(orderId: string): Promise<OrderDetail> {
    return this.getById(orderId, { asAdmin: true });
  }

  // ---------------------------------------------------------------------------
  // Customer cancel
  // ---------------------------------------------------------------------------
  async cancelByCustomer(
    userId: string,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<OrderDetail> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const manager = qr.manager;
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
      if (order.userId !== userId) {
        throw new ForbiddenException('Bạn không có quyền huỷ đơn này.');
      }

      this.orderState.assertCanTransition(
        order.status,
        OrderStatus.CANCELLED,
        UserRole.CUSTOMER,
      );

      await this.restoreStockForOrder(manager, order, userId, dto.reason);

      if (order.voucherId) {
        await this.vouchersService.restoreVoucher(order.voucherId, order.userId, qr);
      }

      const previousStatus = order.status;
      order.status = OrderStatus.CANCELLED;
      if (order.paymentStatus === PaymentStatus.PAID) {
        order.paymentStatus = PaymentStatus.REFUND_PENDING;
      }
      await manager.save(Order, order);

      const log = manager.create(OrderStatusLog, {
        orderId: order.id,
        fromStatus: previousStatus,
        toStatus: OrderStatus.CANCELLED,
        changedBy: userId,
        note: dto.reason ?? 'Khách hàng huỷ đơn.',
      });
      await manager.save(OrderStatusLog, log);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Post-commit notification.
    const cancelled = await this.orders.findOne({ where: { id: orderId } });
    if (cancelled) {
      await this.notify(userId, {
        type: 'ORDER_CANCELLED',
        title: `Đơn ${cancelled.orderCode} đã huỷ`,
        content: dto.reason
          ? `Bạn đã huỷ đơn với lý do: ${dto.reason}.`
          : 'Bạn đã huỷ đơn hàng thành công.',
        link: `/orders/${cancelled.id}`,
      });
    }

    return this.getById(orderId, { asAdmin: false });
  }

  // ---------------------------------------------------------------------------
  // Staff: mark as packaged (CONFIRMED -> PROCESSING)
  // ---------------------------------------------------------------------------
  async staffPack(staffId: string, orderId: string): Promise<OrderDetail> {
    const orderCode = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');

      this.orderState.assertCanTransition(
        order.status,
        OrderStatus.PROCESSING,
        UserRole.WAREHOUSE_STAFF,
      );

      const previousStatus = order.status;
      order.status = OrderStatus.PROCESSING;
      await manager.save(Order, order);

      const log = manager.create(OrderStatusLog, {
        orderId: order.id,
        fromStatus: previousStatus,
        toStatus: OrderStatus.PROCESSING,
        changedBy: staffId,
        note: 'Đã đóng gói xong',
      });
      await manager.save(OrderStatusLog, log);
      return order.orderCode;
    });

    // Post-commit side effect.
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { user: true },
    });
    if (order?.user) {
      try {
        await this.emailService.sendOrderStatusUpdate(
          order.user.email,
          orderCode,
          'PROCESSING',
        );
      } catch {
        // best-effort
      }
      await this.notify(order.userId, {
        type: 'ORDER_PROCESSING',
        title: `Đơn ${order.orderCode} đang đóng gói`,
        content: `Đội ngũ kho đang chuẩn bị đơn hàng của bạn.`,
        link: `/orders/${order.id}`,
      });
    }

    return this.getById(orderId, { asAdmin: true });
  }

  // ---------------------------------------------------------------------------
  // Staff: mark as shipped (PROCESSING -> SHIPPING)
  // ---------------------------------------------------------------------------
  async staffShip(
    staffId: string,
    orderId: string,
    dto: ShipOrderDto,
  ): Promise<OrderDetail> {
    const carrier = (dto.carrier ?? '').trim();
    const trackingNumber = (dto.trackingNumber ?? '').trim();
    if (!carrier) {
      throw new BadRequestException('Đơn vị vận chuyển không được để trống.');
    }
    if (!trackingNumber) {
      throw new BadRequestException('Mã vận đơn không được để trống.');
    }

    const orderCode = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
      if (order.status !== OrderStatus.PROCESSING) {
        throw new BadRequestException(
          `Chỉ bàn giao đơn đang ở trạng thái PROCESSING (hiện tại: ${order.status}).`,
        );
      }

      this.orderState.assertCanTransition(
        order.status,
        OrderStatus.SHIPPING,
        UserRole.WAREHOUSE_STAFF,
      );

      const previousStatus = order.status;
      order.status = OrderStatus.SHIPPING;
      order.carrier = carrier;
      order.trackingNumber = trackingNumber;
      await manager.save(Order, order);

      const log = manager.create(OrderStatusLog, {
        orderId: order.id,
        fromStatus: previousStatus,
        toStatus: OrderStatus.SHIPPING,
        changedBy: staffId,
        note: `Bàn giao ${carrier}: ${trackingNumber}`,
      });
      await manager.save(OrderStatusLog, log);
      return order.orderCode;
    });

    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { user: true },
    });
    if (order?.user) {
      try {
        await this.emailService.sendOrderStatusUpdate(
          order.user.email,
          orderCode,
          'SHIPPING',
        );
      } catch {
        // best-effort
      }
      await this.notify(order.userId, {
        type: 'ORDER_SHIPPING',
        title: `Đơn ${order.orderCode} đang giao`,
        content: `Mã vận đơn ${trackingNumber} · ĐVVC ${carrier}`,
        link: `/orders/${order.id}`,
      });
    }

    return this.getById(orderId, { asAdmin: true });
  }

  // ---------------------------------------------------------------------------
  // Admin: update status
  // ---------------------------------------------------------------------------
  async adminUpdateStatus(
    adminId: string,
    orderId: string,
    dto: UpdateStatusDto,
  ): Promise<OrderDetail> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let orderCode: string;
    try {
      const manager = qr.manager;
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Đơn đã bị huỷ, không thể thay đổi.');
      }

      this.orderState.assertCanTransition(
        order.status,
        dto.toStatus,
        UserRole.ADMIN,
      );

      const previousStatus = order.status;

      if (dto.toStatus === OrderStatus.CANCELLED) {
        await this.restoreStockForOrder(manager, order, adminId, dto.note);
        if (order.voucherId) {
          await this.vouchersService.restoreVoucher(order.voucherId, order.userId, qr);
        }
        if (order.paymentStatus === PaymentStatus.PAID) {
          order.paymentStatus = PaymentStatus.REFUND_PENDING;
        }
      }

      order.status = dto.toStatus;
      await manager.save(Order, order);

      const log = manager.create(OrderStatusLog, {
        orderId: order.id,
        fromStatus: previousStatus,
        toStatus: dto.toStatus,
        changedBy: adminId,
        note: dto.note ?? null,
      });
      await manager.save(OrderStatusLog, log);
      orderCode = order.orderCode;
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Post-commit email for visible transitions.
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { user: true },
    });
    if (order?.user) {
      try {
        await this.emailService.sendOrderStatusUpdate(
          order.user.email,
          orderCode,
          dto.toStatus,
        );
      } catch {
        // best-effort
      }
      if (dto.toStatus === OrderStatus.CANCELLED) {
        await this.notify(order.userId, {
          type: 'ORDER_CANCELLED',
          title: `Đơn ${order.orderCode} đã bị huỷ`,
          content:
            dto.note ??
            'Quản trị viên đã huỷ đơn hàng của bạn. Vui lòng liên hệ CSKH nếu cần hỗ trợ.',
          link: `/orders/${order.id}`,
        });
      } else {
        await this.notify(order.userId, {
          type: 'ORDER_STATUS_UPDATED',
          title: `Đơn ${order.orderCode} chuyển sang ${dto.toStatus}`,
          content:
            dto.note ?? `Trạng thái đơn hàng được cập nhật: ${dto.toStatus}.`,
          link: `/orders/${order.id}`,
        });
      }
    }

    return this.getById(orderId, { asAdmin: true });
  }

  // ---------------------------------------------------------------------------
  // Admin: mark COD as paid upon delivery
  // ---------------------------------------------------------------------------
  async adminUpdatePayment(
    adminId: string,
    orderId: string,
    dto: UpdatePaymentStatusDto,
  ): Promise<OrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
      if (dto.paymentStatus !== PaymentStatus.PAID) {
        throw new BadRequestException(
          'MVP chỉ hỗ trợ chuyển sang PAID để ghi nhận thu tiền COD.',
        );
      }
      if (order.paymentMethod !== PaymentMethod.COD) {
        throw new BadRequestException(
          'Chỉ đơn COD mới được đánh dấu thu tiền thủ công.',
        );
      }
      if (order.paymentStatus === PaymentStatus.PAID) {
        throw new BadRequestException('Đơn đã ở trạng thái đã thanh toán.');
      }
      order.paymentStatus = PaymentStatus.PAID;
      await manager.save(Order, order);

      const log = manager.create(OrderStatusLog, {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        changedBy: adminId,
        note: 'Đã thu tiền khi giao hàng.',
      });
      await manager.save(OrderStatusLog, log);
    });

    return this.getById(orderId, { asAdmin: true });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async generateOrderCode(manager: EntityManager): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ORD${year}`;
    const row = await manager
      .createQueryBuilder(Order, 'o')
      .select('o.order_code', 'order_code')
      .where('o.order_code LIKE :p', { p: `${prefix}%` })
      .orderBy('o.order_code', 'DESC')
      .setLock('pessimistic_write')
      .limit(1)
      .getRawOne<{ order_code: string }>();

    let next = 1;
    if (row?.order_code) {
      const seqStr = row.order_code.substring(prefix.length);
      const parsed = Number.parseInt(seqStr, 10);
      if (Number.isFinite(parsed)) next = parsed + 1;
    }
    return `${prefix}${next.toString().padStart(6, '0')}`;
  }

  private async restoreStockForOrder(
    manager: EntityManager,
    order: Order,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    const items = await manager.find(OrderItem, {
      where: { orderId: order.id },
    });
    if (items.length === 0) return;

    const bookIds = items.map((i) => i.bookId);
    const books = await manager
      .createQueryBuilder(Book, 'b')
      .setLock('pessimistic_write')
      .where('b.id IN (:...ids)', { ids: bookIds })
      .getMany();
    const byId = new Map(books.map((b) => [b.id, b] as const));

    for (const it of items) {
      const b = byId.get(it.bookId);
      if (!b) continue;
      const newQty = b.stockQuantity + it.quantity;
      b.stockQuantity = newQty;
      await manager.save(Book, b);
      const log = manager.create(StockLog, {
        bookId: b.id,
        changeAmount: it.quantity,
        newQuantity: newQty,
        reason: StockReason.CANCEL_RESTORE,
        orderId: order.id,
        createdBy: actorId,
        note: reason
          ? `Hoàn kho do huỷ đơn ${order.orderCode}: ${reason}`
          : `Hoàn kho do huỷ đơn ${order.orderCode}.`,
      });
      await manager.save(StockLog, log);
    }
  }

  private async enrichSummaries(rows: Order[]): Promise<OrderSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const items = await this.orderItems
      .createQueryBuilder('oi')
      .where('oi.order_id IN (:...ids)', { ids })
      .orderBy('oi.order_id', 'ASC')
      .getMany();

    const byOrder = new Map<string, OrderItem[]>();
    for (const it of items) {
      if (!byOrder.has(it.orderId)) byOrder.set(it.orderId, []);
      byOrder.get(it.orderId)!.push(it);
    }

    return rows.map((o) => {
      const its = byOrder.get(o.id) ?? [];
      const itemCount = its.reduce((acc, it) => acc + it.quantity, 0);
      const firstBookTitle = its[0]?.bookTitleSnapshot ?? null;
      return {
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        shippingFee: o.shippingFee,
        discountAmount: o.discountAmount,
        itemCount,
        firstBookTitle,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    });
  }

  private async getById(
    orderId: string,
    _opts: { asAdmin: boolean },
  ): Promise<OrderDetail> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { user: true, address: true },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');

    const items = await this.orderItems.find({
      where: { orderId: order.id },
      relations: { book: true },
      order: { bookTitleSnapshot: 'ASC' },
    });

    const bookIds = items
      .map((i) => i.bookId)
      .filter((id): id is string => !!id);
    const primaryByBook = new Map<string, string>();
    if (bookIds.length > 0) {
      const images = await this.bookImages
        .createQueryBuilder('i')
        .where('i.book_id IN (:...ids)', { ids: bookIds })
        .orderBy('i.is_primary', 'DESC')
        .addOrderBy('i.display_order', 'ASC')
        .getMany();
      for (const img of images) {
        if (!primaryByBook.has(img.bookId)) {
          primaryByBook.set(img.bookId, img.imageUrl);
        }
      }
    }

    const logs = await this.orderStatusLogs.find({
      where: { orderId: order.id },
      relations: { changedByUser: true },
      order: { createdAt: 'ASC' },
    });

    const itemCount = items.reduce((acc, it) => acc + it.quantity, 0);
    const firstBookTitle = items[0]?.bookTitleSnapshot ?? null;

    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      note: order.note,
      itemCount,
      firstBookTitle,
      voucherId: order.voucherId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      user: order.user
        ? {
            id: order.user.id,
            email: order.user.email,
            fullName: order.user.fullName,
          }
        : null,
      addressSnapshot: order.address
        ? {
            id: order.address.id,
            recipientName: order.address.recipientName,
            phone: order.address.phone,
            province: order.address.province,
            district: order.address.district,
            ward: order.address.ward,
            streetAddress: order.address.streetAddress,
          }
        : null,
      items: items.map((it) => ({
        id: it.id,
        bookId: it.bookId,
        quantity: it.quantity,
        priceAtTime: it.priceAtTime,
        bookTitleSnapshot: it.bookTitleSnapshot,
        book: it.book
          ? {
              id: it.book.id,
              slug: it.book.slug,
              title: it.book.title,
              primaryImage: primaryByBook.get(it.book.id) ?? null,
            }
          : null,
      })),
      statusLogs: logs.map((l) => ({
        id: l.id,
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        note: l.note,
        createdAt: l.createdAt,
        changedBy: l.changedBy,
        changedByName: l.changedByUser?.fullName ?? null,
      })),
    };
  }
}
