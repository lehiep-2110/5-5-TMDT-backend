import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Book } from './book.entity';

@Entity({ name: 'price_history' })
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @ManyToOne(() => Book, (b) => b.priceHistories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book?: Book;

  @Column({ name: 'old_price', type: 'decimal', precision: 10, scale: 2 })
  oldPrice!: string;

  @Column({ name: 'new_price', type: 'decimal', precision: 10, scale: 2 })
  newPrice!: string;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamp with time zone' })
  changedAt!: Date;
}
