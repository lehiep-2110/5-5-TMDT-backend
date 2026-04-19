import { IsOptional, IsString, Length } from 'class-validator';

export class UpdatePublisherDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

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
