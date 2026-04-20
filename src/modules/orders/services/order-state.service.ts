import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * Allowed state transitions (without actor checks).
 *
 * PENDING    -> CONFIRMED | CANCELLED
 * CONFIRMED  -> PROCESSING | CANCELLED
 * PROCESSING -> SHIPPING | CANCELLED
 * SHIPPING   -> DELIVERED
 * DELIVERED  -> COMPLETED
 *
 * CANCELLED and COMPLETED are terminal. PAID is unused in MVP.
 */
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.PAID]: [],
};

@Injectable()
export class OrderStateService {
  isValidBaseTransition(from: OrderStatus, to: OrderStatus): boolean {
    const next = ALLOWED[from];
    if (!next) return false;
    return next.includes(to);
  }

  /**
   * Validates that `actorRole` is allowed to drive the transition.
   * Throws a BadRequestException with a Vietnamese message on failure.
   */
  assertCanTransition(
    from: OrderStatus,
    to: OrderStatus,
    actorRole: UserRole,
  ): void {
    if (!this.isValidBaseTransition(from, to)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái đơn từ ${from} sang ${to}.`,
      );
    }

    switch (actorRole) {
      case UserRole.ADMIN: {
        // Admin may drive any listed transition.
        return;
      }
      case UserRole.WAREHOUSE_STAFF: {
        // Staff may: confirm packaging (CONFIRMED -> PROCESSING) and hand off
        // to the carrier (PROCESSING -> SHIPPING).
        if (
          from === OrderStatus.CONFIRMED &&
          to === OrderStatus.PROCESSING
        ) {
          return;
        }
        if (
          from === OrderStatus.PROCESSING &&
          to === OrderStatus.SHIPPING
        ) {
          return;
        }
        throw new BadRequestException(
          'Nhân viên kho chỉ được xác nhận đóng gói hoặc bàn giao vận chuyển.',
        );
      }
      case UserRole.CUSTOMER: {
        // Customer may only cancel while PENDING or CONFIRMED.
        if (
          to === OrderStatus.CANCELLED &&
          (from === OrderStatus.PENDING || from === OrderStatus.CONFIRMED)
        ) {
          return;
        }
        throw new BadRequestException(
          'Khách hàng chỉ có thể huỷ đơn khi đơn đang chờ xác nhận hoặc đã xác nhận.',
        );
      }
      default:
        throw new BadRequestException('Vai trò không có quyền thao tác.');
    }
  }
}
