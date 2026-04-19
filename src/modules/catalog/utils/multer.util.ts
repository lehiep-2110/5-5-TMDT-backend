import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');

export function ensureUploadDirs(): void {
  const subs = ['books', 'authors', 'publishers'];
  if (!existsSync(UPLOADS_ROOT)) mkdirSync(UPLOADS_ROOT, { recursive: true });
  for (const s of subs) {
    const p = join(UPLOADS_ROOT, s);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function buildFilename(originalname: string): string {
  // sanitize original to keep only basename safe chars + keep extension.
  const ext = extname(originalname).toLowerCase();
  const base = originalname
    .replace(ext, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 40);
  return `${Date.now()}-${base || 'image'}${ext || '.jpg'}`;
}

export function buildImageUploader(subfolder: string): MulterOptions {
  ensureUploadDirs();
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dest = join(UPLOADS_ROOT, subfolder);
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        cb(null, buildFilename(file.originalname));
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB
    },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
        cb(
          new BadRequestException(
            'Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP.',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}
