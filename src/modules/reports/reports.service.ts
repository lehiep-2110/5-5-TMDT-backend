import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { BookStatus } from '../../common/enums/book-status.enum';
import {
  ExportFormat,
  ExportType,
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

  async getOverview(
    period: OverviewPeriod = 'month',
    fromIso?: string,
    toIso?: string,
  ) {
    let currentFrom: Date;
    let currentTo: Date;
    let priorFrom: Date;
    let priorTo: Date;

    if (fromIso || toIso) {
      // Custom range (Dashboard date filter): prior window = a window of the
      // same length immediately before `from`, so deltas stay comparable.
      const { from, to } = this.parseRange(fromIso, toIso, 30);
      const span = to.getTime() - from.getTime();
      currentFrom = from;
      currentTo = to;
      priorTo = new Date(from.getTime());
      priorFrom = new Date(from.getTime() - span);
    } else {
      ({ currentFrom, currentTo, priorFrom, priorTo } = periodWindow(period));
    }

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
      period: fromIso || toIso ? 'custom' : period,
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

  // ============================================================
  // Doanh thu (revenue)
  // ============================================================

  async getRevenueDetail(
    fromIso?: string,
    toIso?: string,
    granularity: Granularity = 'day',
  ) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{
      bucket: Date;
      revenue: string | null;
      order_count: string | null;
      cod_revenue: string | null;
      vnpay_revenue: string | null;
      momo_revenue: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select(`date_trunc(:g, o.created_at)`, 'bucket')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .addSelect('COUNT(*)', 'order_count')
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.payment_method = '${PaymentMethod.COD}' THEN o.total_amount ELSE 0 END), 0)`,
        'cod_revenue',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.payment_method = '${PaymentMethod.VNPAY}' THEN o.total_amount ELSE 0 END), 0)`,
        'vnpay_revenue',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.payment_method = '${PaymentMethod.MOMO}' THEN o.total_amount ELSE 0 END), 0)`,
        'momo_revenue',
      )
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

    const lookup = new Map<
      string,
      {
        revenue: number;
        orderCount: number;
        codRevenue: number;
        vnpayRevenue: number;
        momoRevenue: number;
      }
    >();
    for (const r of rows) {
      const key = this.bucketKey(new Date(r.bucket), granularity);
      lookup.set(key, {
        revenue: toNumber(r.revenue, 0),
        orderCount: toNumber(r.order_count, 0),
        codRevenue: toNumber(r.cod_revenue, 0),
        vnpayRevenue: toNumber(r.vnpay_revenue, 0),
        momoRevenue: toNumber(r.momo_revenue, 0),
      });
    }

    const points = this.densifySeries(from, to, granularity).map((d) => {
      const key = this.bucketKey(d, granularity);
      const found = lookup.get(key);
      return {
        date: key,
        revenue: found ? Math.round(found.revenue) : 0,
        orderCount: found ? found.orderCount : 0,
        codRevenue: found ? Math.round(found.codRevenue) : 0,
        vnpayRevenue: found ? Math.round(found.vnpayRevenue) : 0,
        momoRevenue: found ? Math.round(found.momoRevenue) : 0,
      };
    });

    return { granularity, points };
  }

  async getPaymentBreakdown(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{
      payment_method: string;
      count: string | null;
      revenue: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('o.payment_method', 'payment_method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .from('orders', 'o')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .groupBy('o.payment_method')
      .getRawMany();

    const byMethod = new Map<string, { count: number; revenue: number }>();
    let totalRevenue = 0;
    let totalOrders = 0;
    for (const r of rows) {
      const count = toNumber(r.count, 0);
      const revenue = toNumber(r.revenue, 0);
      byMethod.set(r.payment_method, { count, revenue });
      totalRevenue += revenue;
      totalOrders += count;
    }

    const pctOf = (rev: number) =>
      totalRevenue > 0 ? round1((rev / totalRevenue) * 100) : 0;

    const mk = (method: string) => {
      const v = byMethod.get(method) ?? { count: 0, revenue: 0 };
      return {
        count: v.count,
        revenue: Math.round(v.revenue),
        pct: pctOf(v.revenue),
      };
    };

    const result: Record<string, unknown> = {
      cod: mk(PaymentMethod.COD),
      vnpay: mk(PaymentMethod.VNPAY),
      totalOrders,
      totalRevenue: Math.round(totalRevenue),
    };

    if (byMethod.has(PaymentMethod.MOMO)) {
      result.momo = mk(PaymentMethod.MOMO);
    }

    return result;
  }

  async getRevenueByCategory(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{
      category_id: string | null;
      category_name: string | null;
      revenue: string | null;
      units: string | null;
      order_count: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('c.id', 'category_id')
      .addSelect('c.name', 'category_name')
      .addSelect('COALESCE(SUM(oi.quantity * oi.price_at_time), 0)', 'revenue')
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'units')
      .addSelect('COUNT(DISTINCT o.id)', 'order_count')
      .from('order_items', 'oi')
      .innerJoin('orders', 'o', 'o.id = oi.order_id')
      .innerJoin('books', 'b', 'b.id = oi.book_id')
      .leftJoin('categories', 'c', 'c.id = b.category_id')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .groupBy('c.id')
      .addGroupBy('c.name')
      .orderBy('revenue', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name ?? 'Khác',
      revenue: Math.round(toNumber(r.revenue, 0)),
      units: toNumber(r.units, 0),
      orderCount: toNumber(r.order_count, 0),
    }));
  }

  // ============================================================
  // Sản phẩm (products)
  // ============================================================

  async getSlowMovers(fromIso?: string, toIso?: string, limit = 10) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);
    const safeLimit = Math.min(Math.max(limit || 10, 1), 100);

    const rows: Array<{
      id: string;
      title: string;
      slug: string;
      primary_image: string | null;
      author_name: string | null;
      units_sold: string | null;
      stock_quantity: number;
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
      .addSelect(
        `COALESCE((
          SELECT SUM(oi.quantity)
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE oi.book_id = b.id
            AND o.created_at >= :from
            AND o.created_at <= :to
            AND o.status != :cancelled
        ), 0)`,
        'units_sold',
      )
      .from('books', 'b')
      .where('b.status = :active', { active: BookStatus.ACTIVE })
      .setParameter('from', from)
      .setParameter('to', to)
      .setParameter('cancelled', OrderStatus.CANCELLED)
      .orderBy('units_sold', 'ASC')
      .addOrderBy('b.stock_quantity', 'DESC')
      .limit(safeLimit)
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      primaryImage: r.primary_image,
      authorName: r.author_name,
      unitsSold: toNumber(r.units_sold, 0),
      stockQuantity: toNumber(r.stock_quantity, 0),
    }));
  }

  async getProductsPaginated(params: {
    from?: string;
    to?: string;
    sort?: 'revenue' | 'units' | 'asc';
    page?: number;
    limit?: number;
    categoryId?: string;
  }) {
    const { from, to } = this.parseRange(params.from, params.to, 30);
    const sort = params.sort ?? 'revenue';
    const page = Math.max(params.page ?? 1, 1);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;

    let orderClause = 'revenue DESC, units_sold DESC';
    if (sort === 'units') orderClause = 'units_sold DESC, revenue DESC';
    else if (sort === 'asc') orderClause = 'units_sold ASC, stock_quantity DESC';

    const countParams: Array<unknown> = [BookStatus.ACTIVE];
    let countCategoryWhere = '';
    if (params.categoryId) {
      countParams.push(params.categoryId);
      countCategoryWhere = `AND b.category_id = $${countParams.length}::uuid`;
    }
    const countSql = `
      SELECT COUNT(*) AS total
      FROM books b
      WHERE b.status = $1::books_status_enum ${countCategoryWhere}
    `;
    const countRows: Array<{ total: string }> = await this.dataSource.query(
      countSql,
      countParams,
    );
    const total = toNumber(countRows[0]?.total, 0);

    const queryParams: Array<unknown> = [
      from,
      to,
      OrderStatus.CANCELLED,
      BookStatus.ACTIVE,
    ];
    let categoryWhere = '';
    if (params.categoryId) {
      queryParams.push(params.categoryId);
      categoryWhere = `AND b.category_id = $${queryParams.length}::uuid`;
    }
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    const itemsSql = `
      SELECT
        b.id AS book_id,
        b.title AS title,
        b.slug AS slug,
        b.stock_quantity AS stock_quantity,
        b.category_id AS category_id,
        c.name AS category_name,
        (SELECT bi.image_url FROM book_images bi
         WHERE bi.book_id = b.id
         ORDER BY bi.is_primary DESC, bi.display_order ASC
         LIMIT 1) AS primary_image,
        (SELECT a.name FROM book_authors ba
         INNER JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = b.id
         LIMIT 1) AS author_name,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE oi.book_id = b.id
            AND o.created_at >= $1::timestamptz
            AND o.created_at <= $2::timestamptz
            AND o.status != $3::orders_status_enum
        ), 0)::bigint AS units_sold,
        COALESCE((
          SELECT SUM(oi.quantity * oi.price_at_time)
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE oi.book_id = b.id
            AND o.created_at >= $1::timestamptz
            AND o.created_at <= $2::timestamptz
            AND o.status != $3::orders_status_enum
        ), 0)::numeric AS revenue
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.status = $4::books_status_enum ${categoryWhere}
      ORDER BY ${orderClause}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows: Array<{
      book_id: string;
      title: string;
      slug: string;
      primary_image: string | null;
      author_name: string | null;
      category_id: string | null;
      category_name: string | null;
      units_sold: string | null;
      revenue: string | null;
      stock_quantity: number;
    }> = await this.dataSource.query(itemsSql, queryParams);

    const items = rows.map((r) => {
      const unitsSold = toNumber(r.units_sold, 0);
      const revenue = toNumber(r.revenue, 0);
      return {
        bookId: r.book_id,
        title: r.title,
        slug: r.slug,
        primaryImage: r.primary_image,
        authorName: r.author_name,
        categoryId: r.category_id,
        categoryName: r.category_name,
        unitsSold,
        revenue: Math.round(revenue),
        avgPrice: unitsSold > 0 ? Math.round(revenue / unitsSold) : 0,
        stockQuantity: toNumber(r.stock_quantity, 0),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    };
  }

  // ============================================================
  // Khách hàng (customers)
  // ============================================================

  async getTopCustomers(
    fromIso?: string,
    toIso?: string,
    limit = 10,
    sort: 'spent' | 'orders' = 'spent',
  ) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);
    const safeLimit = Math.min(Math.max(limit || 10, 1), 100);

    const rows: Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      order_count: string | null;
      total_spent: string | null;
      last_order_at: Date | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('u.id', 'user_id')
      .addSelect('u.email', 'email')
      .addSelect('u.full_name', 'full_name')
      .addSelect('COUNT(o.id)', 'order_count')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'total_spent')
      .addSelect('MAX(o.created_at)', 'last_order_at')
      .from('orders', 'o')
      .innerJoin('users', 'u', 'u.id = o.user_id')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .groupBy('u.id')
      .addGroupBy('u.email')
      .addGroupBy('u.full_name')
      .orderBy(sort === 'orders' ? 'order_count' : 'total_spent', 'DESC')
      .addOrderBy(sort === 'orders' ? 'total_spent' : 'order_count', 'DESC')
      .limit(safeLimit)
      .getRawMany();

    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      orderCount: toNumber(r.order_count, 0),
      totalSpent: Math.round(toNumber(r.total_spent, 0)),
      lastOrderAt: r.last_order_at,
    }));
  }

  async getNewVsReturning(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const newRow: { count: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('users', 'u')
      .where('u.created_at >= :from AND u.created_at <= :to', { from, to })
      .andWhere('u.role = :role', { role: UserRole.CUSTOMER })
      .getRawOne();

    const totalRow: { count: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT o.user_id)', 'count')
      .from('orders', 'o')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .getRawOne();

    // returning = users who placed an order in window AND have a prior order before "from"
    const returningRow: { count: string | null } | undefined = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT o.user_id)', 'count')
      .from('orders', 'o')
      .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.user_id = o.user_id
            AND o2.created_at < :from
            AND o2.status != :cancelled
        )`,
      )
      .getRawOne();

    return {
      newCount: toNumber(newRow?.count, 0),
      returningCount: toNumber(returningRow?.count, 0),
      totalCustomersInPeriod: toNumber(totalRow?.count, 0),
    };
  }

  async getRegistrationSeries(
    fromIso?: string,
    toIso?: string,
    granularity: Granularity = 'day',
  ) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{ bucket: Date; count: string | null }> =
      await this.dataSource
        .createQueryBuilder()
        .select(`date_trunc(:g, u.created_at)`, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .from('users', 'u')
        .where('u.created_at >= :from AND u.created_at <= :to', { from, to })
        .andWhere('u.role = :role', { role: UserRole.CUSTOMER })
        .setParameter('g', granularity)
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany();

    const lookup = new Map<string, number>();
    for (const r of rows) {
      const key = this.bucketKey(new Date(r.bucket), granularity);
      lookup.set(key, toNumber(r.count, 0));
    }

    const points = this.densifySeries(from, to, granularity).map((d) => {
      const key = this.bucketKey(d, granularity);
      return {
        date: key,
        count: lookup.get(key) ?? 0,
      };
    });

    return { granularity, points };
  }

  // ============================================================
  // Vận hành (operations)
  // ============================================================

  async getOrdersStatusBreakdown(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{ status: string; count: string | null }> =
      await this.dataSource
        .createQueryBuilder()
        .select('o.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .from('orders', 'o')
        .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
        .groupBy('o.status')
        .orderBy('count', 'DESC')
        .getRawMany();

    const total = rows.reduce((acc, r) => acc + toNumber(r.count, 0), 0);

    return rows.map((r) => {
      const count = toNumber(r.count, 0);
      return {
        status: r.status,
        count,
        pct: total > 0 ? round1((count / total) * 100) : 0,
      };
    });
  }

  async getCancelRate(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const row: { total: string | null; cancelled: string | null } | undefined =
      await this.dataSource
        .createQueryBuilder()
        .select('COUNT(*)', 'total')
        .addSelect(
          `SUM(CASE WHEN o.status = '${OrderStatus.CANCELLED}' THEN 1 ELSE 0 END)`,
          'cancelled',
        )
        .from('orders', 'o')
        .where('o.created_at >= :from AND o.created_at <= :to', { from, to })
        .getRawOne();

    const total = toNumber(row?.total, 0);
    const cancelled = toNumber(row?.cancelled, 0);
    return {
      cancelled,
      totalCreated: total,
      ratePct: total > 0 ? round1((cancelled / total) * 100) : 0,
    };
  }

  async getInventoryByCategory() {
    const rows: Array<{
      category_id: string | null;
      category_name: string | null;
      title_count: string | null;
      total_quantity: string | null;
      total_value: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('c.id', 'category_id')
      .addSelect('c.name', 'category_name')
      .addSelect('COUNT(b.id)', 'title_count')
      .addSelect('COALESCE(SUM(b.stock_quantity), 0)', 'total_quantity')
      .addSelect('COALESCE(SUM(b.price * b.stock_quantity), 0)', 'total_value')
      .from('books', 'b')
      .leftJoin('categories', 'c', 'c.id = b.category_id')
      .where('b.status = :active', { active: BookStatus.ACTIVE })
      .groupBy('c.id')
      .addGroupBy('c.name')
      .orderBy('total_value', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name ?? 'Khác',
      titleCount: toNumber(r.title_count, 0),
      totalQuantity: toNumber(r.total_quantity, 0),
      totalValue: Math.round(toNumber(r.total_value, 0)),
    }));
  }

  async getVouchersUsage(fromIso?: string, toIso?: string) {
    const { from, to } = this.parseRange(fromIso, toIso, 30);

    const rows: Array<{
      voucher_id: string;
      code: string;
      type: string;
      value: string;
      total_quantity: number;
      used_count: string | null;
      total_discount: string | null;
    }> = await this.dataSource
      .createQueryBuilder()
      .select('v.id', 'voucher_id')
      .addSelect('v.code', 'code')
      .addSelect('v.type', 'type')
      .addSelect('v.value', 'value')
      .addSelect('v.total_quantity', 'total_quantity')
      .addSelect(
        `COALESCE(SUM(CASE WHEN vu.used_at >= :from AND vu.used_at <= :to THEN 1 ELSE 0 END), 0)`,
        'used_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN vu.used_at >= :from AND vu.used_at <= :to THEN vu.discount_amount ELSE 0 END), 0)`,
        'total_discount',
      )
      .from('vouchers', 'v')
      .leftJoin('voucher_usages', 'vu', 'vu.voucher_id = v.id')
      .setParameter('from', from)
      .setParameter('to', to)
      .groupBy('v.id')
      .addGroupBy('v.code')
      .addGroupBy('v.type')
      .addGroupBy('v.value')
      .addGroupBy('v.total_quantity')
      .orderBy('total_discount', 'DESC')
      .getRawMany();

    return rows.map((r) => {
      const totalQuantity = toNumber(r.total_quantity, 0);
      const usedCount = toNumber(r.used_count, 0);
      const remaining =
        totalQuantity > 0
          ? round1(
              (Math.max(totalQuantity - usedCount, 0) / totalQuantity) * 100,
            )
          : 0;
      return {
        voucherId: r.voucher_id,
        code: r.code,
        type: r.type,
        value: r.value,
        usedCount,
        totalDiscount: Math.round(toNumber(r.total_discount, 0)),
        totalQuantity,
        remainingPct: remaining,
      };
    });
  }

  // ============================================================
  // Export (CSV + XLSX)
  // ============================================================

  async getExportData(type: ExportType, fromIso?: string, toIso?: string) {
    switch (type) {
      case 'revenue':
        return this.getRevenueDetail(fromIso, toIso, 'day');
      case 'top-products': {
        const items = await this.getTopProducts(fromIso, toIso, 100);
        // Enrich with categoryName + stockQuantity + authorName via separate query
        const ids = items.map((i) => i.bookId);
        const meta = new Map<
          string,
          {
            authorName: string | null;
            categoryName: string | null;
            stockQuantity: number;
          }
        >();
        if (ids.length > 0) {
          const rows: Array<{
            id: string;
            stock_quantity: number;
            category_name: string | null;
            author_name: string | null;
          }> = await this.dataSource
            .createQueryBuilder()
            .select('b.id', 'id')
            .addSelect('b.stock_quantity', 'stock_quantity')
            .addSelect('c.name', 'category_name')
            .addSelect(
              `(SELECT a.name FROM book_authors ba
                INNER JOIN authors a ON a.id = ba.author_id
                WHERE ba.book_id = b.id
                LIMIT 1)`,
              'author_name',
            )
            .from('books', 'b')
            .leftJoin('categories', 'c', 'c.id = b.category_id')
            .where('b.id IN (:...ids)', { ids })
            .getRawMany();
          for (const r of rows) {
            meta.set(r.id, {
              authorName: r.author_name,
              categoryName: r.category_name,
              stockQuantity: toNumber(r.stock_quantity, 0),
            });
          }
        }
        return items.map((it) => {
          const m = meta.get(it.bookId);
          return {
            ...it,
            authorName: m?.authorName ?? null,
            categoryName: m?.categoryName ?? null,
            stockQuantity: m?.stockQuantity ?? 0,
          };
        });
      }
      case 'customers-top':
        return this.getTopCustomers(fromIso, toIso, 100);
      case 'inventory-detail': {
        const rows: Array<{
          id: string;
          title: string;
          isbn: string;
          category_name: string | null;
          stock_quantity: number;
          price: string;
        }> = await this.dataSource
          .createQueryBuilder()
          .select('b.id', 'id')
          .addSelect('b.title', 'title')
          .addSelect('b.isbn', 'isbn')
          .addSelect('b.stock_quantity', 'stock_quantity')
          .addSelect('b.price', 'price')
          .addSelect('c.name', 'category_name')
          .from('books', 'b')
          .leftJoin('categories', 'c', 'c.id = b.category_id')
          .where('b.status = :active', { active: BookStatus.ACTIVE })
          .orderBy('b.title', 'ASC')
          .getRawMany();
        return rows.map((r) => {
          const price = toNumber(r.price, 0);
          const stock = toNumber(r.stock_quantity, 0);
          return {
            id: r.id,
            title: r.title,
            isbn: r.isbn,
            categoryName: r.category_name ?? 'Khác',
            stockQuantity: stock,
            price: Math.round(price),
            value: Math.round(price * stock),
          };
        });
      }
      case 'voucher-usage':
        return this.getVouchersUsage(fromIso, toIso);
      case 'orders-status':
        return this.getOrdersStatusBreakdown(fromIso, toIso);
      default:
        throw new BadRequestException('Loại xuất không hợp lệ.');
    }
  }

  async exportCsvContent(
    type: ExportType,
    fromIso?: string,
    toIso?: string,
  ): Promise<{ filename: string; content: string }> {
    const data = await this.getExportData(type, fromIso, toIso);
    const date = this.fileDate();

    switch (type) {
      case 'revenue': {
        const points = (data as { points: any[] }).points;
        const header =
          'date,revenue_vnd,order_count,cod_revenue_vnd,vnpay_revenue_vnd\n';
        const body = points
          .map(
            (p) =>
              `${p.date},${p.revenue},${p.orderCount},${p.codRevenue},${p.vnpayRevenue}`,
          )
          .join('\n');
        return {
          filename: `revenue-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      case 'top-products': {
        const items = data as Array<any>;
        const header =
          'rank,book_id,title,author,category,units_sold,revenue_vnd,avg_price_vnd,stock\n';
        const body = items
          .map(
            (i, idx) =>
              `${idx + 1},${i.bookId},"${csvEscape(i.title)}","${csvEscape(
                i.authorName ?? '',
              )}","${csvEscape(i.categoryName ?? '')}",${i.unitsSold},${
                i.revenue
              },${i.avgPrice},${i.stockQuantity}`,
          )
          .join('\n');
        return {
          filename: `top-products-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      case 'customers-top': {
        const items = data as Array<any>;
        const header =
          'rank,user_id,email,full_name,order_count,total_spent_vnd,last_order_at\n';
        const body = items
          .map(
            (it, idx) =>
              `${idx + 1},${it.userId},"${csvEscape(it.email ?? '')}","${csvEscape(
                it.fullName ?? '',
              )}",${it.orderCount},${it.totalSpent},${
                it.lastOrderAt ? new Date(it.lastOrderAt).toISOString() : ''
              }`,
          )
          .join('\n');
        return {
          filename: `customers-top-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      case 'inventory-detail': {
        const items = data as Array<any>;
        const header =
          'title,isbn,category,stock_quantity,price_vnd,value_vnd\n';
        const body = items
          .map(
            (it) =>
              `"${csvEscape(it.title)}",${it.isbn},"${csvEscape(
                it.categoryName ?? '',
              )}",${it.stockQuantity},${it.price},${it.value}`,
          )
          .join('\n');
        return {
          filename: `inventory-detail-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      case 'voucher-usage': {
        const items = data as Array<any>;
        const header =
          'code,type,value,used_count,total_quantity,total_discount_vnd,remaining_pct\n';
        const body = items
          .map(
            (it) =>
              `${it.code},${it.type},${it.value},${it.usedCount},${it.totalQuantity},${it.totalDiscount},${it.remainingPct}`,
          )
          .join('\n');
        return {
          filename: `voucher-usage-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      case 'orders-status': {
        const items = data as Array<any>;
        const header = 'status,count,pct\n';
        const body = items
          .map((it) => `${it.status},${it.count},${it.pct}`)
          .join('\n');
        return {
          filename: `orders-status-${date}.csv`,
          content: header + body + (body ? '\n' : ''),
        };
      }
      default:
        throw new BadRequestException('Loại xuất không hợp lệ.');
    }
  }

  /**
   * Backwards-compat method retained for any legacy callers.
   */
  async exportCsv(
    type: 'revenue' | 'top-products',
    fromIso?: string,
    toIso?: string,
  ) {
    return this.exportCsvContent(type, fromIso, toIso);
  }

  xlsxFilename(type: ExportType): string {
    return `${type}-${this.fileDate()}.xlsx`;
  }

  exportFileDate(): string {
    return this.fileDate();
  }

  buildExportFormat(format: ExportFormat | undefined): ExportFormat {
    return format === 'xlsx' ? 'xlsx' : 'csv';
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
