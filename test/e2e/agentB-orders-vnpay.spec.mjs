// UC-05 VNPAY happy + cancel + bad-sig
import {
  api,
  assert,
  assertEq,
  BACKEND_ORIGIN,
  getBookAdmin,
  loginAdmin,
  loginCustomer1,
  parsePaymentUrl,
  pickAddressId,
  pickBookIds,
  run,
} from './helpers-b.mjs';

async function placeVnpayOrder({ token, addressId, bookId }) {
  await api('DELETE', '/cart', { token, expectStatus: 200 });
  await api('POST', '/cart/items', {
    token,
    body: { bookId, quantity: 1 },
    expectStatus: 201,
  });
  const create = await api('POST', '/orders', {
    token,
    body: { addressId, paymentMethod: 'VNPAY' },
  });
  if (create.status !== 201) {
    throw new Error(
      `placeVnpayOrder failed: ${create.status} ${create.text.slice(0, 200)}`,
    );
  }
  return create.json.data;
}

export async function ordersVnpaySuite() {
  const { token } = await loginCustomer1();
  const { token: adminToken } = await loginAdmin();
  const addressId = await pickAddressId(token);

  // shared state
  let happy = null;

  const tests = [
    {
      name: 'vnpay-create-pending',
      fn: async () => {
        const [bookId] = await pickBookIds(token, 1);
        const beforeStock = await getBookAdmin(adminToken, bookId);
        const order = await placeVnpayOrder({ token, addressId, bookId });
        happy = { order, bookId, beforeStock: Number(beforeStock.stockQuantity) };
        assertEq(order.status, 'PENDING', 'status PENDING');
        assertEq(order.paymentStatus, 'UNPAID', 'paymentStatus UNPAID');
        assert(
          typeof order.paymentUrl === 'string' &&
            order.paymentUrl.startsWith('/api/payments/vnpay/sim'),
          `paymentUrl looks correct (got ${order.paymentUrl})`,
        );
        const parts = parsePaymentUrl(order.paymentUrl);
        assertEq(parts.orderId, order.id, 'sig orderId matches');
        assert(parts.sig && /^[a-f0-9]{64}$/.test(parts.sig), 'hex64 sig');
      },
    },
    {
      name: 'vnpay-stock-reserved',
      fn: async () => {
        assert(happy, 'previous test must succeed');
        const after = await getBookAdmin(adminToken, happy.bookId);
        assertEq(
          Number(after.stockQuantity),
          happy.beforeStock - 1,
          'stock decreased by 1 while PENDING',
        );
      },
    },
    {
      name: 'vnpay-sim-page-renders',
      fn: async () => {
        assert(happy, 'previous test must succeed');
        const url = `${BACKEND_ORIGIN}${happy.order.paymentUrl}`;
        const res = await fetch(url);
        assertEq(res.status, 200, 'sim page 200');
        const ct = res.headers.get('content-type') || '';
        assert(/text\/html/.test(ct), `content-type html, got ${ct}`);
        const body = await res.text();
        assert(
          body.includes('Xác nhận thanh toán'),
          'body has "Xác nhận thanh toán"',
        );
        assert(body.includes('Huỷ'), 'body has "Huỷ"');
      },
    },
    {
      name: 'vnpay-callback-success',
      fn: async () => {
        assert(happy, 'previous test must succeed');
        const { orderId, sig } = parsePaymentUrl(happy.order.paymentUrl);
        const cb = await api('POST', '/payments/vnpay/callback-success', {
          body: { orderId, sig },
        });
        assertEq(cb.status, 200, 'callback success 200');
        const redirect = cb.json?.data?.redirect ?? '';
        assert(
          redirect === `/orders/${orderId}?paid=1`,
          `redirect ${redirect}`,
        );
        // Check order is CONFIRMED + PAID
        const detail = await api('GET', `/orders/${orderId}`, {
          token,
          expectStatus: 200,
        });
        assertEq(detail.json.data.status, 'CONFIRMED', 'order CONFIRMED');
        assertEq(detail.json.data.paymentStatus, 'PAID', 'paymentStatus PAID');
        // payments row exists & SUCCESS — checked via admin order detail (no payments endpoint).
        // Best-effort: status logs has VNPAY note
        const logs = detail.json.data.statusLogs ?? [];
        const vnpayLog = logs.find((l) =>
          (l.note ?? '').includes('VNPAY'),
        );
        assert(vnpayLog, 'status log has VNPAY note');
      },
    },
    {
      name: 'vnpay-bad-sig',
      fn: async () => {
        // create yet another order
        const [bookId] = await pickBookIds(token, 1);
        const order = await placeVnpayOrder({ token, addressId, bookId });
        const cb = await api('POST', '/payments/vnpay/callback-success', {
          body: { orderId: order.id, sig: 'badbeef' },
        });
        assertEq(cb.status, 401, 'bad sig 401');
        // cleanup: cancel via correct sig so stock is restored
        const { sig } = parsePaymentUrl(order.paymentUrl);
        await api('POST', '/payments/vnpay/callback-cancel', {
          body: { orderId: order.id, sig },
        });
      },
    },
    {
      name: 'vnpay-cancel-flow',
      fn: async () => {
        const [bookId] = await pickBookIds(token, 1);
        const before = await getBookAdmin(adminToken, bookId);
        const order = await placeVnpayOrder({ token, addressId, bookId });
        const { sig } = parsePaymentUrl(order.paymentUrl);
        const cb = await api('POST', '/payments/vnpay/callback-cancel', {
          body: { orderId: order.id, sig },
        });
        assertEq(cb.status, 200, 'cancel callback 200');
        const detail = await api('GET', `/orders/${order.id}`, {
          token,
          expectStatus: 200,
        });
        assertEq(detail.json.data.status, 'CANCELLED', 'order CANCELLED');
        const after = await getBookAdmin(adminToken, bookId);
        assertEq(
          Number(after.stockQuantity),
          Number(before.stockQuantity),
          'stock restored after cancel',
        );
      },
    },
  ];

  return run('UC-05 VNPAY', tests);
}
