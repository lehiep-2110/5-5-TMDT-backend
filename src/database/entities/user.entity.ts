import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { Address } from './address.entity';
import { RefreshToken } from './refresh-token.entity';
import { EmailVerificationToken } from './email-verification-token.entity';
import { CartItem } from './cart-item.entity';
import { Order } from './order.entity';
import { Review } from './review.entity';
import { Wishlist } from './wishlist.entity';
import { Notification } from './notification.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CUSTOMER })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING_VERIFICATION })
  status!: UserStatus;

  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts!: number;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @OneToMany(() => Address, (a) => a.user)
  addresses?: Address[];

  @OneToMany(() => RefreshToken, (t) => t.user)
  refreshTokens?: RefreshToken[];

  @OneToMany(() => EmailVerificationToken, (t) => t.user)
  emailVerificationTokens?: EmailVerificationToken[];

  @OneToMany(() => CartItem, (c) => c.user)
  cartItems?: CartItem[];

  @OneToMany(() => Order, (o) => o.user)
  orders?: Order[];

  @OneToMany(() => Review, (r) => r.user)
  reviews?: Review[];

  @OneToMany(() => Wishlist, (w) => w.user)
  wishlists?: Wishlist[];

  @OneToMany(() => Notification, (n) => n.user)
  notifications?: Notification[];
}
