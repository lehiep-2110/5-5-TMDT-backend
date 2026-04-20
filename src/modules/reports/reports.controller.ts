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
  ExportQueryDto,
  LowStockQueryDto,
  OverviewQueryDto,
  RecentOrdersQueryDto,
  RevenueSeriesQueryDto,
  TopProductsQueryDto,
} from './dto/date-range.dto';
import { ReportsService } from './reports.service';

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

  @Get('export')
  async exportCsv(
    @Query() query: ExportQueryDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const { filename, content } = await this.reportsService.exportCsv(
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
