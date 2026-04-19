import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateItemDto {
  @Type(() => Number)
  @IsInt({ message: 'quantity phải là số nguyên.' })
  @Min(0, { message: 'quantity không được âm.' })
  @Max(10, { message: 'Mỗi đầu sách chỉ được đặt tối đa 10 quyển.' })
  quantity!: number;
}
