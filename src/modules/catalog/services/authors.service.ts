import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Author } from '../../../database/entities/author.entity';
import { BookAuthor } from '../../../database/entities/book-author.entity';
import { CreateAuthorDto } from '../dto/create-author.dto';
import { UpdateAuthorDto } from '../dto/update-author.dto';

export interface AuthorView {
  id: string;
  name: string;
  biography: string | null;
  nationality: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

@Injectable()
export class AuthorsService {
  constructor(
    @InjectRepository(Author) private readonly authors: Repository<Author>,
    @InjectRepository(BookAuthor)
    private readonly bookAuthors: Repository<BookAuthor>,
  ) {}

  private toView(a: Author): AuthorView {
    return {
      id: a.id,
      name: a.name,
      biography: a.biography ?? null,
      nationality: a.nationality ?? null,
      avatarUrl: a.avatarUrl ?? null,
      createdAt: a.createdAt,
    };
  }

  async list(params: {
    keyword?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: AuthorView[];
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
    const [rows, total] = await this.authors.findAndCount({
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

  async get(id: string): Promise<AuthorView> {
    const a = await this.authors.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Tác giả không tồn tại.');
    return this.toView(a);
  }

  async create(
    dto: CreateAuthorDto,
    avatarUrl?: string,
  ): Promise<AuthorView> {
    const entity = this.authors.create({
      name: dto.name.trim(),
      biography: dto.biography ?? null,
      nationality: dto.nationality ?? null,
      avatarUrl: avatarUrl ?? dto.avatarUrl ?? null,
    });
    const saved = await this.authors.save(entity);
    return this.toView(saved);
  }

  async update(
    id: string,
    dto: UpdateAuthorDto,
    avatarUrl?: string,
  ): Promise<AuthorView> {
    const a = await this.authors.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Tác giả không tồn tại.');
    if (dto.name !== undefined) a.name = dto.name.trim();
    if (dto.biography !== undefined) a.biography = dto.biography || null;
    if (dto.nationality !== undefined) a.nationality = dto.nationality || null;
    if (avatarUrl) a.avatarUrl = avatarUrl;
    else if (dto.avatarUrl !== undefined)
      a.avatarUrl = dto.avatarUrl || null;
    const saved = await this.authors.save(a);
    return this.toView(saved);
  }

  async remove(id: string): Promise<void> {
    const a = await this.authors.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Tác giả không tồn tại.');
    const ref = await this.bookAuthors.count({ where: { authorId: id } });
    if (ref > 0) {
      throw new ConflictException(
        'Tác giả đang được liên kết với sách, không thể xoá.',
      );
    }
    await this.authors.delete({ id });
  }
}
