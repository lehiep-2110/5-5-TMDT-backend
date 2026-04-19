import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, ILike, Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { Address } from '../../database/entities/address.entity';
import { User } from '../../database/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import {
  AdminListUsersDto,
  UpdateUserStatusDto,
} from './dto/admin-list.dto';
import {
  CreateAddressDto,
  UpdateAddressDto,
} from './dto/address.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const MAX_ADDRESSES_PER_USER = 5;

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    private readonly authService: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl ?? null,
      phone: user.phone ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Customer profile
  // ---------------------------------------------------------------------------
  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }
    return this.toPublic(user);
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }
    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) user.phone = dto.phone.trim() || null;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl || null;
    const saved = await this.users.save(user);
    return this.toPublic(saved);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }
    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng.');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.users.save(user);
    await this.authService.revokeAllForUser(user.id);
  }

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------
  async listAddresses(userId: string): Promise<Address[]> {
    return this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async createAddress(
    userId: string,
    dto: CreateAddressDto,
  ): Promise<Address> {
    const count = await this.addresses.count({ where: { userId } });
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BadRequestException(
        `Mỗi người dùng chỉ được lưu tối đa ${MAX_ADDRESSES_PER_USER} địa chỉ.`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const shouldBeDefault = dto.isDefault === true || count === 0;
      if (shouldBeDefault) {
        await manager
          .createQueryBuilder()
          .update(Address)
          .set({ isDefault: false })
          .where('user_id = :userId', { userId })
          .execute();
      }
      const entity = manager.create(Address, {
        userId,
        recipientName: dto.recipientName,
        phone: dto.phone,
        province: dto.province,
        district: dto.district,
        ward: dto.ward,
        streetAddress: dto.streetAddress,
        isDefault: shouldBeDefault,
      });
      return manager.save(Address, entity);
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    const existing = await this.addresses.findOne({
      where: { id: addressId },
    });
    if (!existing) {
      throw new NotFoundException('Địa chỉ không tồn tại.');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền cập nhật địa chỉ này.');
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.isDefault === true) {
        await manager
          .createQueryBuilder()
          .update(Address)
          .set({ isDefault: false })
          .where('user_id = :userId', { userId })
          .execute();
        existing.isDefault = true;
      } else if (dto.isDefault === false) {
        existing.isDefault = false;
      }
      if (dto.recipientName !== undefined)
        existing.recipientName = dto.recipientName;
      if (dto.phone !== undefined) existing.phone = dto.phone;
      if (dto.province !== undefined) existing.province = dto.province;
      if (dto.district !== undefined) existing.district = dto.district;
      if (dto.ward !== undefined) existing.ward = dto.ward;
      if (dto.streetAddress !== undefined)
        existing.streetAddress = dto.streetAddress;

      return manager.save(Address, existing);
    });
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const existing = await this.addresses.findOne({
      where: { id: addressId },
    });
    if (!existing) {
      throw new NotFoundException('Địa chỉ không tồn tại.');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xoá địa chỉ này.');
    }

    await this.dataSource.transaction(async (manager) => {
      const wasDefault = existing.isDefault;
      await manager.delete(Address, { id: addressId });
      if (wasDefault) {
        const remaining = await manager.find(Address, {
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (remaining.length > 0) {
          remaining[0].isDefault = true;
          await manager.save(Address, remaining[0]);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Admin operations
  // ---------------------------------------------------------------------------
  async adminList(dto: AdminListUsersDto): Promise<{
    items: PublicUser[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const qb = this.users.createQueryBuilder('u');
    if (dto.role) qb.andWhere('u.role = :role', { role: dto.role });
    if (dto.status) qb.andWhere('u.status = :status', { status: dto.status });
    if (dto.keyword) {
      qb.andWhere(
        '(u.email ILIKE :kw OR u.full_name ILIKE :kw)',
        { kw: `%${dto.keyword}%` },
      );
    }
    qb.orderBy('u.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((u) => this.toPublic(u)),
      total,
      page,
      limit,
    };
  }

  async adminGet(id: string): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }
    return this.toPublic(user);
  }

  async adminUpdateStatus(
    id: string,
    dto: UpdateUserStatusDto,
  ): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Không thể thay đổi trạng thái tài khoản quản trị qua endpoint này.',
      );
    }
    user.status = dto.status;
    if (dto.status === UserStatus.ACTIVE) {
      user.failedAttempts = 0;
    }
    const saved = await this.users.save(user);
    if (
      dto.status === UserStatus.LOCKED ||
      dto.status === UserStatus.BANNED
    ) {
      await this.authService.revokeAllForUser(saved.id);
    }
    return this.toPublic(saved);
  }
}
