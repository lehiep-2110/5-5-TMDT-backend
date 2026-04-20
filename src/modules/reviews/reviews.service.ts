import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { ReviewStatus } from '../../common/enums/review-status.enum';
import { Book } from '../../database/entities/book.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Order } from '../../database/entities/order.entity';
import { ReviewImage } from '../../database/entities/review-image.entity';
import { Review } from '../../database/entities/review.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h

export interface PublicReviewItem {
  id: string;
  stars: number;
  title: string | null;
  content: string | null;
  createdAt: Date;
  user: { fullName: string; avatarUrl: string | null };
  images: string[];
}

export interface MyReviewItem extends PublicReviewItem {
  bookId: string;
  book: { id: string; slug: string; title: string } | null;
  status: ReviewStatus;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(ReviewImage)
    private readonly reviewImages: Repository<ReviewImage>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
    private readonly dataSource: DataSource,
  ) {}

  async listByBookSlug(
    slug: string,
    opts: { page?: number; limit?: number },
  ): Promise<{
    items: PublicReviewItem[];
    total: number;
    page: number;
    limit: number;
    avgRating: string;
    reviewCount: number;
  }> {
    const book = await this.books.findOne({ where: { slug } });
    if (!book) throw new NotFoundException('Sách không tồn tại.');

    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));

    const qb = this.reviews
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'u')
      .where('r.bookId = :bookId', { bookId: book.id })
      .andWhere('r.status = :st', { st: ReviewStatus.PUBLISHED })
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();

    const reviewIds = rows.map((r) => r.id);
    const imagesByReview = new Map<string, string[]>();
    if (reviewIds.length > 0) {
      const imgs = await this.reviewImages
        .createQueryBuilder('ri')
        .where('ri.reviewId IN (:...ids)', { ids: reviewIds })
        .orderBy('ri.displayOrder', 'ASC')
        .getMany();
      for (const img of imgs) {
        if (!imagesByReview.has(img.reviewId)) {
          imagesByReview.set(img.reviewId, []);
        }
        imagesByReview.get(img.reviewId)!.push(img.imageUrl);
      }
    }

    const items: PublicReviewItem[] = rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      title: r.title,
      content: r.content,
      createdAt: r.createdAt,
      user: {
        fullName: r.user?.fullName ?? 'Khách hàng',
        avatarUrl: r.user?.avatarUrl ?? null,
      },
      images: imagesByReview.get(r.id) ?? [],
    }));

    return {
      items,
      total,
      page,
      limit,
      avgRating: book.avgRating,
      reviewCount: book.reviewCount,
    };
  }

  async listMine(
    userId: string,
    opts: { page?: number; limit?: number },
  ): Promise<{
    items: MyReviewItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));

    const qb = this.reviews
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'u')
      .leftJoinAndSelect('r.book', 'b')
      .where('r.userId = :uid', { uid: userId })
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();

    const reviewIds = rows.map((r) => r.id);
    const imagesByReview = new Map<string, string[]>();
    if (reviewIds.length > 0) {
      const imgs = await this.reviewImages
        .createQueryBuilder('ri')
        .where('ri.reviewId IN (:...ids)', { ids: reviewIds })
        .orderBy('ri.displayOrder', 'ASC')
        .getMany();
      for (const img of imgs) {
        if (!imagesByReview.has(img.reviewId)) {
          imagesByReview.set(img.reviewId, []);
        }
        imagesByReview.get(img.reviewId)!.push(img.imageUrl);
      }
    }

    const items: MyReviewItem[] = rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      title: r.title,
      content: r.content,
      createdAt: r.createdAt,
      status: r.status,
      bookId: r.bookId,
      book: r.book
        ? { id: r.book.id, slug: r.book.slug, title: r.book.title }
        : null,
      user: {
        fullName: r.user?.fullName ?? 'Khách hàng',
        avatarUrl: r.user?.avatarUrl ?? null,
      },
      images: imagesByReview.get(r.id) ?? [],
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    const reviewId = await this.dataSource.transaction(async (manager) => {
      const oi = await manager
        .createQueryBuilder(OrderItem, 'oi')
        .leftJoinAndSelect('oi.order', 'o')
        .where('oi.id = :id', { id: dto.orderItemId })
        .getOne();
      if (!oi) {
        throw new NotFoundException('Order item không tồn tại.');
      }
      if (!oi.order || oi.order.userId !== userId) {
        throw new ForbiddenException('Đơn hàng không thuộc về bạn.');
      }
      if (
        oi.order.status !== OrderStatus.DELIVERED &&
        oi.order.status !== OrderStatus.COMPLETED
      ) {
        throw new BadRequestException(
          'Bạn chỉ có thể đánh giá sau khi đơn hàng đã được giao.',
        );
      }
      if (oi.isReviewed) {
        throw new BadRequestException(
          'Bạn đã đánh giá sản phẩm này trong đơn hàng rồi.',
        );
      }

      const review = manager.create(Review, {
        userId,
        bookId: oi.bookId,
        orderItemId: oi.id,
        stars: dto.stars,
        title: dto.title ?? null,
        content: dto.content ?? null,
        status: ReviewStatus.PUBLISHED,
      });
      const saved = await manager.save(Review, review);

      oi.isReviewed = true;
      await manager.save(OrderItem, oi);

      await this.recomputeBookRating(manager, oi.bookId);

      return saved.id;
    });

    const row = await this.reviews.findOne({ where: { id: reviewId } });
    return row!;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateReviewDto,
  ): Promise<Review> {
    await this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(Review, { where: { id } });
      if (!review) throw new NotFoundException('Đánh giá không tồn tại.');
      if (review.userId !== userId) {
        throw new ForbiddenException('Bạn không có quyền sửa đánh giá này.');
      }
      const age = Date.now() - new Date(review.createdAt).getTime();
      if (age > EDIT_WINDOW_MS) {
        throw new BadRequestException(
          'Bạn chỉ có thể chỉnh sửa đánh giá trong vòng 48 giờ sau khi tạo.',
        );
      }

      if (dto.stars !== undefined) review.stars = dto.stars;
      if (dto.title !== undefined) review.title = dto.title ?? null;
      if (dto.content !== undefined) review.content = dto.content ?? null;
      await manager.save(Review, review);

      await this.recomputeBookRating(manager, review.bookId);
    });
    const row = await this.reviews.findOne({ where: { id } });
    return row!;
  }

  async adminSetStatus(
    id: string,
    status: ReviewStatus,
  ): Promise<Review> {
    await this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(Review, { where: { id } });
      if (!review) throw new NotFoundException('Đánh giá không tồn tại.');
      if (review.status === status) return;
      review.status = status;
      await manager.save(Review, review);
      await this.recomputeBookRating(manager, review.bookId);
    });
    const row = await this.reviews.findOne({ where: { id } });
    return row!;
  }

  private async recomputeBookRating(
    manager: EntityManager,
    bookId: string,
  ): Promise<void> {
    const agg = await manager
      .createQueryBuilder(Review, 'r')
      .select('COUNT(*)', 'cnt')
      .addSelect('COALESCE(AVG(r.stars), 0)', 'avg')
      .where('r.bookId = :bid', { bid: bookId })
      .andWhere('r.status = :st', { st: ReviewStatus.PUBLISHED })
      .getRawOne<{ cnt: string; avg: string }>();
    const cnt = Number(agg?.cnt ?? 0);
    const avgNum = Number(agg?.avg ?? 0);
    const avg = Number.isFinite(avgNum) ? avgNum.toFixed(2) : '0.00';
    await manager
      .createQueryBuilder()
      .update(Book)
      .set({ reviewCount: cnt, avgRating: avg })
      .where('id = :id', { id: bookId })
      .execute();
  }
}
