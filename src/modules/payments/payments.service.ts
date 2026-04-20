import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { PaymentTxStatus } from '../../common/enums/payment-tx-status.enum';
import { StockReason } from '../../common/enums/stock-reason.enum';
import { Book } from '../../database/entities/book.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusLog } from '../../database/entities/order-status-log.entity';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { StockLog } from '../../database/entities/stock-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { VouchersService } from '../vouchers/vouchers.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly vouchers: VouchersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Signature helpers
  // ---------------------------------------------------------------------------
  private secret(): string {
    const s = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!s) throw new Error('JWT_ACCESS_SECRET is not configured.');
    return s;
  }

  signOrderId(orderId: string): string {
    return createHmac('sha256', this.secret()).update(orderId).digest('hex');
  }

  verifySig(orderId: string, sig: string): boolean {
    if (!sig || typeof sig !== 'string') return false;
    const expected = this.signOrderId(orderId);
    if (expected.length !== sig.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
    } catch {
      return false;
    }
  }

  buildPaymentUrl(orderId: string): string {
    return `/api/payments/vnpay/sim?orderId=${orderId}&sig=${this.signOrderId(orderId)}`;
  }

  // ---------------------------------------------------------------------------
  // Sim page
  // ---------------------------------------------------------------------------
  async getSimPage(orderId: string, sig: string): Promise<string> {
    if (!this.verifySig(orderId, sig)) {
      throw new UnauthorizedException('Chữ ký không hợp lệ.');
    }
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
    if (order.paymentMethod !== PaymentMethod.VNPAY) {
      throw new BadRequestException('Đơn không sử dụng VNPAY.');
    }

    const amount = Number(order.totalAmount).toLocaleString('vi-VN');
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Cổng thanh toán VNPAY (giả lập)</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f4f6fb;margin:0;padding:40px;}
  .card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,0.08);overflow:hidden;}
  .hdr{background:#0057a0;color:#fff;padding:20px 24px;}
  .hdr h1{margin:0;font-size:20px;letter-spacing:0.4px;}
  .body{padding:24px;}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e2e5ec;font-size:14px;}
  .row:last-child{border-bottom:none;font-weight:600;}
  .actions{display:flex;gap:12px;margin-top:20px;}
  button{flex:1;padding:12px 14px;border:none;border-radius:8px;font-size:15px;cursor:pointer;}
  .ok{background:#06a664;color:#fff;}
  .cancel{background:#dde2eb;color:#1a1a1a;}
  .note{margin-top:16px;color:#6a7383;font-size:12px;text-align:center;}
</style>
</head>
<body>
<div class="card">
  <div class="hdr"><h1>VNPAY — Giả lập thanh toán</h1></div>
  <div class="body">
    <div class="row"><span>Mã đơn</span><span>${order.orderCode}</span></div>
    <div class="row"><span>Phương thức</span><span>VNPAY</span></div>
    <div class="row"><span>Tổng thanh toán</span><span>${amount}₫</span></div>
    <div class="actions">
      <button class="ok" onclick="submitAction('success')">Xác nhận thanh toán</button>
      <button class="cancel" onclick="submitAction('cancel')">Huỷ</button>
    </div>
    <p class="note">Đây là cổng giả lập nội bộ. Không có giao dịch thật phát sinh.</p>
  </div>
</div>
<script>
const orderId = ${JSON.stringify(orderId)};
const sig = ${JSON.stringify(sig)};
async function submitAction(kind){
  const url = kind === 'success'
    ? '/api/payments/vnpay/callback-success'
    : '/api/payments/vnpay/callback-cancel';
  const res = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ orderId, sig }),
  });
  if(res.ok){
    const json = await res.json();
    const redirect = json?.data?.redirect || '/';
    window.location.href = redirect;
  } else {
    const txt = await res.text();
    alert('Lỗi: ' + txt);
  }
}
</script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Success callback
  // ---------------------------------------------------------------------------
  async handleSuccess(orderId: string, sig: string): Promise<{ redirect: string }> {
    if (!this.verifySig(orderId, sig)) {
      throw new UnauthorizedException('Chữ ký không hợp lệ.');
    }

    const { userId, orderCode, totalAmount } = await this.dataSource.transaction(
      async (manager) => {
        const order = await manager.findOne(Order, { where: { id: orderId } });
        if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
        if (order.paymentMethod !== PaymentMethod.VNPAY) {
          throw new BadRequestException('Đơn không sử dụng VNPAY.');
        }
        if (order.status !== OrderStatus.PENDING) {
          throw new BadRequestException(
            `Đơn không ở trạng thái chờ thanh toán (hiện tại ${order.status}).`,
          );
        }

        const prevStatus = order.status;
        order.status = OrderStatus.CONFIRMED;
        order.paymentStatus = PaymentStatus.PAID;
        await manager.save(Order, order);

        const log = manager.create(OrderStatusLog, {
          orderId: order.id,
          fromStatus: prevStatus,
          toStatus: OrderStatus.CONFIRMED,
          changedBy: order.userId,
          note: 'Thanh toán VNPAY thành công (giả lập).',
        });
        await manager.save(OrderStatusLog, log);

        const txId = 'VNPAY-SIM-' + Date.now();
        const gatewayResponse = JSON.stringify({
          gateway: 'VNPAY_SIM',
          status: 'SUCCESS',
          orderCode: order.orderCode,
          amount: order.totalAmount,
          paidAt: new Date().toISOString(),
        });

        await this.upsertPayment(manager, {
          orderId: order.id,
          amount: order.totalAmount,
          method: PaymentMethod.VNPAY,
          status: PaymentTxStatus.SUCCESS,
          transactionId: txId,
          gatewayResponse,
        });

        return {
          userId: order.userId,
          orderCode: order.orderCode,
          totalAmount: order.totalAmount,
        };
      },
    );

    // Post-commit notification.
    try {
      await this.notifications.saveAndEmit(userId, {
        type: 'ORDER_CONFIRMED',
        title: `Đơn ${orderCode} đã xác nhận`,
        content: `Thanh toán VNPAY thành công. Tổng ${totalAmount}đ.`,
        link: `/orders/${orderId}`,
      });
    } catch (err) {
      this.logger.warn(
        `Notification emit failed for VNPAY success ${orderId}: ${(err as Error).message}`,
      );
    }

    return { redirect: `/orders/${orderId}?paid=1` };
  }

  // ---------------------------------------------------------------------------
  // Cancel callback
  // ---------------------------------------------------------------------------
  async handleCancel(orderId: string, sig: string): Promise<{ redirect: string }> {
    if (!this.verifySig(orderId, sig)) {
      throw new UnauthorizedException('Chữ ký không hợp lệ.');
    }

    const { userId, orderCode } = await this.dataSource.transaction(
      async (manager) => {
        const qr = manager.queryRunner!;
        const order = await manager.findOne(Order, { where: { id: orderId } });
        if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
        if (order.paymentMethod !== PaymentMethod.VNPAY) {
          throw new BadRequestException('Đơn không sử dụng VNPAY.');
        }
        if (order.status !== OrderStatus.PENDING) {
          throw new BadRequestException(
            `Đơn không ở trạng thái chờ thanh toán (hiện tại ${order.status}).`,
          );
        }

        // Restore stock.
        await this.restoreStockForOrder(manager, order);

        // Restore voucher if applied.
        if (order.voucherId) {
          await this.vouchers.restoreVoucher(order.voucherId, order.userId, qr);
          order.voucherId = null;
          order.discountAmount = '0';
        }

        const prevStatus = order.status;
        order.status = OrderStatus.CANCELLED;
        await manager.save(Order, order);

        const log = manager.create(OrderStatusLog, {
          orderId: order.id,
          fromStatus: prevStatus,
          toStatus: OrderStatus.CANCELLED,
          changedBy: order.userId,
          note: 'Huỷ thanh toán VNPAY.',
        });
        await manager.save(OrderStatusLog, log);

        await this.upsertPayment(manager, {
          orderId: order.id,
          amount: order.totalAmount,
          method: PaymentMethod.VNPAY,
          status: PaymentTxStatus.FAILED,
          transactionId: null,
          gatewayResponse: JSON.stringify({
            gateway: 'VNPAY_SIM',
            status: 'CANCELLED',
            cancelledAt: new Date().toISOString(),
          }),
        });

        return { userId: order.userId, orderCode: order.orderCode };
      },
    );

    try {
      await this.notifications.saveAndEmit(userId, {
        type: 'ORDER_CANCELLED',
        title: `Đơn ${orderCode} đã huỷ`,
        content: 'Bạn đã huỷ thanh toán VNPAY. Đơn hàng đã được huỷ và hoàn kho.',
        link: `/orders/${orderId}`,
      });
    } catch (err) {
      this.logger.warn(
        `Notification emit failed for VNPAY cancel ${orderId}: ${(err as Error).message}`,
      );
    }

    return { redirect: `/orders/${orderId}?cancelled=1` };
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------
  private async upsertPayment(
    manager: EntityManager,
    opts: {
      orderId: string;
      amount: string;
      method: PaymentMethod;
      status: PaymentTxStatus;
      transactionId: string | null;
      gatewayResponse: string;
    },
  ): Promise<void> {
    const existing = await manager.findOne(Payment, {
      where: { orderId: opts.orderId },
    });
    if (existing) {
      existing.status = opts.status;
      existing.transactionId = opts.transactionId;
      existing.amount = opts.amount;
      existing.paymentMethod = opts.method;
      existing.gatewayResponse = opts.gatewayResponse;
      await manager.save(Payment, existing);
    } else {
      const row = manager.create(Payment, {
        orderId: opts.orderId,
        amount: opts.amount,
        paymentMethod: opts.method,
        status: opts.status,
        transactionId: opts.transactionId,
        gatewayResponse: opts.gatewayResponse,
      });
      await manager.save(Payment, row);
    }
  }

  private async restoreStockForOrder(
    manager: EntityManager,
    order: Order,
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
        createdBy: order.userId,
        note: `Huỷ thanh toán VNPAY đơn ${order.orderCode}.`,
      });
      await manager.save(StockLog, log);
    }
  }
}
