import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookStatus } from '../../common/enums/book-status.enum';
import { Publisher } from './publisher.entity';
import { Category } from './category.entity';
import { BookAuthor } from './book-author.entity';
import { BookImage } from './book-image.entity';
import { PriceHistory } from './price-history.entity';
import { StockLog } from './stock-log.entity';
import { CartItem } from './cart-item.entity';
import { OrderItem } from './order-item.entity';
import { Review } from './review.entity';
import { Wishlist } from './wishlist.entity';

@Entity({ name: 'books' })
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 13, unique: true })
  isbn!: string;

  @Column({ name: 'publisher_id', type: 'uuid', nullable: true })
  publisherId!: string | null;

  @ManyToOne(() => Publisher, (p) => p.books, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'publisher_id' })
  publisher?: Publisher | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, (c) => c.books, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @Column({ type: 'varchar', length: 50, default: 'Tieng Viet' })
  language!: string;

  @Column({ name: 'year_published', type: 'smallint', nullable: true })
  yearPublished!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  @Column({
    name: 'discount_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  discountPrice!: string | null;

  @Column({
    name: 'discount_end_date',
    type: 'timestamp with time zone',
    nullable: true,
  })
  discountEndDate!: Date | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', nullable: true })
  pages!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  dimensions!: string | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  weight!: string | null;

  @Column({ name: 'stock_quantity', type: 'int', default: 0 })
  stockQuantity!: number;

  @Column({ type: 'enum', enum: BookStatus, default: BookStatus.ACTIVE })
  status!: BookStatus;

  @Column({
    name: 'avg_rating',
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
  })
  avgRating!: string;

  @Column({ name: 'review_count', type: 'int', default: 0 })
  reviewCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @OneToMany(() => BookAuthor, (ba) => ba.book)
  bookAuthors?: BookAuthor[];

  @OneToMany(() => BookImage, (img) => img.book)
  images?: BookImage[];

  @OneToMany(() => PriceHistory, (ph) => ph.book)
  priceHistories?: PriceHistory[];

  @OneToMany(() => StockLog, (s) => s.book)
  stockLogs?: StockLog[];

  @OneToMany(() => CartItem, (c) => c.book)
  cartItems?: CartItem[];

  @OneToMany(() => OrderItem, (oi) => oi.book)
  orderItems?: OrderItem[];

  @OneToMany(() => Review, (r) => r.book)
  reviews?: Review[];

  @OneToMany(() => Wishlist, (w) => w.book)
  wishlists?: Wishlist[];
}
