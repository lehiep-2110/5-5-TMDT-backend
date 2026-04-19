import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';
import { Book } from '../../../database/entities/book.entity';
import { Publisher } from '../../../database/entities/publisher.entity';
import { CreatePublisherDto } from '../dto/create-publisher.dto';
import { UpdatePublisherDto } from '../dto/update-publisher.dto';

export interface PublisherView {
  id: string;
  name: string;
  address: string | null;
  website: string | null;
  logoUrl: string | null;
  createdAt: Date;
}

@Injectable()
export class PublishersService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
  ) {}

  private toView(p: Publisher): PublisherView {
    return {
      id: p.id,
      name: p.name,
      address: p.address ?? null,
      website: p.website ?? null,
      logoUrl: p.logoUrl ?? null,
      createdAt: p.createdAt,
    };
  }

  async list(params: {
    keyword?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: PublisherView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const where = params.keyword
      ? { name: ILike(`%${params.keyword}%`) }
      : {};
    const [rows, total] = await this.publishers.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: rows.map((r) => this.toView(r)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async get(id: string): Promise<PublisherView> {
    const p = await this.publishers.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Nhà xuất bản không tồn tại.');
    return this.toView(p);
  }

  async create(
    dto: CreatePublisherDto,
    logoUrl?: string,
  ): Promise<PublisherView> {
    const trimmed = dto.name.trim();
    const dup = await this.publishers.findOne({ where: { name: trimmed } });
    if (dup) {
      throw new ConflictException('Tên nhà xuất bản đã tồn tại.');
    }
    const entity = this.publishers.create({
      name: trimmed,
      address: dto.address ?? null,
      website: dto.website ?? null,
      logoUrl: logoUrl ?? dto.logoUrl ?? null,
    });
    const saved = await this.publishers.save(entity);
    return this.toView(saved);
  }

  async update(
    id: string,
    dto: UpdatePublisherDto,
    logoUrl?: string,
  ): Promise<PublisherView> {
    const p = await this.publishers.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Nhà xuất bản không tồn tại.');
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      const dup = await this.publishers.findOne({
        where: { name: trimmed, id: Not(id) },
      });
      if (dup) {
        throw new ConflictException('Tên nhà xuất bản đã tồn tại.');
      }
      p.name = trimmed;
    }
    if (dto.address !== undefined) p.address = dto.address || null;
    if (dto.website !== undefined) p.website = dto.website || null;
    if (logoUrl) p.logoUrl = logoUrl;
    else if (dto.logoUrl !== undefined) p.logoUrl = dto.logoUrl || null;
    const saved = await this.publishers.save(p);
    return this.toView(saved);
  }

  async remove(id: string): Promise<void> {
    const p = await this.publishers.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Nhà xuất bản không tồn tại.');
    const ref = await this.books.count({ where: { publisherId: id } });
    if (ref > 0) {
      throw new ConflictException(
        'Nhà xuất bản đang có sách, không thể xoá.',
      );
    }
    await this.publishers.delete({ id });
  }
}
