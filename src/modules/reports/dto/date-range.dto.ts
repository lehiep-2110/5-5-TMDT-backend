import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class DateRangeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export type OverviewPeriod = 'today' | 'week' | 'month' | 'year';

export class OverviewQueryDto extends DateRangeDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'year'])
  period?: OverviewPeriod = 'month';
}

export type Granularity = 'day' | 'week' | 'month';

export class RevenueSeriesQueryDto extends DateRangeDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: Granularity = 'day';
}

export class TopProductsQueryDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class RecentOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class LowStockQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  threshold?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export type ExportType =
  | 'revenue'
  | 'top-products'
  | 'customers-top'
  | 'inventory-detail'
  | 'voucher-usage'
  | 'orders-status';

export type ExportFormat = 'csv' | 'xlsx';

export class ExportQueryDto extends DateRangeDto {
  @IsString()
  @IsIn([
    'revenue',
    'top-products',
    'customers-top',
    'inventory-detail',
    'voucher-usage',
    'orders-status',
  ])
  type!: ExportType;

  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: ExportFormat = 'csv';
}

export class RevenueDetailQueryDto extends DateRangeDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: Granularity = 'day';
}

export class SlowMoversQueryDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class TopCustomersQueryDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class RegistrationSeriesQueryDto extends DateRangeDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: Granularity = 'day';
}

export class ProductsPaginatedQueryDto extends DateRangeDto {
  @IsOptional()
  @IsIn(['revenue', 'units', 'asc'])
  sort?: 'revenue' | 'units' | 'asc' = 'revenue';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
