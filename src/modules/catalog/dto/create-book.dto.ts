import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { BookStatus } from '../../../common/enums/book-status.enum';

/**
 * Helper: transform a form-data string (which may be a JSON array or a
 * comma-separated list) into a real string[].
 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v));
      } catch {
        /* fall through */
      }
    }
    return trimmed
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

export class CreateBookDto {
  @IsString()
  @Length(1, 500, { message: 'Tên sách phải có từ 1 đến 500 ký tự.' })
  title!: string;

  @IsString()
  @Matches(/^\d{13}$/, { message: 'ISBN phải gồm đúng 13 chữ số.' })
  isbn!: string;

  @IsUUID('4', { message: 'publisherId không hợp lệ.' })
  publisherId!: string;

  @IsUUID('4', { message: 'categoryId không hợp lệ.' })
  categoryId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(3000)
  yearPublished?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'price phải là số.' })
  @Min(0)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'discountPrice phải là số.' })
  @Min(0)
  discountPrice?: number;

  @IsOptional()
  @IsDateString({}, { message: 'discountEndDate không hợp lệ.' })
  discountEndDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pages?: number;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  dimensions?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'weight phải là số.' })
  @Min(0)
  weight?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity!: number;

  @IsOptional()
  @IsEnum(BookStatus, { message: 'status không hợp lệ.' })
  status?: BookStatus;

  @Transform(({ value }) => toStringArray(value))
  @IsArray({ message: 'authorIds phải là mảng.' })
  @ArrayNotEmpty({ message: 'Cần ít nhất một tác giả.' })
  @ArrayMinSize(1)
  @IsUUID('4', { each: true, message: 'authorIds chứa UUID không hợp lệ.' })
  authorIds!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  primaryImageIndex?: number = 0;
}
