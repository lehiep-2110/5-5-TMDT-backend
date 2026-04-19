import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VoucherType } from '../../common/enums/voucher-type.enum';
import { VoucherScope } from '../../common/enums/voucher-scope.enum';
import { User } from './user.entity';
import { VoucherUsage } from './voucher-usage.entity';

@Entity({ name: 'vouchers' })
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'enum', enum: VoucherType })
  type!: VoucherType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value!: string;

  @Column({
    name: 'max_discount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  maxDiscount!: string | null;

  @Column({
    name: 'min_order_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  minOrderAmount!: string;

  @Column({ name: 'total_quantity', type: 'int' })
  totalQuantity!: number;

  @Column({ name: 'used_quantity', type: 'int', default: 0 })
  usedQuantity!: number;

  @Column({ name: 'per_user_limit', type: 'int', default: 1 })
  perUserLimit!: number;

  @Column({ name: 'start_date', type: 'timestamp with time zone' })
  startDate!: Date;

  @Column({ name: 'end_date', type: 'timestamp with time zone' })
  endDate!: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({
    name: 'scope_type',
    type: 'enum',
    enum: VoucherScope,
    default: VoucherScope.ALL,
  })
  scopeType!: VoucherScope;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @OneToMany(() => VoucherUsage, (vu) => vu.voucher)
  usages?: VoucherUsage[];
}
