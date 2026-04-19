import { IsOptional, IsString, Length } from 'class-validator';

export class CreatePublisherDto {
  @IsString()
  @Length(1, 255, { message: 'Tên NXB phải từ 1 đến 255 ký tự.' })
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  website?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  logoUrl?: string;
}

export class ListPublishersDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}
