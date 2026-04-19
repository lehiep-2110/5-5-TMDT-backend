import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Book } from './book.entity';
import { Review } from './review.entity';

@Entity({ name: 'order_items' })
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @ManyToOne(() => Book, (b) => b.orderItems, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'book_id' })
  book?: Book;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ name: 'price_at_time', type: 'decimal', precision: 10, scale: 2 })
  priceAtTime!: string;

  @Column({
    name: 'book_title_snapshot',
    type: 'varchar',
    length: 500,
  })
  bookTitleSnapshot!: string;

  @Column({ name: 'is_reviewed', type: 'boolean', default: false })
  isReviewed!: boolean;

  @OneToOne(() => Review, (r) => r.orderItem)
  review?: Review;
}
