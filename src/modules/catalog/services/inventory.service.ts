import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { StockReason } from '../../../common/enums/stock-reason.enum';
import { Book } from '../../../database/entities/book.entity';
import { StockLog } from '../../../database/entities/stock-log.entity';
import { RestockDto } from '../dto/restock.dto';

export const LOW_STOCK_THRESHOLD = 10;

export interface InventoryItem {
  id: string;
  title: string;
  isbn: string;
  slug: string;
  stockQuantity: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  status: string;
  updatedAt: Date;
}

export interface StockLogView {
  id: string;
  bookId: string;
  changeAmount: number;
  newQuantity: number;
  reason: StockReason;
  orderId: string | null;
  note: string | null;
  createdAt: Date;
  actor: { id: string; fullName: string } | null;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Book) private readonly books: Repository<Book>,
    @InjectRepository(StockLog)
    private readonly stockLogs: Repository<StockLog>,
    private readonly dataSource: DataSource,
  ) {}

  async list(params: {
    keyword?: string;
    lowStockOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    items: InventoryItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));

    const qb = this.books.createQueryBuilder('b');
    if (params.keyword) {
      qb.andWhere('(b.title ILIKE :kw OR b.isbn ILIKE :kw)', {
        kw: `%${params.keyword}%`,
      });
    }
    if (params.lowStockOnly === true || String(params.lowStockOnly) === 'true') {
      qb.andWhere('b.stock_quantity < :thr', { thr: LOW_STOCK_THRESHOLD });
    }
    qb.orderBy('b.stock_quantity', 'ASC').addOrderBy('b.title', 'ASC');
    qb.skip((page - 1) * limit).take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const items: InventoryItem[] = rows.map((b) => ({
      id: b.id,
      title: b.title,
      isbn: b.isbn,
      slug: b.slug,
      stockQuantity: b.stockQuantity,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      isLowStock: b.stockQuantity < LOW_STOCK_THRESHOLD,
      status: b.status,
      updatedAt: b.updatedAt,
    }));
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async listLogs(
    bookId: string,
    params: { page?: number; limit?: number },
  ): Promise<{
    items: StockLogView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const book = await this.books.findOne({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Sách không tồn tại.');

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));

    const [rows, total] = await this.stockLogs.findAndCount({
      where: { bookId },
      relations: { createdByUser: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const items: StockLogView[] = rows.map((l) => ({
      id: l.id,
      bookId: l.bookId,
      changeAmount: l.changeAmount,
      newQuantity: l.newQuantity,
      reason: l.reason,
      orderId: l.orderId,
      note: l.note,
      createdAt: l.createdAt,
      actor: l.createdByUser
        ? { id: l.createdByUser.id, fullName: l.createdByUser.fullName }
        : null,
    }));
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async restock(
    bookId: string,
    dto: RestockDto,
    actorId: string,
  ): Promise<{
    bookId: string;
    stockQuantity: number;
    logId: string;
  }> {
    if (dto.quantity <= 0) {
      throw new BadRequestException('quantity phải lớn hơn 0.');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const book = await manager
        .createQueryBuilder(Book, 'b')
        .setLock('pessimistic_write')
        .where('b.id = :id', { id: bookId })
        .getOne();
      if (!book) throw new NotFoundException('Sách không tồn tại.');
      const newQty = book.stockQuantity + dto.quantity;
      book.stockQuantity = newQty;
      await manager.save(Book, book);

      const log = manager.create(StockLog, {
        bookId: book.id,
        changeAmount: dto.quantity,
        newQuantity: newQty,
        reason: StockReason.PURCHASE,
        createdBy: actorId,
        note: dto.note ?? null,
      });
      const savedLog = await manager.save(StockLog, log);
      return { bookId: book.id, stockQuantity: newQty, logId: savedLog.id };
    });
    return result;
  }
}
