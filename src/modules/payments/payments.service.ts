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
import * as QRCode from 'qrcode';
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
    const merchantName = 'BOOKSTORE.VN';
    const transactionRef = `BS${order.orderCode.replace(/[^A-Z0-9]/gi, '')}${Date.now()
      .toString()
      .slice(-4)}`;
    const bankList = [
      { code: 'VCB', name: 'Vietcombank' },
      { code: 'TCB', name: 'Techcombank' },
      { code: 'BIDV', name: 'BIDV' },
      { code: 'MB', name: 'MB Bank' },
      { code: 'VTB', name: 'VietinBank' },
      { code: 'ACB', name: 'ACB' },
      { code: 'TPB', name: 'TPBank' },
      { code: 'STB', name: 'Sacombank' },
      { code: 'VPB', name: 'VPBank' },
      { code: 'AGR', name: 'Agribank' },
    ];

    // QR payload — when the customer scans, the URL would auto-fire the success callback.
    // (In the sim, the user just clicks the button below — this is for visual realism.)
    const qrPayload = JSON.stringify({
      gateway: 'VNPAY_SIM',
      merchant: merchantName,
      orderCode: order.orderCode,
      amount: Number(order.totalAmount),
      txnRef: transactionRef,
      ts: Date.now(),
    });
    let qrSvg = '';
    try {
      qrSvg = await QRCode.toString(qrPayload, {
        type: 'svg',
        margin: 1,
        width: 240,
        color: { dark: '#0a3a76', light: '#ffffff' },
      });
      // Strip the XML decl so we can embed inline.
      qrSvg = qrSvg.replace(/<\?xml[^?]*\?>/, '');
    } catch (err) {
      this.logger.warn(`QR gen failed: ${(err as Error).message}`);
      qrSvg = '<div style="padding:60px;color:#999;">QR không khả dụng</div>';
    }

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>VNPAY — Cổng thanh toán điện tử</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#eef3f9;margin:0;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  .topbar{background:linear-gradient(180deg,#003e7c 0%,#0a3a76 100%);color:#fff;padding:14px 32px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 6px rgba(0,0,0,.08)}
  .brand{display:flex;align-items:center;gap:12px}
  .brand-mark{background:#fff;color:#003e7c;font-weight:800;letter-spacing:1px;padding:6px 12px;border-radius:6px;font-size:18px}
  .brand-tag{font-size:12px;opacity:.85}
  .timer{display:flex;align-items:center;gap:8px;font-size:13px}
  .timer-pill{background:rgba(255,255,255,.15);padding:5px 12px;border-radius:999px;font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:.5px}
  .wrap{max-width:980px;margin:28px auto;padding:0 16px;display:grid;grid-template-columns:340px 1fr;gap:20px}
  @media (max-width:780px){.wrap{grid-template-columns:1fr}}
  .panel{background:#fff;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden}
  .panel-h{padding:14px 18px;background:#f5f8fc;border-bottom:1px solid #e3e8ef;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#5a6a82}
  .panel-b{padding:18px}
  .merchant{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .merchant-logo{width:44px;height:44px;border-radius:8px;background:#c8102e;color:#fff;display:grid;place-items:center;font-weight:800;font-size:14px}
  .merchant-name{font-weight:700;font-size:15px}
  .merchant-sub{font-size:11px;color:#7a869a}
  .kv{display:flex;justify-content:space-between;padding:9px 0;font-size:13px;border-bottom:1px dashed #e3e8ef}
  .kv:last-child{border-bottom:none;padding-bottom:0}
  .kv-l{color:#5a6a82}
  .kv-r{color:#1a1a1a;font-weight:500}
  .amount-row{padding:14px;background:#fef2f3;border:1px solid #fcd2d6;border-radius:8px;margin-top:14px;display:flex;justify-content:space-between;align-items:baseline}
  .amount-row .lbl{color:#5a6a82;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  .amount-row .val{font-size:22px;font-weight:800;color:#c8102e}
  .tabs{display:flex;gap:0;border-bottom:1px solid #e3e8ef;background:#fafbfd}
  .tab{flex:1;padding:14px 8px;text-align:center;font-size:12px;cursor:pointer;color:#5a6a82;border-bottom:3px solid transparent;font-weight:600;line-height:1.3}
  .tab.active{color:#003e7c;border-bottom-color:#003e7c;background:#fff}
  .tab .icon{display:block;font-size:22px;margin-bottom:4px}
  .tab[disabled]{color:#bbb;cursor:not-allowed}
  .tab-content{padding:24px;min-height:340px}
  .qr-stage{display:flex;gap:24px;align-items:flex-start}
  .qr-box{flex:0 0 260px;background:#fff;border:2px solid #0a3a76;border-radius:12px;padding:10px;text-align:center;position:relative;box-shadow:0 4px 12px rgba(10,58,118,.08)}
  .qr-box .qr-svg{display:block;width:240px;height:240px;margin:0 auto}
  .qr-cap{font-size:11px;color:#5a6a82;margin-top:8px;text-align:center}
  .qr-caption-strong{font-weight:700;color:#0a3a76;font-size:13px;margin-top:6px}
  .qr-instructions{flex:1;font-size:14px;line-height:1.65}
  .qr-instructions h3{margin:0 0 14px;color:#003e7c;font-size:16px}
  .qr-instructions ol{margin:0;padding-left:20px;color:#3a4a64}
  .qr-instructions li{padding:4px 0}
  .qr-instructions li b{color:#0a3a76}
  .bank-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:18px}
  .bank{padding:10px;border:1px solid #e3e8ef;border-radius:6px;text-align:center;font-size:11px;color:#3a4a64;background:#fff;cursor:pointer;font-weight:600;transition:all .15s}
  .bank:hover{border-color:#0a3a76;background:#f0f5fb}
  .actions{padding:18px 24px;background:#f9fafc;border-top:1px solid #e3e8ef;display:flex;gap:12px;justify-content:flex-end;align-items:center}
  .actions .hint{margin-right:auto;color:#7a869a;font-size:12px}
  .btn{padding:11px 22px;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;transition:transform .1s}
  .btn:active{transform:translateY(1px)}
  .btn-primary{background:#003e7c;color:#fff;box-shadow:0 2px 4px rgba(0,62,124,.2)}
  .btn-primary:hover{background:#002e5a}
  .btn-ghost{background:#fff;color:#3a4a64;border:1px solid #cbd2dc}
  .btn-ghost:hover{background:#f4f6fb}
  .footer-strip{margin-top:18px;text-align:center;font-size:11px;color:#7a869a;line-height:1.6}
  .footer-strip a{color:#5a6a82;text-decoration:none;margin:0 6px}
  .sim-badge{position:fixed;bottom:18px;right:18px;background:#fef9c3;color:#854d0e;border:1px solid #facc15;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .processing{display:none;position:fixed;inset:0;background:rgba(255,255,255,.92);z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .processing.show{display:flex}
  .spinner{width:56px;height:56px;border:5px solid #cbd5e1;border-top-color:#003e7c;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .processing .msg{color:#003e7c;font-weight:600}
</style>
</head>
<body>
<div class="topbar">
  <div class="brand">
    <span class="brand-mark">VNPAY</span>
    <span class="brand-tag">Cổng thanh toán điện tử quốc gia · Giả lập</span>
  </div>
  <div class="timer">
    <span>Thời gian còn lại</span>
    <span class="timer-pill" id="timer">15:00</span>
  </div>
</div>

<div class="wrap">
  <aside class="panel">
    <div class="panel-h">Thông tin đơn hàng</div>
    <div class="panel-b">
      <div class="merchant">
        <div class="merchant-logo">BS</div>
        <div>
          <div class="merchant-name">${merchantName}</div>
          <div class="merchant-sub">The Editorial · Hệ thống bán sách</div>
        </div>
      </div>
      <div class="kv"><span class="kv-l">Mã đơn</span><span class="kv-r">${order.orderCode}</span></div>
      <div class="kv"><span class="kv-l">Mã giao dịch</span><span class="kv-r">${transactionRef}</span></div>
      <div class="kv"><span class="kv-l">Loại tiền</span><span class="kv-r">VND</span></div>
      <div class="kv"><span class="kv-l">Ngôn ngữ</span><span class="kv-r">Tiếng Việt</span></div>
      <div class="amount-row">
        <span class="lbl">Số tiền</span>
        <span class="val">${amount}₫</span>
      </div>
    </div>
  </aside>

  <main class="panel">
    <div class="tabs">
      <div class="tab active" data-tab="qr"><span class="icon">📱</span>VNPay-QR<br/><span style="font-size:10px;opacity:.7">Ứng dụng ngân hàng</span></div>
      <div class="tab" data-tab="atm"><span class="icon">💳</span>Thẻ ATM nội địa<br/><span style="font-size:10px;opacity:.7">Internet Banking</span></div>
      <div class="tab" data-tab="visa"><span class="icon">🌐</span>Thẻ quốc tế<br/><span style="font-size:10px;opacity:.7">VISA/Master/JCB</span></div>
      <div class="tab" data-tab="wallet"><span class="icon">👛</span>Ví điện tử<br/><span style="font-size:10px;opacity:.7">VNPay Wallet</span></div>
    </div>
    <div class="tab-content" id="tab-qr">
      <div class="qr-stage">
        <div class="qr-box">
          ${qrSvg}
          <div class="qr-caption-strong">VNPAY-QR</div>
          <div class="qr-cap">Quét bằng app ngân hàng</div>
        </div>
        <div class="qr-instructions">
          <h3>Hướng dẫn thanh toán</h3>
          <ol>
            <li>Mở app ngân hàng có hỗ trợ <b>VNPAY-QR</b> (Vietcombank, BIDV, Techcombank, MB, VPBank, …).</li>
            <li>Chọn chức năng <b>Quét mã QR</b> trên app.</li>
            <li>Hướng camera vào mã QR bên trái.</li>
            <li>Xác nhận thanh toán <b>${amount}₫</b> cho <b>${merchantName}</b>.</li>
            <li>Sau khi nhận được thông báo thành công, nhấn <b>"Đã thanh toán"</b> ở dưới.</li>
          </ol>
          <div class="bank-grid">
            ${bankList
              .map(
                (b) =>
                  `<div class="bank" title="${b.name}">${b.code}</div>`,
              )
              .join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-atm" style="display:none">
      <div style="text-align:center;padding:60px 20px;color:#5a6a82">
        <div style="font-size:48px;margin-bottom:12px">💳</div>
        <p>Chuyển hướng đến trang nhập thẻ ATM nội địa…</p>
        <p style="font-size:12px;opacity:.7">(Tính năng demo — vui lòng chọn VNPay-QR)</p>
      </div>
    </div>
    <div class="tab-content" id="tab-visa" style="display:none">
      <div style="text-align:center;padding:60px 20px;color:#5a6a82">
        <div style="font-size:48px;margin-bottom:12px">🌐</div>
        <p>Thẻ quốc tế VISA / Master / JCB</p>
        <p style="font-size:12px;opacity:.7">(Tính năng demo — vui lòng chọn VNPay-QR)</p>
      </div>
    </div>
    <div class="tab-content" id="tab-wallet" style="display:none">
      <div style="text-align:center;padding:60px 20px;color:#5a6a82">
        <div style="font-size:48px;margin-bottom:12px">👛</div>
        <p>Đăng nhập Ví VNPay</p>
        <p style="font-size:12px;opacity:.7">(Tính năng demo — vui lòng chọn VNPay-QR)</p>
      </div>
    </div>
    <div class="actions">
      <span class="hint">Bằng việc nhấn "Đã thanh toán", bạn xác nhận đã hoàn tất giao dịch.</span>
      <button class="btn btn-ghost" onclick="submitAction('cancel')">Huỷ giao dịch</button>
      <button class="btn btn-primary" onclick="submitAction('success')">Đã thanh toán</button>
    </div>
  </main>
</div>

<div class="footer-strip">
  © Công ty cổ phần Giải pháp Thanh toán Việt Nam (giả lập)
  <br/>
  <a href="#">Hỗ trợ</a> · <a href="#">Điều khoản</a> · <a href="#">Bảo mật</a> · Hotline (sim): 1900-55-55-77
</div>

<div class="sim-badge">⚠️ Cổng giả lập nội bộ · Không phát sinh giao dịch thật</div>

<div class="processing" id="processing">
  <div class="spinner"></div>
  <div class="msg">Đang xử lý giao dịch…</div>
</div>

<script>
const orderId = ${JSON.stringify(orderId)};
const sig = ${JSON.stringify(sig)};

// Tab switching
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const key = t.dataset.tab;
    ['qr','atm','visa','wallet'].forEach(k => {
      document.getElementById('tab-' + k).style.display = (k === key ? 'block' : 'none');
    });
  });
});

// Countdown 15:00 -> 00:00 then auto-cancel
let remain = 15 * 60;
const timerEl = document.getElementById('timer');
const ticker = setInterval(() => {
  remain--;
  if (remain <= 0) {
    clearInterval(ticker);
    submitAction('cancel');
    return;
  }
  const m = Math.floor(remain / 60).toString().padStart(2,'0');
  const s = (remain % 60).toString().padStart(2,'0');
  timerEl.textContent = m + ':' + s;
  if (remain <= 60) timerEl.style.background = 'rgba(239,68,68,.5)';
}, 1000);

async function submitAction(kind){
  document.getElementById('processing').classList.add('show');
  const url = kind === 'success'
    ? '/api/payments/vnpay/callback-success'
    : '/api/payments/vnpay/callback-cancel';
  try {
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ orderId, sig }),
    });
    if(res.ok){
      const json = await res.json();
      // Simulate ~1.2s of processing for realism
      setTimeout(() => {
        window.location.href = json?.data?.redirect || '/';
      }, 1200);
    } else {
      document.getElementById('processing').classList.remove('show');
      const txt = await res.text();
      alert('Lỗi: ' + txt);
    }
  } catch (err) {
    document.getElementById('processing').classList.remove('show');
    alert('Không thể kết nối cổng thanh toán: ' + err.message);
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

    return { redirect: `${this.frontendOrigin()}/orders/${orderId}?paid=1` };
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

    return { redirect: `${this.frontendOrigin()}/orders/${orderId}?cancelled=1` };
  }

  private frontendOrigin(): string {
    return (
      process.env.FRONTEND_ORIGIN ||
      `http://localhost:${process.env.FRONTEND_PORT || 3009}`
    );
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
