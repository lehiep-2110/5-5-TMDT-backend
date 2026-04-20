import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { StaffListOrdersDto } from '../dto/list-query.dto';
import { ShipOrderDto } from '../dto/ship-order.dto';
import { OrdersService } from '../services/orders.service';

@Controller('staff/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.WAREHOUSE_STAFF, UserRole.ADMIN)
export class StaffOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query() query: StaffListOrdersDto) {
    return this.ordersService.staffList(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getForAdmin(id);
  }

  @Post(':id/pack')
  @HttpCode(HttpStatus.OK)
  pack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.staffPack(user.id, id);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  ship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipOrderDto,
  ) {
    return this.ordersService.staffShip(user.id, id, dto);
  }
}
