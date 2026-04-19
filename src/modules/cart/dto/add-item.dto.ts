import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddItemDto {
  @IsUUID('4', { message: 'bookId không hợp lệ.' })
  bookId!: string;

  @Type(() => Number)
  @IsInt({ message: 'quantity phải là số nguyên.' })
  @Min(1, { message: 'quantity phải lớn hơn 0.' })
  @Max(10, { message: 'Mỗi đầu sách chỉ được đặt tối đa 10 quyển.' })
  quantity!: number;
}
