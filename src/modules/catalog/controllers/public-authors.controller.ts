import { Controller, Get, Query } from '@nestjs/common';
import { AuthorsService } from '../services/authors.service';

@Controller('authors')
export class PublicAuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get()
  list(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.authorsService.list({
      keyword,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
