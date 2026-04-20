import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookStatus } from '../../common/enums/book-status.enum';
import { Author } from '../../database/entities/author.entity';
import { BookAuthor } from '../../database/entities/book-author.entity';
import { BookImage } from '../../database/entities/book-image.entity';
import { Book } from '../../database/entities/book.entity';
import { Wishlist } from '../../database/entities/wishlist.entity';

const MAX_PER_USER = 100;

export interface WishlistItem {
  id: string;
  createdAt: Date;
  book: {
    id: string;
    slug: string;
    title: string;
    price: string;
    discountPrice: string | null;
    stockQuantity: number;
    status: BookStatus;
    primaryImage: string | null;
    authors: Array<{ id: string; name: string }>;
  };
}

@Injectable()
export class WishlistService {
  constructor(
    @InjectRepository(Wishlist)
    private readonly wishlists: Repository<Wishlist>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
    @InjectRepository(BookImage)
    private readonly bookImages: Repository<BookImage>,
    @InjectRepository(BookAuthor)
    private readonly bookAuthors: Repository<BookAuthor>,
  ) {}

  async list(
    userId: string,
    opts: { page?: number; limit?: number },
  ): Promise<{
    items: WishlistItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));

    const qb = this.wishlists
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.book', 'b')
      .where('w.userId = :userId', { userId })
      .orderBy('w.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();

    const bookIds = rows.map((r) => r.bookId);

    const primaryByBook = new Map<string, string>();
    if (bookIds.length > 0) {
      const images = await this.bookImages
        .createQueryBuilder('i')
        .where('i.bookId IN (:...ids)', { ids: bookIds })
        .orderBy('i.isPrimary', 'DESC')
        .addOrderBy('i.displayOrder', 'ASC')
        .getMany();
      for (const img of images) {
        if (!primaryByBook.has(img.bookId)) {
          primaryByBook.set(img.bookId, img.imageUrl);
        }
      }
    }

    const authorsByBook = new Map<
      string,
      Array<{ id: string; name: string }>
    >();
    if (bookIds.length > 0) {
      const links = await this.bookAuthors
        .createQueryBuilder('ba')
        .leftJoinAndSelect('ba.author', 'a')
        .where('ba.bookId IN (:...ids)', { ids: bookIds })
        .getMany();
      for (const l of links) {
        if (!l.author) continue;
        if (!authorsByBook.has(l.bookId)) authorsByBook.set(l.bookId, []);
        authorsByBook
          .get(l.bookId)!
          .push({ id: (l.author as Author).id, name: (l.author as Author).name });
      }
    }

    const items: WishlistItem[] = rows.map((w) => ({
      id: w.id,
      createdAt: w.createdAt,
      book: {
        id: w.book!.id,
        slug: w.book!.slug,
        title: w.book!.title,
        price: w.book!.price,
        discountPrice: w.book!.discountPrice,
        stockQuantity: w.book!.stockQuantity,
        status: w.book!.status,
        primaryImage: primaryByBook.get(w.book!.id) ?? null,
        authors: authorsByBook.get(w.book!.id) ?? [],
      },
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async toggle(
    userId: string,
    bookId: string,
  ): Promise<{ wishlisted: boolean }> {
    const book = await this.books.findOne({ where: { id: bookId } });
    if (!book) {
      throw new NotFoundException('Sách không tồn tại.');
    }
    const existing = await this.wishlists.findOne({
      where: { userId, bookId },
    });
    if (existing) {
      await this.wishlists.delete({ id: existing.id });
      return { wishlisted: false };
    }
    const count = await this.wishlists.count({ where: { userId } });
    if (count >= MAX_PER_USER) {
      throw new BadRequestException(
        `Danh sách yêu thích đã đạt giới hạn ${MAX_PER_USER} sản phẩm.`,
      );
    }
    const row = this.wishlists.create({ userId, bookId });
    await this.wishlists.save(row);
    return { wishlisted: true };
  }

  async remove(userId: string, bookId: string): Promise<{ removed: boolean }> {
    const result = await this.wishlists.delete({ userId, bookId });
    return { removed: (result.affected ?? 0) > 0 };
  }

  async ids(userId: string): Promise<string[]> {
    const rows = await this.wishlists
      .createQueryBuilder('w')
      .select('w.book_id', 'bookId')
      .where('w.userId = :userId', { userId })
      .getRawMany<{ bookId: string }>();
    return rows.map((r) => r.bookId);
  }
}
