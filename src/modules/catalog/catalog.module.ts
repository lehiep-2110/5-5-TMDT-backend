import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Author } from '../../database/entities/author.entity';
import { BookAuthor } from '../../database/entities/book-author.entity';
import { BookImage } from '../../database/entities/book-image.entity';
import { Book } from '../../database/entities/book.entity';
import { Category } from '../../database/entities/category.entity';
import { PriceHistory } from '../../database/entities/price-history.entity';
import { Publisher } from '../../database/entities/publisher.entity';
import { StockLog } from '../../database/entities/stock-log.entity';
import { User } from '../../database/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthorsController } from './controllers/admin-authors.controller';
import { AdminBooksController } from './controllers/admin-books.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminPublishersController } from './controllers/admin-publishers.controller';
import { InventoryController } from './controllers/inventory.controller';
import { PublicAuthorsController } from './controllers/public-authors.controller';
import { PublicBooksController } from './controllers/public-books.controller';
import { PublicCategoriesController } from './controllers/public-categories.controller';
import { PublicPublishersController } from './controllers/public-publishers.controller';
import { AuthorsService } from './services/authors.service';
import { BooksService } from './services/books.service';
import { CategoriesService } from './services/categories.service';
import { InventoryService } from './services/inventory.service';
import { PublishersService } from './services/publishers.service';
import { ensureUploadDirs } from './utils/multer.util';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Book,
      BookImage,
      BookAuthor,
      Author,
      Publisher,
      Category,
      PriceHistory,
      StockLog,
      User,
    ]),
    AuthModule,
  ],
  controllers: [
    PublicBooksController,
    PublicCategoriesController,
    PublicAuthorsController,
    PublicPublishersController,
    AdminBooksController,
    AdminAuthorsController,
    AdminPublishersController,
    AdminCategoriesController,
    InventoryController,
  ],
  providers: [
    BooksService,
    AuthorsService,
    PublishersService,
    CategoriesService,
    InventoryService,
  ],
  exports: [
    BooksService,
    AuthorsService,
    PublishersService,
    CategoriesService,
    InventoryService,
  ],
})
export class CatalogModule implements OnModuleInit {
  onModuleInit(): void {
    // Make sure upload folders exist before multer is asked to write there.
    ensureUploadDirs();
  }
}
