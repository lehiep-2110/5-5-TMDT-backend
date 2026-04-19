import { Controller, Get, Query } from '@nestjs/common';
import { PublishersService } from '../services/publishers.service';

@Controller('publishers')
export class PublicPublishersController {
  constructor(private readonly publishersService: PublishersService) {}

  @Get()
  list(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.publishersService.list({
      keyword,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
