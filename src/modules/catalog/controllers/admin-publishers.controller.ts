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
import { CreatePublisherDto } from '../dto/create-publisher.dto';
import { UpdatePublisherDto } from '../dto/update-publisher.dto';
import { PublishersService } from '../services/publishers.service';
import { buildImageUploader } from '../utils/multer.util';

@Controller('admin/publishers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPublishersController {
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

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishersService.get(id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('logo', buildImageUploader('publishers')))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreatePublisherDto,
  ) {
    const logoUrl = file ? `/uploads/publishers/${file.filename}` : undefined;
    return this.publishersService.create(dto, logoUrl);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('logo', buildImageUploader('publishers')))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpdatePublisherDto,
  ) {
    const logoUrl = file ? `/uploads/publishers/${file.filename}` : undefined;
    return this.publishersService.update(id, dto, logoUrl);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.publishersService.remove(id);
    return { message: 'Đã xoá nhà xuất bản.' };
  }
}
