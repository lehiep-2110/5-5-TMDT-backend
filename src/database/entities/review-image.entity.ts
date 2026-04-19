import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Review } from './review.entity';

@Entity({ name: 'review_images' })
export class ReviewImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @ManyToOne(() => Review, (r) => r.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review?: Review;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  imageUrl!: string;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder!: number;
}
