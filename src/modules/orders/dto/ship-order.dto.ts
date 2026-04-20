import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ShipOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Đơn vị vận chuyển không được để trống.' })
  @Length(1, 100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  carrier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Mã vận đơn không được để trống.' })
  @Length(1, 100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  trackingNumber!: string;
}
