import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class BroadcastNotificationDto {
  /**
   * Either the literal string 'all' or an array of userIds.
   */
  @ValidateIf((o) => typeof o.target !== 'string')
  @IsArray()
  @ArrayMinSize(1, { message: 'Danh sách userIds rỗng.' })
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  target!: 'all' | string[];

  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @IsString()
  @Length(1, 5000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  link?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  type?: string;
}
