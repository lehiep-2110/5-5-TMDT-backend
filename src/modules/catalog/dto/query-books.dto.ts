import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export enum BookSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  RATING = 'rating',
  BESTSELLING = 'bestselling',
}

export enum BookStatusFilter {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}

export class QueryBooksDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsUUID('4', { message: 'categoryId không hợp lệ.' })
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minPrice phải là số.' })
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxPrice phải là số.' })
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsEnum(BookSort, { message: 'sort không hợp lệ.' })
  sort?: BookSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class AdminQueryBooksDto extends QueryBooksDto {
  @IsOptional()
  @IsEnum(BookStatusFilter, { message: 'status không hợp lệ.' })
  status?: BookStatusFilter = BookStatusFilter.ALL;
}
