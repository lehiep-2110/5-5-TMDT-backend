import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

export class AdminListUsersDto {
  @IsOptional()
  @IsEnum(UserRole, { message: 'role không hợp lệ.' })
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'status không hợp lệ.' })
  status?: UserStatus;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class UpdateUserStatusDto {
  @IsEnum([UserStatus.ACTIVE, UserStatus.LOCKED, UserStatus.BANNED], {
    message: 'Trạng thái không hợp lệ. Chỉ chấp nhận ACTIVE/LOCKED/BANNED.',
  })
  status!: UserStatus;
}
