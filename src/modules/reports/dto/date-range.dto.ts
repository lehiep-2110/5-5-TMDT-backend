import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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

export class OverviewQueryDto {
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

export class ExportQueryDto extends DateRangeDto {
  @IsString()
  @IsIn(['revenue', 'top-products'])
  type!: 'revenue' | 'top-products';
}
