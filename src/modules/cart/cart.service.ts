import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookStatus } from '../../common/enums/book-status.enum';
import { BookImage } from '../../database/entities/book-image.entity';
import { Book } from '../../database/entities/book.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

const MAX_QTY_PER_ITEM = 10;

export interface CartItemView {
  id: string;
  bookId: string;
  quantity: number;
  outOfStock: boolean;
  book: {
    id: string;
    slug: string;
    title: string;
    price: string;
    discountPrice: string | null;
    stockQuantity: number;
    primaryImage: string | null;
    status: BookStatus;
  };
}

export interface CartView {
  items: CartItemView[];
  subtotal: number;
  itemCount: number;
}

function effectivePrice(book: Book): number {
  if (book.discountPrice) {
    const end = book.discountEndDate;
    if (!end || end.getTime() > Date.now()) {
      return Number(book.discountPrice);
    }
  }
  return Number(book.price);
}

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
    @InjectRepository(BookImage)
    private readonly bookImages: Repository<BookImage>,
  ) {}

  async getCart(userId: string): Promise<CartView> {
    const rows = await this.cartItems.find({
      where: { userId },
      relations: { book: true },
      order: { createdAt: 'ASC' },
    });

    // Filter out items whose book is no longer ACTIVE.
    const activeRows = rows.filter(
      (r) => r.book && r.book.status === BookStatus.ACTIVE,
    );

    const bookIds = activeRows.map((r) => r.bookId);
    const primaryByBook = await this.fetchPrimaryImages(bookIds);

    let subtotal = 0;
    let itemCount = 0;
    const items: CartItemView[] = activeRows.map((r) => {
      const price = effectivePrice(r.book!);
      subtotal += price * r.quantity;
      itemCount += r.quantity;
      return {
        id: r.id,
        bookId: r.bookId,
        quantity: r.quantity,
        outOfStock: r.quantity > (r.book!.stockQuantity ?? 0),
        book: {
          id: r.book!.id,
          slug: r.book!.slug,
          title: r.book!.title,
          price: r.book!.price,
          discountPrice: r.book!.discountPrice,
          stockQuantity: r.book!.stockQuantity,
          primaryImage: primaryByBook.get(r.bookId) ?? null,
          status: r.book!.status,
        },
      };
    });

    return { items, subtotal, itemCount };
  }

  async addItem(userId: string, dto: AddItemDto): Promise<CartView> {
    const book = await this.books.findOne({ where: { id: dto.bookId } });
    if (!book) throw new NotFoundException('Sách không tồn tại.');
    if (book.status !== BookStatus.ACTIVE) {
      throw new BadRequestException(
        'Sách không còn được bán, không thể thêm vào giỏ.',
      );
    }
    if (book.stockQuantity <= 0) {
      throw new BadRequestException('Sách đã hết hàng.');
    }

    const existing = await this.cartItems.findOne({
      where: { userId, bookId: dto.bookId },
    });

    const desired = (existing?.quantity ?? 0) + dto.quantity;
    const capped = Math.min(desired, MAX_QTY_PER_ITEM, book.stockQuantity);

    if (existing) {
      existing.quantity = capped;
      await this.cartItems.save(existing);
    } else {
      const entity = this.cartItems.create({
        userId,
        bookId: dto.bookId,
        quantity: capped,
      });
      await this.cartItems.save(entity);
    }

    return this.getCart(userId);
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<CartView> {
    const item = await this.cartItems.findOne({
      where: { id: itemId },
      relations: { book: true },
    });
    if (!item) throw new NotFoundException('Mục giỏ hàng không tồn tại.');
    if (item.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền sửa mục này.');
    }

    if (dto.quantity === 0) {
      await this.cartItems.delete({ id: itemId });
      return this.getCart(userId);
    }

    const stock = item.book?.stockQuantity ?? 0;
    const capped = Math.min(dto.quantity, MAX_QTY_PER_ITEM, stock);
    if (capped <= 0) {
      throw new BadRequestException('Sách đã hết hàng.');
    }
    item.quantity = capped;
    await this.cartItems.save(item);
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const item = await this.cartItems.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Mục giỏ hàng không tồn tại.');
    if (item.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xoá mục này.');
    }
    await this.cartItems.delete({ id: itemId });
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<CartView> {
    await this.cartItems.delete({ userId });
    return this.getCart(userId);
  }

  private async fetchPrimaryImages(
    bookIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (bookIds.length === 0) return map;
    const images = await this.bookImages
      .createQueryBuilder('i')
      .where('i.book_id IN (:...ids)', { ids: bookIds })
      .orderBy('i.is_primary', 'DESC')
      .addOrderBy('i.display_order', 'ASC')
      .getMany();
    for (const img of images) {
      if (!map.has(img.bookId)) {
        map.set(img.bookId, img.imageUrl);
      }
    }
    return map;
  }
}
