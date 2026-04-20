import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { BookStatus } from '../../common/enums/book-status.enum';
import {
  Granularity,
  OverviewPeriod,
} from './dto/date-range.dto';

export interface MetricValue {
  value: number;
  deltaPct: number;
  direction: 'up' | 'down' | 'flat';
}

function toNumber(v: unknown, def = 0): number {
  if (v === null || v === undefined) return def;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function deltaMetric(current: number, prior: number): MetricValue {
  const denom = Math.max(prior, 1);
  const raw = ((current - prior) / denom) * 100;
  const deltaPct = round1(raw);
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (Math.abs(deltaPct) >= 0.1) direction = deltaPct > 0 ? 'up' : 'down';
  return { value: current, deltaPct, direction };
}

function periodWindow(period: OverviewPeriod, now: Date = new Date()): {
  currentFrom: Date;
  currentTo: Date;
  priorFrom: Date;
  priorTo: Date;
} {
  const to = new Date(now);
  const from = new Date(now);
  switch (period) {
    case 'today':
      from.setUTCHours(0, 0, 0, 0);
      break;
    case 'week':
      from.setUTCDate(from.getUTCDate() - 7);
      break;
    case 'year':
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      break;
    case 'month':
    default:
      from.setUTCDate(from.getUTCDate() - 30);
      break;
  }
  const span = to.getTime() - from.getTime();
  const priorTo = new Date(from.getTime());
  const priorFrom = new Date(from.getTime() - span);
  return { currentFrom: from, currentTo: to, priorFrom, priorTo };
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private parseRange(from?: string, to?: string, defaultDays = 30): { from: Date; to: Date } {
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - defaultDays * 24 * 60 * 60 * 1000);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Tham số ngày tháng không hợp lệ.');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('"from" phải nhỏ hơn hoặc bằng "to".');
    }
    return { from: fromDate, to: toDate };
  }

  private async queryRevenueInRange(from: Date, to: Date): Promise<number> {
    const row: { revenue: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .from('orders', 'o')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere(
        '(o.payment_status = :paid OR o.status IN (:...paidStatuses))',
        {
          paid: PaymentStatus.PAID,
          paidStatuses: [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
        },
      )
      .getRawOne();
    return toNumber(row?.revenue, 0);
  }

  private async queryOrderCountInRange(from: Date, to: Date): Promise<number> {
    const row: { count: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('orders', 'o')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .getRawOne();
    return toNumber(row?.count, 0);
  }

  private async queryNewCustomersInRange(from: Date, to: Date): Promise<number> {
    const row: { count: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('users', 'u')
      .where('u.created_at >= :from AND u.created_at <= :to', { from, to })
      .andWhere('u.role = :role', { role: UserRole.CUSTOMER })
      .getRawOne();
    return toNumber(row?.count, 0);
  }

  async getOverview(period: OverviewPeriod = 'month') {
    const { currentFrom, currentTo, priorFrom, priorTo } = periodWindow(period);

    const [
      revCurrent,
      revPrior,
      ordersCurrent,
      ordersPrior,
      newCustCurrent,
      newCustPrior,
    ] = await Promise.all([
      this.queryRevenueInRange(currentFrom, currentTo),
      this.queryRevenueInRange(priorFrom, priorTo),
      this.queryOrderCountInRange(currentFrom, currentTo),
      this.queryOrderCountInRange(priorFrom, priorTo),
      this.queryNewCustomersInRange(currentFrom, currentTo),
      this.queryNewCustomersInRange(priorFrom, priorTo),
    ]);

    const aovCurrent = ordersCurrent > 0 ? revCurrent / ordersCurrent : 0;
    const aovPrior = ordersPrior > 0 ? revPrior / ordersPrior : 0;

    return {
      period,
      range: { from: currentFrom.toISOString(), to: currentTo.toISOString() },
      metrics: {
        revenue: deltaMetric(Math.round(revCurrent), Math.round(revPrior)),
        orderCount: deltaMetric(ordersCurrent, ordersPrior),
        newCustomers: deltaMetric(newCustCurrent, newCustPrior),
        averageOrderValue: deltaMetric(Math.round(aovCurrent), Math.round(aovPrior)),
      },
    };
  }

  async getRevenueSeries(fromIso?: string, toIso?: string, granularity: Granularity = 'day') {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: { bucket: Date; revenue: string | null; order_count: string | null }[] =
      await this.dataSource
        .createQueryBuilder()
        .select(`date_trunc(:g, o.created_at)`, 'bucket')
        .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
        .addSelect('COUNT(*)', 'order_count')
        .from('orders', 'o')
        .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
        .andWhere(
          '(o.payment_status = :paid OR o.status IN (:...paidStatuses))',
          {
            paid: PaymentStatus.PAID,
            paidStatuses: [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
          },
        )
        .setParameter('g', granularity)
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany();

    // Build lookup keyed by truncated ISO date.
    const lookup = new Map<string, { revenue: number; orderCount: number }>();
    for (const r of rows) {
      const key = this.bucketKey(new Date(r.bucket), granularity);
      lookup.set(key, {
        revenue: toNumber(r.revenue, 0),
        orderCount: toNumber(r.order_count, 0),
      });
    }

    const points = this.densifySeries(from, to, granularity).map((d) => {
      const key = this.bucketKey(d, granularity);
      const found = lookup.get(key);
      return {
        date: key,
        revenue: found ? Math.round(found.revenue) : 0,
        orderCount: found ? found.orderCount : 0,
      };
    });

    return { granularity, points };
  }

  private bucketKey(d: Date, g: Granularity): string {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    if (g === 'month') return `${year}-${month}-01`;
    return `${year}-${month}-${day}`;
  }

  private densifySeries(from: Date, to: Date, g: Granularity): Date[] {
    const result: Date[] = [];
    // Normalize start to truncated bucket
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    if (g === 'month') {
      start.setUTCDate(1);
    } else if (g === 'week') {
      // Move to Monday of the week (Postgres ISO week start)
      const dow = (start.getUTCDay() + 6) % 7; // 0=Mon
      start.setUTCDate(start.getUTCDate() - dow);
    }
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    const cursor = new Date(start);
    const max = 400; // safety cap to avoid runaways
    let count = 0;
    while (cursor.getTime() <= end.getTime() && count < max) {
      result.push(new Date(cursor));
      if (g === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else if (g === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      count++;
    }
    return result;
  }

  async getTopProducts(fromIso?: string, toIso?: string, limit = 10) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);
    const safeLimit = Math.min(Math.max(limit || 10, 1), 100);

    const rows: Array<{
      book_id: string;
      title: string;
      slug: string;
      primary_image: string | null;
      units_sold: string | null;
      revenue: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('b.id', 'book_id')
      .addSelect('b.title', 'title')
      .addSelect('b.slug', 'slug')
      .addSelect(
        `(SELECT bi.image_url FROM book_images bi
          WHERE bi.book_id = b.id
          ORDER BY bi.is_primary DESC, bi.display_order ASC
          LIMIT 1)`,
        'primary_image',
      )
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'units_sold')
      .addSelect('COALESCE(SUM(oi.quantity * oi.price_at_time), 0)', 'revenue')
      .from('order_items', 'oi')
      .innerJoin('orders', 'o', 'o.id = oi.order_id')
      .innerJoin('books', 'b', 'b.id = oi.book_id')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .groupBy('b.id')
      .addGroupBy('b.title')
      .addGroupBy('b.slug')
      .orderBy('revenue', 'DESC')
      .addOrderBy('units_sold', 'DESC')
      .limit(safeLimit)
      .getRawMany();

    return rows.map((r) => {
      const unitsSold = toNumber(r.units_sold, 0);
      const revenue = toNumber(r.revenue, 0);
      return {
        bookId: r.book_id,
        title: r.title,
        slug: r.slug,
        primaryImage: r.primary_image,
        unitsSold,
        revenue: Math.round(revenue),
        avgPrice: unitsSold > 0 ? Math.round(revenue / unitsSold) : 0,
      };
    });
  }

  async getRecentOrders(limit = 10) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 50);
    const rows: Array<{
      order_code: string;
      user_email: string | null;
      user_full_name: string | null;
      total_amount: string;
      status: OrderStatus;
      payment_status: PaymentStatus;
      payment_method: string;
      created_at: Date;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('o.order_code', 'order_code')
      .addSelect('u.email', 'user_email')
      .addSelect('u.full_name', 'user_full_name')
      .addSelect('o.total_amount', 'total_amount')
      .addSelect('o.status', 'status')
      .addSelect('o.payment_status', 'payment_status')
      .addSelect('o.payment_method', 'payment_method')
      .addSelect('o.created_at', 'created_at')
      .from('orders', 'o')
      .leftJoin('users', 'u', 'u.id = o.user_id')
      .orderBy('o.created_at', 'DESC')
      .limit(safeLimit)
      .getRawMany();

    return rows.map((r) => ({
      orderCode: r.order_code,
      userEmail: r.user_email,
      userFullName: r.user_full_name,
      totalAmount: Math.round(toNumber(r.total_amount, 0)),
      status: r.status,
      paymentStatus: r.payment_status,
      paymentMethod: r.payment_method,
      createdAt: r.created_at,
    }));
  }

  async getLowStock(threshold = 10, limit = 10) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 100);
    const safeThreshold = Math.max(threshold ?? 10, 0);

    const rows: Array<{
      id: string;
      title: string;
      slug: string;
      primary_image: string | null;
      stock_quantity: number;
      author_name: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('b.id', 'id')
      .addSelect('b.title', 'title')
      .addSelect('b.slug', 'slug')
      .addSelect('b.stock_quantity', 'stock_quantity')
      .addSelect(
        `(SELECT bi.image_url FROM book_images bi
          WHERE bi.book_id = b.id
          ORDER BY bi.is_primary DESC, bi.display_order ASC
          LIMIT 1)`,
        'primary_image',
      )
      .addSelect(
        `(SELECT a.name FROM book_authors ba
          INNER JOIN authors a ON a.id = ba.author_id
          WHERE ba.book_id = b.id
          LIMIT 1)`,
        'author_name',
      )
      .from('books', 'b')
      .where('b.stock_quantity < :threshold', { threshold: safeThreshold })
      .andWhere('b.status = :active', { active: BookStatus.ACTIVE })
      .orderBy('b.stock_quantity', 'ASC')
      .limit(safeLimit)
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      primaryImage: r.primary_image,
      stockQuantity: toNumber(r.stock_quantity, 0),
      authorName: r.author_name,
    }));
  }

  async getInventorySummary() {
    const row:
      | {
          total_titles: string | null;
          total_quantity: string | null;
          low_stock_count: string | null;
          inventory_value: string | null;
        }
      | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'total_titles')
      .addSelect('COALESCE(SUM(b.stock_quantity), 0)', 'total_quantity')
      .addSelect(
        'COALESCE(SUM(CASE WHEN b.stock_quantity < 10 THEN 1 ELSE 0 END), 0)',
        'low_stock_count',
      )
      .addSelect(
        'COALESCE(SUM(b.price * b.stock_quantity), 0)',
        'inventory_value',
      )
      .from('books', 'b')
      .where('b.status = :active', { active: BookStatus.ACTIVE })
      .getRawOne();

    return {
      totalTitles: toNumber(row?.total_titles, 0),
      totalQuantity: toNumber(row?.total_quantity, 0),
      lowStockCount: toNumber(row?.low_stock_count, 0),
      inventoryValue: Math.round(toNumber(row?.inventory_value, 0)),
    };
  }

  async exportCsv(type: 'revenue' | 'top-products', fromIso?: string, toIso?: string) {
    if (type === 'revenue') {
      const series = await this.getRevenueSeries(fromIso, toIso, 'day');
      const header = 'date,revenue_vnd,order_count\n';
      const body = series.points
        .map((p) => `${p.date},${p.revenue},${p.orderCount}`)
        .join('\n');
      return {
        filename: `revenue-${this.fileDate()}.csv`,
        content: header + body + (body ? '\n' : ''),
      };
    }
    // top-products
    const items = await this.getTopProducts(fromIso, toIso, 100);
    const header = 'book_id,title,slug,units_sold,revenue_vnd,avg_price_vnd\n';
    const body = items
      .map(
        (i) =>
          `${i.bookId},"${csvEscape(i.title)}",${i.slug},${i.unitsSold},${i.revenue},${i.avgPrice}`,
      )
      .join('\n');
    return {
      filename: `top-products-${this.fileDate()}.csv`,
      content: header + body + (body ? '\n' : ''),
    };
  }

  private fileDate(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }
}

function csvEscape(s: string): string {
  return (s ?? '').replace(/"/g, '""');
}
