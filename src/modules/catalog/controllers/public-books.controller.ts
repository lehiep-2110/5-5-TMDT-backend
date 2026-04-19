import { Controller, Get, Param, Query } from '@nestjs/common';
import { QueryBooksDto } from '../dto/query-books.dto';
import { BooksService } from '../services/books.service';

@Controller('books')
export class PublicBooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  list(@Query() query: QueryBooksDto) {
    return this.booksService.listPublic(query);
  }

  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.booksService.getBySlug(slug);
  }
}
