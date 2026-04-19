import { IsOptional, IsString, Length } from 'class-validator';

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
