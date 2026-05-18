// UC-05 (COD), UC-06, UC-14
import {
  api,
  assert,
  assertEq,
  getBookAdmin,
  loginAdmin,
  loginCustomer1,
  pickAddressId,
  pickBookIds,
  pickBooks,
  run,
} from './helpers-b.mjs';

async function placeCodOrder({ token, addressId, bookIds }) {
  await api('DELETE', '/cart', { token, expectStatus: 200 });
  for (const bookId of bookIds) {
    await api('POST', '/cart/items', {
      token,
      body: { bookId, quantity: 1 },
      expectStatus: 201,
    });
  }
  const create = await api('POST', '/orders', {
    token,
    body: { addressId, paymentMethod: 'COD' },
  });
  if (create.status !== 201) {
    throw new Error(
      `placeCodOrder failed: ${create.status} ${create.text.slice(0, 200)}`,
    );
  }
  return create.json.data;
}

export async function ordersCodSuite() {
  const { token } = await loginCustomer1();
  const { token: adminToken } = await loginAdmin();
  const addressId = await pickAddressId(token);

  // shared state for chained tests
  let happyOrder = null;

  const tests = [
    {
      name: 'place-cod-happy',
      fn: async () => {
        const [a, b] = await pickBookIds(token, 2);
        const before = [
          await getBookAdmin(adminToken, a),
          await getBookAdmin(adminToken, b),
        ];
        const order = await placeCodOrder({
          token,
          addressId,
          bookIds: [a, b],
        });
        happyOrder = { id: order.id, beforeStock: before, bookIds: [a, b] };
        assertEq(order.status, 'CONFIRMED', 'order status');
        assertEq(order.paymentStatus, 'UNPAID', 'paymentStatus');
        assert(/^ORD/.test(order.orderCode), 'orderCode like ORD...');
        assert(order.orderCode.length >= 9, 'orderCode reasonable length');
        // cart cleared
        const cart = await api('GET', '/cart', { token, expectStatus: 200 });
        assertEq(cart.json.data.items.length, 0, 'cart cleared after order');
      },
    },
    {
      name: 'cod-stock-decreased',
      fn: async () => {
        assert(happyOrder, 'previous test must succeed');
        const [a, b] = happyOrder.bookIds;
        const after = [
          await getBookAdmin(adminToken, a),
          await getBookAdmin(adminToken, b),
        ];
        for (let i = 0; i < 2; i++) {
          const beforeQty = Number(happyOrder.beforeStock[i].stockQuantity);
          const afterQty = Number(after[i].stockQuantity);
          assertEq(
            afterQty,
            beforeQty - 1,
            `book[${i}] stock decreased by 1`,
          );
        }
      },
    },
    {
      name: 'list-my-orders',
      fn: async () => {
        const list = await api('GET', '/orders', { token, expectStatus: 200 });
        const items = list.json?.data?.items ?? [];
        const found = items.find((o) => o.id === happyOrder.id);
        assert(found, 'placed order present in /orders list');
      },
    },
    {
      name: 'order-detail-timeline',
      fn: async () => {
        const r = await api('GET', `/orders/${happyOrder.id}`, {
          token,
          expectStatus: 200,
        });
        const detail = r.json?.data;
        assert(detail, 'detail present');
        const logs = detail.statusLogs ?? [];
        assert(logs.length >= 1, `statusLogs has >=1 entry, got ${logs.length}`);
        const initial = logs.find(
          (l) => l.fromStatus === null && l.toStatus === 'CONFIRMED',
        );
        assert(initial, 'initial null->CONFIRMED log present');
      },
    },
    {
      name: 'customer-cancel',
      fn: async () => {
        // place a fresh COD order to cancel
        const [bookId] = await pickBookIds(token, 1);
        const before = await getBookAdmin(adminToken, bookId);
        const order = await placeCodOrder({
          token,
          addressId,
          bookIds: [bookId],
        });
        const cancel = await api('POST', `/orders/${order.id}/cancel`, {
          token,
          body: { reason: 'E2E test' },
        });
        assertEq(cancel.status, 200, 'cancel status');
        const detail = cancel.json?.data;
        assertEq(detail.status, 'CANCELLED', 'status now CANCELLED');
        // stock restored
        const after = await getBookAdmin(adminToken, bookId);
        assertEq(
          Number(after.stockQuantity),
          Number(before.stockQuantity),
          'stock restored to original',
        );
        // status log entry
        const logs = detail.statusLogs ?? [];
        const cancelLog = logs.find((l) => l.toStatus === 'CANCELLED');
        assert(cancelLog, 'status_logs has cancellation entry');
      },
    },
    {
      name: 'admin-list-filter',
      fn: async () => {
        const r = await api('GET', '/admin/orders?status=CONFIRMED', {
          token: adminToken,
          expectStatus: 200,
        });
        const items = r.json?.data?.items ?? [];
        assert(items.length >= 1, `>=1 CONFIRMED order in admin list, got ${items.length}`);
        for (const o of items) {
          assertEq(o.status, 'CONFIRMED', 'all items match filter');
        }
      },
    },
    {
      name: 'admin-state-machine',
      fn: async () => {
        // place a fresh COD (CONFIRMED) order
        const [bookId] = await pickBookIds(token, 1);
        const order = await placeCodOrder({
          token,
          addressId,
          bookIds: [bookId],
        });

        // CONFIRMED -> PROCESSING
        let r = await api('PATCH', `/admin/orders/${order.id}/status`, {
          token: adminToken,
          body: { toStatus: 'PROCESSING' },
        });
        assertEq(r.status, 200, 'CONFIRMED->PROCESSING');
        assertEq(r.json.data.status, 'PROCESSING', 'status PROCESSING');

        // PROCESSING -> SHIPPING
        r = await api('PATCH', `/admin/orders/${order.id}/status`, {
          token: adminToken,
          body: { toStatus: 'SHIPPING' },
        });
        assertEq(r.status, 200, 'PROCESSING->SHIPPING');

        // SHIPPING -> DELIVERED
        r = await api('PATCH', `/admin/orders/${order.id}/status`, {
          token: adminToken,
          body: { toStatus: 'DELIVERED' },
        });
        assertEq(r.status, 200, 'SHIPPING->DELIVERED');

        // mark COD payment paid before COMPLETED for realism (UC-14 sub-step)
        const pay = await api('PATCH', `/admin/orders/${order.id}/payment`, {
          token: adminToken,
          body: { paymentStatus: 'PAID' },
        });
        assertEq(pay.status, 200, 'admin mark PAID');
        assertEq(pay.json.data.paymentStatus, 'PAID', 'paymentStatus=PAID');

        // DELIVERED -> COMPLETED
        r = await api('PATCH', `/admin/orders/${order.id}/status`, {
          token: adminToken,
          body: { toStatus: 'COMPLETED' },
        });
        assertEq(r.status, 200, 'DELIVERED->COMPLETED');

        // invalid backward COMPLETED -> PENDING
        const bad = await api('PATCH', `/admin/orders/${order.id}/status`, {
          token: adminToken,
          body: { toStatus: 'PENDING' },
        });
        assertEq(bad.status, 400, 'COMPLETED->PENDING rejected');
      },
    },
    {
      name: 'admin-mark-payment-paid',
      fn: async () => {
        // place a fresh COD order, transition to DELIVERED, then mark PAID
        const [bookId] = await pickBookIds(token, 1);
        const order = await placeCodOrder({
          token,
          addressId,
          bookIds: [bookId],
        });
        for (const next of ['PROCESSING', 'SHIPPING', 'DELIVERED']) {
          const r = await api('PATCH', `/admin/orders/${order.id}/status`, {
            token: adminToken,
            body: { toStatus: next },
          });
          assertEq(r.status, 200, `status->${next}`);
        }
        const pay = await api('PATCH', `/admin/orders/${order.id}/payment`, {
          token: adminToken,
          body: { paymentStatus: 'PAID' },
        });
        assertEq(pay.status, 200, 'PATCH payment 200');
        assertEq(pay.json.data.paymentStatus, 'PAID', 'paymentStatus=PAID');
      },
    },
  ];

  return run('UC-05 COD + UC-06 + UC-14', tests);
}
