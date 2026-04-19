import slugify from 'slugify';
import { EntityManager, Not, ObjectLiteral } from 'typeorm';
import type { EntityTarget } from 'typeorm';

/**
 * Convert an arbitrary Vietnamese string into a URL-safe slug.
 * Lowercase, strict (only [a-z0-9-]), locale vi to handle diacritics.
 */
export function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, locale: 'vi' });
}

/**
 * Generate a unique slug for a given entity. If `base` is already taken, try
 * base-2, base-3, ... until a free value is found.
 *
 * @param manager      TypeORM EntityManager
 * @param entity       entity class
 * @param base         the candidate slug (already slugified)
 * @param excludeId    optional id to exclude when checking (update case)
 */
export async function generateUniqueSlug<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  base: string,
  excludeId?: string,
): Promise<string> {
  const repo = manager.getRepository(entity);
  let candidate = base || 'item';
  let suffix = 2;
  while (true) {
    const where: any = { slug: candidate };
    if (excludeId) {
      where.id = Not(excludeId);
    }
    const existing = await repo.findOne({ where });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}
