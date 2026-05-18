// UC-19 Inventory: list, low-stock filter, restock + stock_logs, role gating
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  loginStaff,
} from './helpers.mjs';

const tests = [];

tests.push({
  name: 'UC-19 inventory-list: paginated list with stockQuantity field',
  fn: async () => {
    const admin = await loginAdmin();
    const res = await api('GET', '/inventory?limit=5', {
      token: admin.token,
      expectStatus: 200,
    });
    const data = res.json?.data;
    assert(Array.isArray(data?.items), 'items[]');
    assert(typeof data?.total === 'number', 'total is number');
    if (data.items.length > 0) {
      const it = data.items[0];
      assert(typeof it.stockQuantity === 'number', 'stockQuantity field');
      assert('isLowStock' in it, 'isLowStock field');
    }
  },
});

tests.push({
  name: 'UC-19 inventory-low-stock-filter: lowStockOnly=true returns books below threshold',
  fn: async () => {
    const admin = await loginAdmin();

    // Pick any book and set stock to 5 via /admin/books/:id PATCH.
    const list = await api('GET', '/admin/books?limit=1&page=1', {
      token: admin.token,
      expectStatus: 200,
    });
    const book = list.json?.data?.items?.[0];
    assert(book, 'have a book');
    const originalStock = Number(book.stockQuantity);

    await api('PATCH', `/admin/books/${book.id}`, {
      token: admin.token,
      body: { stockQuantity: 5 },
      expectStatus: 200,
    });

    try {
      const res = await api('GET', '/inventory?lowStockOnly=true&limit=50', {
        token: admin.token,
        expectStatus: 200,
      });
      const items = res.json?.data?.items || [];
      const found = items.find((x) => x.id === book.id);
      assert(found, 'low-stock book is in results');
      assertEq(found.stockQuantity, 5, 'reflected stock=5');
      assertEq(found.isLowStock, true, 'isLowStock true');
    } finally {
      // Restore original stock.
      await api('PATCH', `/admin/books/${book.id}`, {
        token: admin.token,
        body: { stockQuantity: originalStock },
      });
    }
  },
});

tests.push({
  name: 'UC-19 restock: admin POST /inventory/:id/restock writes stock_logs (PURCHASE)',
  fn: async () => {
    const admin = await loginAdmin();
    const list = await api('GET', '/admin/books?limit=1&page=1', {
      token: admin.token,
      expectStatus: 200,
    });
    const book = list.json?.data?.items?.[0];
    assert(book, 'have a book');
    const before = Number(book.stockQuantity);

    const note = `E2E restock ${Date.now()}`;
    const res = await api('POST', `/inventory/${book.id}/restock`, {
      token: admin.token,
      body: { quantity: 50, note },
      expectStatus: 201,
    });
    const data = res.json?.data;
    assertEq(data?.bookId, book.id, 'echoes bookId');
    assertEq(data?.stockQuantity, before + 50, 'stock += 50');

    // Latest log should match.
    const logs = await api('GET', `/inventory/${book.id}/logs?limit=5`, {
      token: admin.token,
      expectStatus: 200,
    });
    const newest = logs.json?.data?.items?.[0];
    assert(newest, 'log present');
    assertEq(newest.reason, 'PURCHASE', 'reason is PURCHASE');
    assertEq(newest.changeAmount, 50, 'changeAmount=+50');
    assertEq(newest.note, note, 'note matches');
  },
});

tests.push({
  name: 'UC-19 restock-customer-403: customers cannot restock',
  fn: async () => {
    const admin = await loginAdmin();
    const customer = await loginCustomer1();
    const list = await api('GET', '/admin/books?limit=1', {
      token: admin.token,
    });
    const book = list.json?.data?.items?.[0];
    assert(book, 'have a book');

    const res = await api('POST', `/inventory/${book.id}/restock`, {
      token: customer.token,
      body: { quantity: 1 },
    });
    assertEq(res.status, 403, 'customer 403');
  },
});

tests.push({
  name: 'UC-19 restock-staff-201: staff token can restock',
  fn: async () => {
    const admin = await loginAdmin();
    const staff = await loginStaff();
    const list = await api('GET', '/admin/books?limit=1', {
      token: admin.token,
    });
    const book = list.json?.data?.items?.[0];
    assert(book, 'have a book');

    const res = await api('POST', `/inventory/${book.id}/restock`, {
      token: staff.token,
      body: { quantity: 1, note: 'staff e2e' },
      expectStatus: 201,
    });
    assert(res.json?.data?.stockQuantity > 0, 'staff restock ok');
  },
});

export default tests;
