import { IsOptional, IsString, Length } from 'class-validator';

export class CreateAuthorDto {
  @IsString()
  @Length(1, 255, { message: 'Tên tác giả phải từ 1 đến 255 ký tự.' })
  name!: string;

  @IsOptional()
  @IsString()
  biography?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  nationality?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  avatarUrl?: string;
}

export class ListAuthorsDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}
