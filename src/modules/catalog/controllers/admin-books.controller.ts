import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { CreateBookDto } from '../dto/create-book.dto';
import { AdminQueryBooksDto } from '../dto/query-books.dto';
import { UpdateBookDto } from '../dto/update-book.dto';
import { BooksService } from '../services/books.service';
import { buildImageUploader } from '../utils/multer.util';

@Controller('admin/books')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  list(@Query() query: AdminQueryBooksDto) {
    return this.booksService.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.getByIdAdmin(id);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('images', 5, buildImageUploader('books')))
  create(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: CreateBookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.booksService.create(dto, files ?? [], user.id);
  }

  @Patch(':id')
  @UseInterceptors(FilesInterceptor('images', 5, buildImageUploader('books')))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UpdateBookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.booksService.update(id, dto, files ?? [], user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.booksService.softDelete(id);
    return { message: 'Đã ẩn sách (chuyển trạng thái sang INACTIVE).' };
  }
}
