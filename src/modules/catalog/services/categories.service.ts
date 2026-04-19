import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Book } from '../../../database/entities/book.entity';
import { Category } from '../../../database/entities/category.entity';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { generateUniqueSlug, toSlug } from '../utils/slug.util';

export interface CategoryFlatView {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface CategoryTreeView extends CategoryFlatView {
  children: CategoryTreeView[];
}

export interface CategoryBreadcrumb {
  id: string;
  name: string;
  slug: string;
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Book) private readonly books: Repository<Book>,
    private readonly dataSource: DataSource,
  ) {}

  private toFlat(c: Category): CategoryFlatView {
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId ?? null,
      description: c.description ?? null,
      imageUrl: c.imageUrl ?? null,
      isActive: c.isActive,
      displayOrder: c.displayOrder,
    };
  }

  /** Build a tree from a flat list. Roots are items with null parentId. */
  private buildTree(items: CategoryFlatView[]): CategoryTreeView[] {
    const byId = new Map<string, CategoryTreeView>();
    const roots: CategoryTreeView[] = [];
    for (const item of items) {
      byId.set(item.id, { ...item, children: [] });
    }
    for (const item of items) {
      const node = byId.get(item.id)!;
      if (item.parentId && byId.has(item.parentId)) {
        byId.get(item.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortFn = (a: CategoryTreeView, b: CategoryTreeView) =>
      a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'vi');
    const sortAll = (nodes: CategoryTreeView[]): void => {
      nodes.sort(sortFn);
      for (const n of nodes) sortAll(n.children);
    };
    sortAll(roots);
    return roots;
  }

  async publicTree(): Promise<CategoryTreeView[]> {
    const rows = await this.categories.find({ where: { isActive: true } });
    return this.buildTree(rows.map((r) => this.toFlat(r)));
  }

  async adminTree(): Promise<CategoryTreeView[]> {
    const rows = await this.categories.find();
    return this.buildTree(rows.map((r) => this.toFlat(r)));
  }

  async adminFlatList(): Promise<CategoryFlatView[]> {
    const rows = await this.categories.find({
      order: { displayOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((r) => this.toFlat(r));
  }

  async get(id: string): Promise<CategoryFlatView> {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Danh mục không tồn tại.');
    return this.toFlat(c);
  }

  /**
   * Returns all descendant ids of a given category (including the category
   * itself) using a recursive CTE. Used by the books listing when filtering
   * by category.
   */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id FROM categories c
         INNER JOIN tree t ON c.parent_id = t.id
       )
       SELECT id FROM tree`,
      [categoryId],
    );
    return rows.map((r) => r.id);
  }

  /**
   * Breadcrumb from root down to the given category (inclusive).
   */
  async getBreadcrumb(categoryId: string): Promise<CategoryBreadcrumb[]> {
    const rows: Array<{
      id: string;
      name: string;
      slug: string;
      depth: number;
    }> = await this.dataSource.query(
      `WITH RECURSIVE chain AS (
         SELECT id, name, slug, parent_id, 0 AS depth
         FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id, c.name, c.slug, c.parent_id, chain.depth + 1
         FROM categories c
         INNER JOIN chain ON c.id = chain.parent_id
       )
       SELECT id, name, slug, depth FROM chain ORDER BY depth DESC`,
      [categoryId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
  }

  async create(dto: CreateCategoryDto): Promise<CategoryFlatView> {
    if (dto.parentId) {
      const parent = await this.categories.findOne({
        where: { id: dto.parentId },
      });
      if (!parent)
        throw new BadRequestException('Danh mục cha không tồn tại.');
    }
    return this.dataSource.transaction(async (manager) => {
      const base = toSlug(dto.name);
      const slug = await generateUniqueSlug(manager, Category, base);
      const entity = manager.create(Category, {
        name: dto.name.trim(),
        slug,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      });
      const saved = await manager.save(Category, entity);
      return this.toFlat(saved);
    });
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryFlatView> {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Danh mục không tồn tại.');

    // Detect cycle for parent change: new parent must not be the node itself
    // or any of its descendants.
    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          'Không thể đặt danh mục làm cha của chính nó.',
        );
      }
      const descendants = await this.getDescendantIds(id);
      if (descendants.includes(dto.parentId)) {
        throw new BadRequestException(
          'Không thể đặt danh mục con làm cha (tạo vòng lặp).',
        );
      }
      const parent = await this.categories.findOne({
        where: { id: dto.parentId },
      });
      if (!parent)
        throw new BadRequestException('Danh mục cha không tồn tại.');
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.name !== undefined) {
        const trimmed = dto.name.trim();
        if (trimmed !== c.name) {
          c.name = trimmed;
          const base = toSlug(trimmed);
          c.slug = await generateUniqueSlug(manager, Category, base, id);
        }
      }
      if (dto.parentId !== undefined) c.parentId = dto.parentId;
      if (dto.description !== undefined)
        c.description = dto.description || null;
      if (dto.imageUrl !== undefined) c.imageUrl = dto.imageUrl || null;
      if (dto.displayOrder !== undefined) c.displayOrder = dto.displayOrder;
      if (dto.isActive !== undefined) c.isActive = dto.isActive;
      const saved = await manager.save(Category, c);
      return this.toFlat(saved);
    });
  }

  async remove(id: string): Promise<void> {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Danh mục không tồn tại.');
    const childrenCount = await this.categories.count({
      where: { parentId: id },
    });
    if (childrenCount > 0) {
      throw new ConflictException(
        'Danh mục đang chứa danh mục con, không thể xoá.',
      );
    }
    const bookCount = await this.books.count({ where: { categoryId: id } });
    if (bookCount > 0) {
      throw new ConflictException(
        'Danh mục đang chứa sách, không thể xoá.',
      );
    }
    await this.categories.delete({ id });
  }
}
