import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookAuthor } from '../../database/entities/book-author.entity';
import { BookImage } from '../../database/entities/book-image.entity';
import { Book } from '../../database/entities/book.entity';
import { Wishlist } from '../../database/entities/wishlist.entity';
import { AuthModule } from '../auth/auth.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wishlist, Book, BookImage, BookAuthor]),
    AuthModule,
  ],
  controllers: [WishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistModule {}
