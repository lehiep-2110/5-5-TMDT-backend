import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { REDIS_CLIENT } from '../../config/redis.module';
import { EmailVerificationToken } from '../../database/entities/email-verification-token.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { User } from '../../database/entities/user.entity';
import { EmailService } from '../mocks/email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const VERIFICATION_TTL_HOURS = 24;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmailVerificationToken)
    private readonly verifications: Repository<EmailVerificationToken>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration + Email verification
  // ---------------------------------------------------------------------------
  async register(dto: RegisterDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.users.create({
      email,
      fullName: dto.fullName.trim(),
      passwordHash,
      role: UserRole.CUSTOMER,
      status: UserStatus.PENDING_VERIFICATION,
      failedAttempts: 0,
    });
    const saved = await this.users.save(user);

    await this.createVerificationToken(saved);
  }

  private async createVerificationToken(user: User): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date(
      Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    );
    const record = this.verifications.create({
      userId: user.id,
      token,
      expiresAt,
      isUsed: false,
    });
    await this.verifications.save(record);
    await this.emailService.sendVerification(user.email, token);
    return token;
  }

  async verifyEmail(token: string): Promise<void> {
    if (!token) {
      throw new BadRequestException('Thiếu mã xác thực.');
    }
    const record = await this.verifications.findOne({
      where: { token },
      relations: ['user'],
    });
    if (!record) {
      throw new BadRequestException('Mã xác thực không hợp lệ.');
    }
    if (record.isUsed) {
      throw new BadRequestException('Mã xác thực đã được sử dụng.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Mã xác thực đã hết hạn.');
    }

    record.isUsed = true;
    await this.verifications.save(record);

    const user = record.user;
    if (!user) {
      throw new BadRequestException('Người dùng không tồn tại.');
    }
    user.status = UserStatus.ACTIVE;
    await this.users.save(user);
  }

  async resendVerification(email: string): Promise<void> {
    const normalized = email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user) {
      // Do not leak existence — return silently
      return;
    }
    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException(
        'Tài khoản không ở trạng thái chờ xác thực.',
      );
    }
    await this.createVerificationToken(user);
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  async login(dto: LoginDto): Promise<LoginResult> {
    const normalized = dto.email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email: normalized } });

    // Generic invalid credentials for missing user or banned
    if (!user || user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException(
        'Vui lòng xác thực email trước khi đăng nhập.',
      );
    }

    // Check Redis lock (temporary lock set by failed-attempts throttle)
    const lockKey = `user:lock:${user.id}`;
    const locked = await this.redis.get(lockKey);
    if (locked) {
      throw new ForbiddenException(
        'Tài khoản đã bị khoá tạm thời do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.',
      );
    }

    // If DB status is LOCKED:
    //  - If failedAttempts reached the throttle threshold, this is an expired
    //    Redis lock — auto-unlock.
    //  - Otherwise, admin locked the account manually — refuse login.
    if (user.status === UserStatus.LOCKED) {
      if ((user.failedAttempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
        user.status = UserStatus.ACTIVE;
        user.failedAttempts = 0;
        await this.users.save(user);
      } else {
        throw new ForbiddenException(
          'Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.',
        );
      }
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      user.failedAttempts = (user.failedAttempts ?? 0) + 1;
      if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        user.status = UserStatus.LOCKED;
        await this.users.save(user);
        await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS);
        await this.emailService.sendAccountLocked(user.email);
        throw new ForbiddenException(
          'Tài khoản đã bị khoá do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.',
        );
      }
      await this.users.save(user);
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }

    // Success — reset counters
    if (user.failedAttempts !== 0 || user.status !== UserStatus.ACTIVE) {
      user.failedAttempts = 0;
      user.status = UserStatus.ACTIVE;
      await this.users.save(user);
    }

    const tokens = await this.issueTokens(user);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Token issuance / refresh / logout
  // ---------------------------------------------------------------------------
  private async issueTokens(user: User): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_TTL',
          '15m',
        ) as any,
      },
    );

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    const record = this.refreshTokens.create({
      userId: user.id,
      token: refreshToken,
      expiresAt,
      isRevoked: false,
    });
    await this.refreshTokens.save(record);

    await this.redis.set(
      `refresh:${refreshToken}`,
      user.id,
      'EX',
      REFRESH_TTL_SECONDS,
    );
    await this.redis.sadd(`user:refresh:${user.id}`, refreshToken);
    // Keep the set from growing unbounded; extend TTL on each write
    await this.redis.expire(
      `user:refresh:${user.id}`,
      REFRESH_TTL_SECONDS,
    );

    return { accessToken, refreshToken };
  }

  async refresh(oldRefreshToken: string): Promise<LoginResult> {
    if (!oldRefreshToken) {
      throw new UnauthorizedException('Thiếu refresh token.');
    }
    const userId = await this.redis.get(`refresh:${oldRefreshToken}`);
    if (!userId) {
      throw new UnauthorizedException('Refresh token không hợp lệ.');
    }

    const record = await this.refreshTokens.findOne({
      where: { token: oldRefreshToken },
    });
    if (!record || record.isRevoked) {
      throw new UnauthorizedException('Refresh token không hợp lệ.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token đã hết hạn.');
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Người dùng không tồn tại.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản không hoạt động.');
    }

    // Rotate: revoke the old, issue a new pair
    record.isRevoked = true;
    await this.refreshTokens.save(record);
    await this.redis.del(`refresh:${oldRefreshToken}`);
    await this.redis.srem(`user:refresh:${user.id}`, oldRefreshToken);

    const tokens = await this.issueTokens(user);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const record = await this.refreshTokens.findOne({
      where: { token: refreshToken },
    });
    if (record && record.userId === userId) {
      record.isRevoked = true;
      await this.refreshTokens.save(record);
    }
    await this.redis.del(`refresh:${refreshToken}`);
    await this.redis.srem(`user:refresh:${userId}`, refreshToken);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ isRevoked: true })
      .where('user_id = :userId AND is_revoked = false', { userId })
      .execute();

    const setKey = `user:refresh:${userId}`;
    const tokens = await this.redis.smembers(setKey);
    if (tokens.length) {
      const pipe = this.redis.pipeline();
      for (const t of tokens) {
        pipe.del(`refresh:${t}`);
      }
      pipe.del(setKey);
      await pipe.exec();
    } else {
      await this.redis.del(setKey);
    }
  }

  async findUserById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }
}
