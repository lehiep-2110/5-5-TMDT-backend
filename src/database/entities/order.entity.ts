import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { User } from './user.entity';
import { Address } from './address.entity';
import { Voucher } from './voucher.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatusLog } from './order-status-log.entity';
import { Payment } from './payment.entity';
import { RefundRequest } from './refund-request.entity';

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_code', type: 'varchar', length: 50, unique: true })
  orderCode!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (u) => u.orders, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId!: string;

  @ManyToOne(() => Address, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'address_id' })
  address?: Address;

  @Column({ name: 'shipping_fee', type: 'decimal', precision: 10, scale: 2 })
  shippingFee!: string;

  @Column({ name: 'shipping_method', type: 'varchar', length: 100, nullable: true })
  shippingMethod!: string | null;

  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  @ManyToOne(() => Voucher, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'voucher_id' })
  voucher?: Voucher | null;

  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  discountAmount!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal!: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount!: string;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod!: PaymentMethod;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  paymentStatus!: PaymentStatus;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({ name: 'tracking_number', type: 'varchar', length: 100, nullable: true })
  trackingNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  carrier!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @OneToMany(() => OrderItem, (oi) => oi.order)
  items?: OrderItem[];

  @OneToMany(() => OrderStatusLog, (l) => l.order)
  statusLogs?: OrderStatusLog[];

  @OneToOne(() => Payment, (p) => p.order)
  payment?: Payment;

  @OneToOne(() => RefundRequest, (r) => r.order)
  refundRequest?: RefundRequest;
}
