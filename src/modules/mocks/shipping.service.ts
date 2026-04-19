import { Injectable, Logger } from '@nestjs/common';
import { Address } from '../../database/entities/address.entity';
import { Order } from '../../database/entities/order.entity';

export interface ShippingQuote {
  fee: number;
  estimatedDays: number;
  carrier: 'GHN';
}

export interface ShipmentCreation {
  trackingNumber: string;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  // TODO: Phase 2: tích hợp GHN API thật.
  async calculateFee(
    _address: Address,
    _subtotal: number,
  ): Promise<ShippingQuote> {
    return { fee: 30000, estimatedDays: 3, carrier: 'GHN' };
  }

  // TODO: Phase 2: tích hợp GHN API thật (UC-21).
  async createShipment(order: Order): Promise<ShipmentCreation> {
    const trackingNumber = `GHN${Date.now()}`;
    this.logger.log(
      `[MOCK SHIPPING] Created shipment for order ${order.orderCode} — tracking ${trackingNumber}`,
    );
    return { trackingNumber };
  }
}
