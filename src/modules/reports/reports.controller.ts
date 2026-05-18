import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  DateRangeDto,
  ExportQueryDto,
  LowStockQueryDto,
  OverviewQueryDto,
  ProductsPaginatedQueryDto,
  RecentOrdersQueryDto,
  RegistrationSeriesQueryDto,
  RevenueDetailQueryDto,
  RevenueSeriesQueryDto,
  SlowMoversQueryDto,
  TopCustomersQueryDto,
  TopProductsQueryDto,
} from './dto/date-range.dto';
import { ReportsService } from './reports.service';
import { buildWorkbook } from './xlsx-export.helper';

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  overview(@Query() query: OverviewQueryDto) {
    return this.reportsService.getOverview(query.period ?? 'month');
  }

  @Get('revenue-series')
  revenueSeries(@Query() query: RevenueSeriesQueryDto) {
    return this.reportsService.getRevenueSeries(
      query.from,
      query.to,
      query.granularity ?? 'day',
    );
  }

  @Get('top-products')
  async topProducts(@Query() query: TopProductsQueryDto) {
    const items = await this.reportsService.getTopProducts(
      query.from,
      query.to,
      query.limit ?? 10,
    );
    return { items };
  }

  @Get('recent-orders')
  async recentOrders(@Query() query: RecentOrdersQueryDto) {
    const items = await this.reportsService.getRecentOrders(query.limit ?? 10);
    return { items };
  }

  @Get('low-stock')
  async lowStock(@Query() query: LowStockQueryDto) {
    const items = await this.reportsService.getLowStock(
      query.threshold ?? 10,
      query.limit ?? 10,
    );
    return { items };
  }

  @Get('inventory-summary')
  inventorySummary() {
    return this.reportsService.getInventorySummary();
  }

  // ============================================================
  // Doanh thu (revenue)
  // ============================================================

  @Get('revenue-detail')
  revenueDetail(@Query() query: RevenueDetailQueryDto) {
    return this.reportsService.getRevenueDetail(
      query.from,
      query.to,
      query.granularity ?? 'day',
    );
  }

  @Get('payment-breakdown')
  paymentBreakdown(@Query() query: DateRangeDto) {
    return this.reportsService.getPaymentBreakdown(query.from, query.to);
  }

  @Get('revenue-by-category')
  async revenueByCategory(@Query() query: DateRangeDto) {
    const items = await this.reportsService.getRevenueByCategory(
      query.from,
      query.to,
    );
    return { items };
  }

  // ============================================================
  // Sản phẩm (products)
  // ============================================================

  @Get('slow-movers')
  async slowMovers(@Query() query: SlowMoversQueryDto) {
    const items = await this.reportsService.getSlowMovers(
      query.from,
      query.to,
      query.limit ?? 10,
    );
    return { items };
  }

  @Get('products-paginated')
  productsPaginated(@Query() query: ProductsPaginatedQueryDto) {
    return this.reportsService.getProductsPaginated({
      from: query.from,
      to: query.to,
      sort: query.sort ?? 'revenue',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      categoryId: query.categoryId,
    });
  }

  // ============================================================
  // Khách hàng (customers)
  // ============================================================

  @Get('customers/top')
  async topCustomers(@Query() query: TopCustomersQueryDto) {
    const items = await this.reportsService.getTopCustomers(
      query.from,
      query.to,
      query.limit ?? 10,
    );
    return { items };
  }

  @Get('customers/new-vs-returning')
  newVsReturning(@Query() query: DateRangeDto) {
    return this.reportsService.getNewVsReturning(query.from, query.to);
  }

  @Get('customers/registration-series')
  registrationSeries(@Query() query: RegistrationSeriesQueryDto) {
    return this.reportsService.getRegistrationSeries(
      query.from,
      query.to,
      query.granularity ?? 'day',
    );
  }

  // ============================================================
  // Vận hành (operations)
  // ============================================================

  @Get('orders/status-breakdown')
  async ordersStatusBreakdown(@Query() query: DateRangeDto) {
    const items = await this.reportsService.getOrdersStatusBreakdown(
      query.from,
      query.to,
    );
    return { items };
  }

  @Get('orders/cancel-rate')
  cancelRate(@Query() query: DateRangeDto) {
    return this.reportsService.getCancelRate(query.from, query.to);
  }

  @Get('inventory-by-category')
  async inventoryByCategory() {
    const items = await this.reportsService.getInventoryByCategory();
    return { items };
  }

  @Get('vouchers/usage')
  async vouchersUsage(@Query() query: DateRangeDto) {
    const items = await this.reportsService.getVouchersUsage(
      query.from,
      query.to,
    );
    return { items };
  }

  // ============================================================
  // Export
  // ============================================================

  @Get('export')
  async exportFile(
    @Query() query: ExportQueryDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = this.reportsService.buildExportFormat(query.format);

    if (format === 'xlsx') {
      const data = await this.reportsService.getExportData(
        query.type,
        query.from,
        query.to,
      );
      const workbook = buildWorkbook(query.type, data);
      const filename = this.reportsService.xlsxFilename(query.type);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.status(200);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    // CSV default
    const { filename, content } = await this.reportsService.exportCsvContent(
      query.type,
      query.from,
      query.to,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(content);
  }
}
