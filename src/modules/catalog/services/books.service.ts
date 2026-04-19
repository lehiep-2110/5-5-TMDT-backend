import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookStatus } from '../../../common/enums/book-status.enum';
import { StockReason } from '../../../common/enums/stock-reason.enum';
import { Author } from '../../../database/entities/author.entity';
import { BookAuthor } from '../../../database/entities/book-author.entity';
import { BookImage } from '../../../database/entities/book-image.entity';
import { Book } from '../../../database/entities/book.entity';
import { Category } from '../../../database/entities/category.entity';
import { PriceHistory } from '../../../database/entities/price-history.entity';
import { Publisher } from '../../../database/entities/publisher.entity';
import { StockLog } from '../../../database/entities/stock-log.entity';
import { CreateBookDto } from '../dto/create-book.dto';
import {
  AdminQueryBooksDto,
  BookSort,
  BookStatusFilter,
  QueryBooksDto,
} from '../dto/query-books.dto';
import { UpdateBookDto } from '../dto/update-book.dto';
import { generateUniqueSlug, toSlug } from '../utils/slug.util';
import { CategoriesService } from './categories.service';

export interface BookListItem {
  id: string;
  slug: string;
  title: string;
  isbn: string;
  price: string;
  discountPrice: string | null;
  discountEndDate: Date | null;
  avgRating: string;
  reviewCount: number;
  stockQuantity: number;
  status: BookStatus;
  primaryImage: string | null;
  authors: Array<{ id: string; name: string }>;
  publisher: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  updatedAt?: Date;
}

export interface BookDetail extends BookListItem {
  language: string;
  yearPublished: number | null;
  description: string | null;
  pages: number | null;
  dimensions: string | null;
  weight: string | null;
  createdAt: Date;
  updatedAt: Date;
  images: Array<{
    id: string;
    imageUrl: string;
    isPrimary: boolean;
    displayOrder: number;
  }>;
  breadcrumb: Array<{ id: string; name: string; slug: string }>;
  authorIds: string[];
}

export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book) private readonly books: Repository<Book>,
    @InjectRepository(BookImage)
    private readonly bookImages: Repository<BookImage>,
    @InjectRepository(BookAuthor)
    private readonly bookAuthors: Repository<BookAuthor>,
    @InjectRepository(Author) private readonly authors: Repository<Author>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly dataSource: DataSource,
    private readonly categoriesService: CategoriesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  private async mapListItems(bookIds: string[]): Promise<BookListItem[]> {
    if (bookIds.length === 0) return [];

    // Fetch books with publisher + category + primary image
    const rows = await this.books
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.publisher', 'p')
      .leftJoinAndSelect('b.category', 'c')
      .whereInIds(bookIds)
      .getMany();

    // Fetch all authors for these books
    const links = await this.bookAuthors
      .createQueryBuilder('ba')
      .leftJoinAndSelect('ba.author', 'a')
      .where('ba.book_id IN (:...ids)', { ids: bookIds })
      .getMany();

    const authorsByBook = new Map<
      string,
      Array<{ id: string; name: string }>
    >();
    for (const l of links) {
      if (!l.author) continue;
      if (!authorsByBook.has(l.bookId)) authorsByBook.set(l.bookId, []);
      authorsByBook
        .get(l.bookId)!
        .push({ id: l.author.id, name: l.author.name });
    }

    // Fetch primary image (or first image if no primary) for each book
    const images = await this.bookImages
      .createQueryBuilder('i')
      .where('i.book_id IN (:...ids)', { ids: bookIds })
      .orderBy('i.is_primary', 'DESC')
      .addOrderBy('i.display_order', 'ASC')
      .getMany();
    const primaryByBook = new Map<string, string>();
    for (const img of images) {
      if (!primaryByBook.has(img.bookId)) {
        primaryByBook.set(img.bookId, img.imageUrl);
      }
    }

    // Preserve the original order supplied via `bookIds`.
    const byId = new Map<string, Book>();
    for (const b of rows) byId.set(b.id, b);

    return bookIds
      .map((id) => byId.get(id))
      .filter((b): b is Book => !!b)
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        title: b.title,
        isbn: b.isbn,
        price: b.price,
        discountPrice: b.discountPrice,
        discountEndDate: b.discountEndDate,
        avgRating: b.avgRating,
        reviewCount: b.reviewCount,
        stockQuantity: b.stockQuantity,
        status: b.status,
        primaryImage: primaryByBook.get(b.id) ?? null,
        authors: authorsByBook.get(b.id) ?? [],
        publisher: b.publisher
          ? { id: b.publisher.id, name: b.publisher.name }
          : null,
        category: b.category
          ? { id: b.category.id, name: b.category.name }
          : null,
        updatedAt: b.updatedAt,
      }));
  }

  async listPublic(
    dto: QueryBooksDto,
  ): Promise<ListEnvelope<BookListItem>> {
    return this.listInternal(dto, { onlyActive: true });
  }

  async listAdmin(
    dto: AdminQueryBooksDto,
  ): Promise<ListEnvelope<BookListItem>> {
    const status = dto.status ?? BookStatusFilter.ALL;
    return this.listInternal(dto, {
      onlyActive: status === BookStatusFilter.ACTIVE,
      onlyInactive: status === BookStatusFilter.INACTIVE,
    });
  }

  private async listInternal(
    dto: QueryBooksDto,
    opts: { onlyActive?: boolean; onlyInactive?: boolean },
  ): Promise<ListEnvelope<BookListItem>> {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(dto.limit) || 20));

    const qb = this.books
      .createQueryBuilder('b')
      .leftJoin('book_authors', 'ba', 'ba.book_id = b.id')
      .leftJoin('authors', 'a', 'a.id = ba.author_id')
      .leftJoin('publishers', 'p', 'p.id = b.publisher_id')
      .select('b.id', 'id')
      .addSelect('b.created_at', 'created_at')
      .addSelect('b.price', 'price')
      .addSelect('b.avg_rating', 'avg_rating')
      .addSelect('b.review_count', 'review_count')
      .distinct(true);

    if (opts.onlyActive) {
      qb.andWhere('b.status = :active', { active: BookStatus.ACTIVE });
    } else if (opts.onlyInactive) {
      qb.andWhere('b.status = :inactive', { inactive: BookStatus.INACTIVE });
    }

    if (dto.keyword) {
      qb.andWhere(
        '(b.title ILIKE :kw OR b.isbn ILIKE :kw OR a.name ILIKE :kw OR p.name ILIKE :kw)',
        { kw: `%${dto.keyword}%` },
      );
    }

    if (dto.categoryId) {
      const ids = await this.categoriesService.getDescendantIds(
        dto.categoryId,
      );
      if (ids.length === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      qb.andWhere('b.category_id IN (:...catIds)', { catIds: ids });
    }

    if (dto.minPrice !== undefined) {
      qb.andWhere('b.price >= :minP', { minP: dto.minPrice });
    }
    if (dto.maxPrice !== undefined) {
      qb.andWhere('b.price <= :maxP', { maxP: dto.maxPrice });
    }

    switch (dto.sort) {
      case BookSort.PRICE_ASC:
        qb.orderBy('b.price', 'ASC');
        break;
      case BookSort.PRICE_DESC:
        qb.orderBy('b.price', 'DESC');
        break;
      case BookSort.RATING:
        qb.orderBy('b.avg_rating', 'DESC').addOrderBy(
          'b.review_count',
          'DESC',
        );
        break;
      case BookSort.BESTSELLING:
        // Proxy: review_count is a reasonable "bestselling" signal until we
        // track order totals here; falls back on rating then recency.
        qb.orderBy('b.review_count', 'DESC')
          .addOrderBy('b.avg_rating', 'DESC')
          .addOrderBy('b.created_at', 'DESC');
        break;
      case BookSort.NEWEST:
      default:
        qb.orderBy('b.created_at', 'DESC');
        break;
    }

    // We need a stable secondary order for pagination determinism.
    qb.addOrderBy('b.id', 'ASC');

    // Total count (distinct book ids) — execute a parallel count query.
    const countQb = this.books
      .createQueryBuilder('b')
      .leftJoin('book_authors', 'ba', 'ba.book_id = b.id')
      .leftJoin('authors', 'a', 'a.id = ba.author_id')
      .leftJoin('publishers', 'p', 'p.id = b.publisher_id')
      .select('COUNT(DISTINCT b.id)', 'cnt');
    if (opts.onlyActive) {
      countQb.andWhere('b.status = :active', { active: BookStatus.ACTIVE });
    } else if (opts.onlyInactive) {
      countQb.andWhere('b.status = :inactive', {
        inactive: BookStatus.INACTIVE,
      });
    }
    if (dto.keyword) {
      countQb.andWhere(
        '(b.title ILIKE :kw OR b.isbn ILIKE :kw OR a.name ILIKE :kw OR p.name ILIKE :kw)',
        { kw: `%${dto.keyword}%` },
      );
    }
    if (dto.categoryId) {
      const ids = await this.categoriesService.getDescendantIds(
        dto.categoryId,
      );
      if (ids.length > 0) {
        countQb.andWhere('b.category_id IN (:...catIds)', { catIds: ids });
      }
    }
    if (dto.minPrice !== undefined) {
      countQb.andWhere('b.price >= :minP', { minP: dto.minPrice });
    }
    if (dto.maxPrice !== undefined) {
      countQb.andWhere('b.price <= :maxP', { maxP: dto.maxPrice });
    }

    qb.offset((page - 1) * limit).limit(limit);

    const [rawRows, countRow] = await Promise.all([
      qb.getRawMany<{ id: string }>(),
      countQb.getRawOne<{ cnt: string }>(),
    ]);

    const total = Number(countRow?.cnt ?? 0);
    const ids = rawRows.map((r) => r.id);
    const items = await this.mapListItems(ids);

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------

  async getBySlug(slug: string): Promise<BookDetail> {
    const book = await this.books.findOne({
      where: { slug },
      relations: {
        publisher: true,
        category: true,
        images: true,
        bookAuthors: { author: true },
      },
    });
    if (!book) throw new NotFoundException('Sách không tồn tại.');
    return this.toDetail(book);
  }

  async getByIdAdmin(id: string): Promise<BookDetail> {
    const book = await this.books.findOne({
      where: { id },
      relations: {
        publisher: true,
        category: true,
        images: true,
        bookAuthors: { author: true },
      },
    });
    if (!book) throw new NotFoundException('Sách không tồn tại.');
    return this.toDetail(book);
  }

  private async toDetail(book: Book): Promise<BookDetail> {
    const sortedImages = (book.images ?? [])
      .slice()
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.displayOrder - b.displayOrder;
      });
    const primaryImage =
      sortedImages.find((i) => i.isPrimary)?.imageUrl ??
      sortedImages[0]?.imageUrl ??
      null;
    const authors = (book.bookAuthors ?? [])
      .map((ba) => ba.author)
      .filter((a): a is Author => !!a)
      .map((a) => ({ id: a.id, name: a.name }));
    const authorIds = authors.map((a) => a.id);
    const breadcrumb = book.categoryId
      ? await this.categoriesService.getBreadcrumb(book.categoryId)
      : [];
    return {
      id: book.id,
      slug: book.slug,
      title: book.title,
      isbn: book.isbn,
      price: book.price,
      discountPrice: book.discountPrice,
      discountEndDate: book.discountEndDate,
      avgRating: book.avgRating,
      reviewCount: book.reviewCount,
      stockQuantity: book.stockQuantity,
      status: book.status,
      primaryImage,
      authors,
      authorIds,
      publisher: book.publisher
        ? { id: book.publisher.id, name: book.publisher.name }
        : null,
      category: book.category
        ? { id: book.category.id, name: book.category.name }
        : null,
      language: book.language,
      yearPublished: book.yearPublished,
      description: book.description,
      pages: book.pages,
      dimensions: book.dimensions,
      weight: book.weight,
      images: sortedImages.map((i) => ({
        id: i.id,
        imageUrl: i.imageUrl,
        isPrimary: i.isPrimary,
        displayOrder: i.displayOrder,
      })),
      breadcrumb,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Create / Update / Delete
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateBookDto,
    files: Express.Multer.File[],
    adminId: string,
  ): Promise<BookDetail> {
    // Validate referenced entities up front for clearer errors.
    const [publisher, category, authors] = await Promise.all([
      this.publishers.findOne({ where: { id: dto.publisherId } }),
      this.categories.findOne({ where: { id: dto.categoryId } }),
      this.authors
        .createQueryBuilder('a')
        .whereInIds(dto.authorIds)
        .getMany(),
    ]);
    if (!publisher)
      throw new BadRequestException('Nhà xuất bản không tồn tại.');
    if (!category) throw new BadRequestException('Danh mục không tồn tại.');
    if (authors.length !== dto.authorIds.length) {
      throw new BadRequestException('Một hoặc nhiều tác giả không tồn tại.');
    }

    // Unique ISBN guard at service level (DB also enforces).
    const dupIsbn = await this.books.findOne({ where: { isbn: dto.isbn } });
    if (dupIsbn) {
      throw new ConflictException('ISBN đã tồn tại.');
    }

    const primaryIndex = Math.max(0, dto.primaryImageIndex ?? 0);
    if (files.length > 0 && primaryIndex >= files.length) {
      throw new BadRequestException('primaryImageIndex vượt quá số ảnh.');
    }

    return this.dataSource.transaction(async (manager) => {
      const base = toSlug(dto.title);
      const slug = await generateUniqueSlug(manager, Book, base);

      const book = manager.create(Book, {
        title: dto.title.trim(),
        slug,
        isbn: dto.isbn,
        publisherId: dto.publisherId,
        categoryId: dto.categoryId,
        language: dto.language ?? 'Tiếng Việt',
        yearPublished: dto.yearPublished ?? null,
        price: String(dto.price),
        discountPrice:
          dto.discountPrice !== undefined ? String(dto.discountPrice) : null,
        discountEndDate: dto.discountEndDate
          ? new Date(dto.discountEndDate)
          : null,
        description: dto.description ?? null,
        pages: dto.pages ?? null,
        dimensions: dto.dimensions ?? null,
        weight: dto.weight !== undefined ? String(dto.weight) : null,
        stockQuantity: dto.stockQuantity,
        status: dto.status ?? BookStatus.ACTIVE,
      });
      const saved = await manager.save(Book, book);

      // Authors
      const baEntities = dto.authorIds.map((authorId) =>
        manager.create(BookAuthor, { bookId: saved.id, authorId }),
      );
      if (baEntities.length > 0) await manager.save(BookAuthor, baEntities);

      // Images
      if (files.length > 0) {
        const imgs = files.map((f, idx) =>
          manager.create(BookImage, {
            bookId: saved.id,
            imageUrl: `/uploads/books/${f.filename}`,
            isPrimary: idx === primaryIndex,
            displayOrder: idx,
          }),
        );
        await manager.save(BookImage, imgs);
      }

      // Initial stock log
      if (dto.stockQuantity > 0) {
        const log = manager.create(StockLog, {
          bookId: saved.id,
          changeAmount: dto.stockQuantity,
          newQuantity: dto.stockQuantity,
          reason: StockReason.INITIAL_IMPORT,
          createdBy: adminId,
          note: 'Nhập kho ban đầu khi tạo sách.',
        });
        await manager.save(StockLog, log);
      }

      // Reload with relations
      const full = await manager.findOne(Book, {
        where: { id: saved.id },
        relations: {
          publisher: true,
          category: true,
          images: true,
          bookAuthors: { author: true },
        },
      });
      return this.toDetail(full!);
    });
  }

  async update(
    id: string,
    dto: UpdateBookDto,
    files: Express.Multer.File[],
    adminId: string,
  ): Promise<BookDetail> {
    const existing = await this.books.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Sách không tồn tại.');

    if (dto.publisherId) {
      const p = await this.publishers.findOne({
        where: { id: dto.publisherId },
      });
      if (!p) throw new BadRequestException('Nhà xuất bản không tồn tại.');
    }
    if (dto.categoryId) {
      const c = await this.categories.findOne({
        where: { id: dto.categoryId },
      });
      if (!c) throw new BadRequestException('Danh mục không tồn tại.');
    }
    if (dto.authorIds && dto.authorIds.length > 0) {
      const authors = await this.authors
        .createQueryBuilder('a')
        .whereInIds(dto.authorIds)
        .getMany();
      if (authors.length !== dto.authorIds.length) {
        throw new BadRequestException(
          'Một hoặc nhiều tác giả không tồn tại.',
        );
      }
    }
    if (dto.isbn && dto.isbn !== existing.isbn) {
      const dup = await this.books.findOne({ where: { isbn: dto.isbn } });
      if (dup) throw new ConflictException('ISBN đã tồn tại.');
    }

    const primaryIndex = Math.max(0, dto.primaryImageIndex ?? 0);
    if (files.length > 0 && primaryIndex >= files.length) {
      throw new BadRequestException('primaryImageIndex vượt quá số ảnh.');
    }

    return this.dataSource.transaction(async (manager) => {
      const book = await manager.findOne(Book, { where: { id } });
      if (!book) throw new NotFoundException('Sách không tồn tại.');

      const oldPrice = book.price;
      const oldStock = book.stockQuantity;

      if (dto.title !== undefined && dto.title.trim() !== book.title) {
        book.title = dto.title.trim();
        const base = toSlug(book.title);
        book.slug = await generateUniqueSlug(manager, Book, base, id);
      }
      if (dto.isbn !== undefined) book.isbn = dto.isbn;
      if (dto.publisherId !== undefined) book.publisherId = dto.publisherId;
      if (dto.categoryId !== undefined) book.categoryId = dto.categoryId;
      if (dto.language !== undefined) book.language = dto.language;
      if (dto.yearPublished !== undefined)
        book.yearPublished = dto.yearPublished;
      if (dto.price !== undefined) book.price = String(dto.price);
      if (dto.discountPrice !== undefined) {
        book.discountPrice = String(dto.discountPrice);
      }
      if (dto.discountEndDate !== undefined) {
        book.discountEndDate = dto.discountEndDate
          ? new Date(dto.discountEndDate)
          : null;
      }
      if (dto.description !== undefined) book.description = dto.description;
      if (dto.pages !== undefined) book.pages = dto.pages;
      if (dto.dimensions !== undefined) book.dimensions = dto.dimensions;
      if (dto.weight !== undefined) book.weight = String(dto.weight);
      if (dto.stockQuantity !== undefined)
        book.stockQuantity = dto.stockQuantity;
      if (dto.status !== undefined) book.status = dto.status;

      const saved = await manager.save(Book, book);

      // Price history
      if (dto.price !== undefined && String(dto.price) !== oldPrice) {
        const ph = manager.create(PriceHistory, {
          bookId: id,
          oldPrice,
          newPrice: String(dto.price),
        });
        await manager.save(PriceHistory, ph);
      }

      // Stock log on quantity change
      if (
        dto.stockQuantity !== undefined &&
        dto.stockQuantity !== oldStock
      ) {
        const delta = dto.stockQuantity - oldStock;
        const log = manager.create(StockLog, {
          bookId: id,
          changeAmount: delta,
          newQuantity: dto.stockQuantity,
          reason: StockReason.INITIAL_IMPORT,
          createdBy: adminId,
          note: 'Điều chỉnh tồn kho thủ công qua cập nhật sách.',
        });
        await manager.save(StockLog, log);
      }

      // Authors replace
      if (dto.authorIds) {
        await manager.delete(BookAuthor, { bookId: id });
        const entities = dto.authorIds.map((authorId) =>
          manager.create(BookAuthor, { bookId: id, authorId }),
        );
        if (entities.length > 0) await manager.save(BookAuthor, entities);
      }

      // Images replace
      // NOTE: we remove DB rows only; the uploaded files on disk are kept as
      // orphans to keep this MVP simple (no garbage collection pass yet).
      if (files.length > 0) {
        await manager.delete(BookImage, { bookId: id });
        const imgs = files.map((f, idx) =>
          manager.create(BookImage, {
            bookId: id,
            imageUrl: `/uploads/books/${f.filename}`,
            isPrimary: idx === primaryIndex,
            displayOrder: idx,
          }),
        );
        await manager.save(BookImage, imgs);
      }

      const full = await manager.findOne(Book, {
        where: { id: saved.id },
        relations: {
          publisher: true,
          category: true,
          images: true,
          bookAuthors: { author: true },
        },
      });
      return this.toDetail(full!);
    });
  }

  async softDelete(id: string): Promise<void> {
    const book = await this.books.findOne({ where: { id } });
    if (!book) throw new NotFoundException('Sách không tồn tại.');
    book.status = BookStatus.INACTIVE;
    await this.books.save(book);
  }
}
