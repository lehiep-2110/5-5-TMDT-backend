// UC-20 + UC-21 — Staff packaging & shipping
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  loginStaff,
  pickAddressId,
  pickBookIds,
  run,
} from './helpers-b.mjs';

async function placeCodOrder({ token, addressId, bookIds }) {
  await api('DELETE', '/cart', { token, expectStatus: 200 });
  for (const id of bookIds) {
    await api('POST', '/cart/items', {
      token,
      body: { bookId: id, quantity: 1 },
      expectStatus: 201,
    });
  }
  const r = await api('POST', '/orders', {
    token,
    body: { addressId, paymentMethod: 'COD' },
  });
  if (r.status !== 201) {
    throw new Error(`placeCodOrder failed: ${r.status} ${r.text.slice(0, 200)}`);
  }
  return r.json.data;
}

export async function staffSuite() {
  const { token: customer } = await loginCustomer1();
  const { token: staff } = await loginStaff();
  const { token: admin } = await loginAdmin();
  const addressId = await pickAddressId(customer);

  // Shared state across tests
  const ctx = { packedOrderId: null };

  const tests = [
    {
      name: 'staff-list-confirmed-fifo',
      fn: async () => {
        const [bookId] = await pickBookIds(customer, 1);
        const order = await placeCodOrder({
          token: customer,
          addressId,
          bookIds: [bookId],
        });
        const list = await api('GET', '/staff/orders', {
          token: staff,
          expectStatus: 200,
        });
        const items = list.json?.data?.items ?? [];
        const found = items.find((o) => o.id === order.id);
        assert(found, 'fresh CONFIRMED order present in staff list');
        for (const o of items) {
          assertEq(o.status, 'CONFIRMED', 'all listed are CONFIRMED');
        }
      },
    },
    {
      name: 'staff-pack',
      fn: async () => {
        const [bookId] = await pickBookIds(customer, 1);
        const order = await placeCodOrder({
          token: customer,
          addressId,
          bookIds: [bookId],
        });
        const r = await api('POST', `/staff/orders/${order.id}/pack`, {
          token: staff,
        });
        assertEq(r.status, 200, 'pack 200');
        assertEq(r.json.data.status, 'PROCESSING', 'status PROCESSING');
        const logs = r.json.data.statusLogs ?? [];
        const packLog = logs.find((l) => l.toStatus === 'PROCESSING');
        assert(packLog, 'status log entry present');

        // verify customer notification ORDER_PROCESSING
        const notif = await api('GET', '/notifications?limit=20', {
          token: customer,
          expectStatus: 200,
        });
        const items =
          notif.json?.data?.items ??
          (Array.isArray(notif.json?.data) ? notif.json.data : []);
        const processing = items.find(
          (n) =>
            n.type === 'ORDER_PROCESSING' && (n.link ?? '').includes(order.id),
        );
        assert(processing, 'ORDER_PROCESSING notification recorded');
        ctx.packedOrderId = order.id;
      },
    },
    {
      name: 'staff-pack-wrong-status',
      fn: async () => {
        // Create order then transition to DELIVERED, then attempt pack
        const [bookId] = await pickBookIds(customer, 1);
        const order = await placeCodOrder({
          token: customer,
          addressId,
          bookIds: [bookId],
        });
        for (const next of ['PROCESSING', 'SHIPPING', 'DELIVERED']) {
          await api('PATCH', `/admin/orders/${order.id}/status`, {
            token: admin,
            body: { toStatus: next },
            expectStatus: 200,
          });
        }
        const r = await api('POST', `/staff/orders/${order.id}/pack`, {
          token: staff,
        });
        assertEq(r.status, 400, 'pack on DELIVERED rejected');
      },
    },
    {
      name: 'staff-ship-happy',
      fn: async () => {
        assert(ctx.packedOrderId, 'staff-pack must run first');
        const tracking = `GHN-E2E-${Date.now()}`;
        const r = await api(
          'POST',
          `/staff/orders/${ctx.packedOrderId}/ship`,
          {
            token: staff,
            body: { carrier: 'GHN', trackingNumber: tracking },
          },
        );
        assertEq(r.status, 200, 'ship 200');
        assertEq(r.json.data.status, 'SHIPPING', 'status SHIPPING');
        assertEq(r.json.data.carrier, 'GHN', 'carrier persisted');
        assertEq(
          r.json.data.trackingNumber,
          tracking,
          'trackingNumber persisted',
        );
        // notification
        const notif = await api('GET', '/notifications?limit=20', {
          token: customer,
          expectStatus: 200,
        });
        const items =
          notif.json?.data?.items ??
          (Array.isArray(notif.json?.data) ? notif.json.data : []);
        const shipping = items.find(
          (n) =>
            n.type === 'ORDER_SHIPPING' &&
            (n.link ?? '').includes(ctx.packedOrderId),
        );
        assert(shipping, 'ORDER_SHIPPING notification recorded');
      },
    },
    {
      name: 'staff-ship-validation',
      fn: async () => {
        // Build a freshly-packed order
        const [bookId] = await pickBookIds(customer, 1);
        const order = await placeCodOrder({
          token: customer,
          addressId,
          bookIds: [bookId],
        });
        await api('POST', `/staff/orders/${order.id}/pack`, {
          token: staff,
          expectStatus: 200,
        });
        const r = await api('POST', `/staff/orders/${order.id}/ship`, {
          token: staff,
          body: { carrier: 'GHN', trackingNumber: '' },
        });
        assertEq(r.status, 400, 'empty trackingNumber rejected');
      },
    },
    {
      name: 'customer-cannot-pack-or-ship',
      fn: async () => {
        const list = await api('GET', '/staff/orders', { token: customer });
        assertEq(list.status, 403, 'customer GET /staff/orders 403');
      },
    },
  ];

  return run('UC-20 + UC-21 Staff', tests);
}
