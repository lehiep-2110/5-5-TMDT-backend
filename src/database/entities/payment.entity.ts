import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { PaymentTxStatus } from '../../common/enums/payment-tx-status.enum';
import { Order } from './order.entity';

@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId!: string;

  @OneToOne(() => Order, (o) => o.payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string;

  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: true,
  })
  transactionId!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentTxStatus,
    default: PaymentTxStatus.PENDING,
  })
  status!: PaymentTxStatus;

  @Column({ name: 'gateway_response', type: 'text', nullable: true })
  gatewayResponse!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
