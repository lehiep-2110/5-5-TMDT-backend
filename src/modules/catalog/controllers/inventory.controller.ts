import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  ListInventoryDto,
  ListStockLogsDto,
  RestockDto,
} from '../dto/restock.dto';
import { InventoryService } from '../services/inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  list(@Query() query: ListInventoryDto) {
    return this.inventoryService.list(query);
  }

  @Get(':bookId/logs')
  listLogs(
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Query() query: ListStockLogsDto,
  ) {
    return this.inventoryService.listLogs(bookId, query);
  }

  @Post(':bookId/restock')
  restock(
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Body() dto: RestockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.restock(bookId, dto, user.id);
  }
}
