// UC-04 — Cart
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  pickBookIds,
  pickBooks,
  run,
} from './helpers-b.mjs';

export async function cartSuite() {
  const { token } = await loginCustomer1();
  const { token: adminToken } = await loginAdmin();

  // We re-pick fresh book ids per test but need stable references.
  const tests = [
    {
      name: 'add-and-list',
      fn: async () => {
        await api('DELETE', '/cart', { token, expectStatus: 200 });
        const [bookId] = await pickBookIds(token, 1);
        const add = await api('POST', '/cart/items', {
          token,
          body: { bookId, quantity: 1 },
        });
        assertEq(add.status, 201, 'add status');
        const get = await api('GET', '/cart', { token, expectStatus: 200 });
        const items = get.json?.data?.items ?? [];
        const found = items.find((i) => i.bookId === bookId);
        assert(found, 'item present in cart');
        assertEq(found.quantity, 1, 'quantity=1');
        const expectedSubtotal =
          (Number(found.book.discountPrice ?? found.book.price)) *
          found.quantity;
        assertEq(get.json.data.subtotal, expectedSubtotal, 'subtotal correct');
      },
    },
    {
      name: 'update-qty',
      fn: async () => {
        await api('DELETE', '/cart', { token, expectStatus: 200 });
        const [bookId] = await pickBookIds(token, 1);
        await api('POST', '/cart/items', {
          token,
          body: { bookId, quantity: 1 },
          expectStatus: 201,
        });
        const get1 = await api('GET', '/cart', { token, expectStatus: 200 });
        const itemId = get1.json.data.items.find((i) => i.bookId === bookId).id;
        const upd = await api('PATCH', `/cart/items/${itemId}`, {
          token,
          body: { quantity: 3 },
        });
        assertEq(upd.status, 200, 'update status');
        const get2 = await api('GET', '/cart', { token, expectStatus: 200 });
        const after = get2.json.data.items.find((i) => i.bookId === bookId);
        assertEq(after.quantity, 3, 'quantity=3 after PATCH');
      },
    },
    {
      name: 'remove-item',
      fn: async () => {
        await api('DELETE', '/cart', { token, expectStatus: 200 });
        const [bookId] = await pickBookIds(token, 1);
        await api('POST', '/cart/items', {
          token,
          body: { bookId, quantity: 1 },
          expectStatus: 201,
        });
        const get1 = await api('GET', '/cart', { token, expectStatus: 200 });
        const itemId = get1.json.data.items.find((i) => i.bookId === bookId).id;
        const del = await api('DELETE', `/cart/items/${itemId}`, { token });
        assertEq(del.status, 200, 'remove status');
        const get2 = await api('GET', '/cart', { token, expectStatus: 200 });
        assertEq(get2.json.data.items.length, 0, 'cart empty after remove');
      },
    },
    {
      name: 'cap-quantity',
      fn: async () => {
        await api('DELETE', '/cart', { token, expectStatus: 200 });
        const [book] = await pickBooks(token, 1);
        // The DTO max is 10 — try 50 first; expect 400 from class-validator.
        const oversized = await api('POST', '/cart/items', {
          token,
          body: { bookId: book.id, quantity: 50 },
        });
        assertEq(oversized.status, 400, 'quantity 50 rejected by DTO');

        // Now max-allowed quantity = 10 (or stock-cap if smaller).
        const cap = Math.min(10, Number(book.stockQuantity));
        const ok = await api('POST', '/cart/items', {
          token,
          body: { bookId: book.id, quantity: cap },
          expectStatus: 201,
        });
        const items = ok.json?.data?.items ?? [];
        const found = items.find((i) => i.bookId === book.id);
        assert(found, 'item added at cap');
        assert(
          found.quantity <= 10 && found.quantity <= Number(book.stockQuantity),
          `cart qty ${found.quantity} ≤ min(stock,10)`,
        );
      },
    },
    {
      name: 'out-of-stock',
      fn: async () => {
        await api('DELETE', '/cart', { token, expectStatus: 200 });
        const [book] = await pickBooks(token, 1);
        const original = Number(book.stockQuantity);

        // Set stock to 0 via admin PATCH.
        const patch = await api('PATCH', `/admin/books/${book.id}`, {
          token: adminToken,
          body: { stockQuantity: 0 },
        });
        assertEq(patch.status, 200, 'admin patch stock=0');

        try {
          const add = await api('POST', '/cart/items', {
            token,
            body: { bookId: book.id, quantity: 1 },
          });
          assertEq(add.status, 400, 'add to cart rejected when out of stock');
          const msg = JSON.stringify(add.json ?? {});
          assert(
            /hết hàng/i.test(msg),
            `error mentions "hết hàng"; got ${msg.slice(0, 200)}`,
          );
        } finally {
          // Always reset.
          await api('PATCH', `/admin/books/${book.id}`, {
            token: adminToken,
            body: { stockQuantity: original },
          });
        }
      },
    },
  ];

  return run('UC-04 Cart', tests);
}
