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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CreateAuthorDto } from '../dto/create-author.dto';
import { UpdateAuthorDto } from '../dto/update-author.dto';
import { AuthorsService } from '../services/authors.service';
import { buildImageUploader } from '../utils/multer.util';

@Controller('admin/authors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuthorsController {
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

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.authorsService.get(id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('avatar', buildImageUploader('authors')))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateAuthorDto,
  ) {
    const avatarUrl = file ? `/uploads/authors/${file.filename}` : undefined;
    return this.authorsService.create(dto, avatarUrl);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('avatar', buildImageUploader('authors')))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpdateAuthorDto,
  ) {
    const avatarUrl = file ? `/uploads/authors/${file.filename}` : undefined;
    return this.authorsService.update(id, dto, avatarUrl);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.authorsService.remove(id);
    return { message: 'Đã xoá tác giả.' };
  }
}
