// UC-09 Wishlist
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  loginCustomer2,
  pickBookWithStock,
} from './helpers-c.mjs';

const tests = [];

async function clearWishlist(token) {
  const r = await api('GET', '/wishlist?limit=50', { token });
  const items = r.json?.data?.items ?? [];
  for (const it of items) {
    await api('DELETE', `/wishlist/${it.book.id}`, { token });
  }
  // Also clear any further pages
  let page = 2;
  while (true) {
    const more = await api('GET', `/wishlist?page=${page}&limit=50`, { token });
    const its = more.json?.data?.items ?? [];
    if (its.length === 0) break;
    for (const it of its) {
      await api('DELETE', `/wishlist/${it.book.id}`, { token });
    }
    page += 1;
    if (page > 10) break;
  }
}

tests.push({
  name: 'UC-09 toggle-add-returns-wishlisted-true',
  fn: async () => {
    const c = await loginCustomer1();
    await clearWishlist(c.token);
    const book = await pickBookWithStock(0);
    const r = await api('POST', `/wishlist/${book.id}`, { token: c.token });
    assertEq(r.status, 200, 'toggle add status');
    const data = r.json?.data ?? r.json;
    assertEq(data.wishlisted, true, 'wishlisted=true on add');
    globalThis.__C_w_book1 = book;
  },
});

tests.push({
  name: 'UC-09 toggle-remove-returns-wishlisted-false',
  fn: async () => {
    const c = await loginCustomer1();
    const book = globalThis.__C_w_book1;
    const r = await api('POST', `/wishlist/${book.id}`, { token: c.token });
    assertEq(r.status, 200, 'toggle remove status');
    const data = r.json?.data ?? r.json;
    assertEq(data.wishlisted, false, 'wishlisted=false on remove');
  },
});

tests.push({
  name: 'UC-09 list-after-add-two-books',
  fn: async () => {
    const c = await loginCustomer1();
    await clearWishlist(c.token);
    // Pick two distinct books
    const list = await api('GET', '/books?limit=10');
    const items = list.json?.data?.items ?? [];
    assert(items.length >= 2, 'need 2 books');
    const a = items[0];
    const b = items[1];
    await api('POST', `/wishlist/${a.id}`, { token: c.token });
    await api('POST', `/wishlist/${b.id}`, { token: c.token });

    const r = await api('GET', '/wishlist', { token: c.token });
    assertEq(r.status, 200, 'list status');
    const data = r.json?.data ?? r.json;
    assert(data.items.length >= 2, `expected >=2 items, got ${data.items.length}`);
    const ids = new Set(data.items.map((it) => it.book.id));
    assert(ids.has(a.id) && ids.has(b.id), 'both books listed');
    const itA = data.items.find((it) => it.book.id === a.id);
    assert(itA.book.title, 'has title');
    assert('price' in itA.book, 'has price');
    assert('primaryImage' in itA.book, 'has primaryImage');
  },
});

tests.push({
  name: 'UC-09 ids-endpoint-returns-bookIds',
  fn: async () => {
    const c = await loginCustomer1();
    const r = await api('GET', '/wishlist/ids', { token: c.token });
    assertEq(r.status, 200, 'ids status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.bookIds), 'bookIds array');
    assert(data.bookIds.length >= 2, `expected >=2 ids got ${data.bookIds.length}`);
  },
});

tests.push({
  name: 'UC-09 delete-explicit-removes-item',
  fn: async () => {
    const c = await loginCustomer1();
    const list = await api('GET', '/wishlist', { token: c.token });
    const items = list.json?.data?.items ?? [];
    assert(items.length > 0, 'have items');
    const target = items[0].book.id;
    const r = await api('DELETE', `/wishlist/${target}`, { token: c.token });
    assertEq(r.status, 200, 'delete status');
    const after = await api('GET', '/wishlist/ids', { token: c.token });
    const ids = after.json?.data?.bookIds ?? [];
    assert(!ids.includes(target), 'target removed');
  },
});

tests.push({
  name: 'UC-09 customer-only-admin-token-forbidden',
  fn: async () => {
    const adm = await loginAdmin();
    const book = await pickBookWithStock(0);
    const r = await api('POST', `/wishlist/${book.id}`, { token: adm.token });
    // Roles guard => 403 expected
    assert(r.status === 403, `expected 403 for admin, got ${r.status}`);
  },
});

tests.push({
  name: 'UC-09 max-100-limit-enforced (skipped if <=100 books seeded)',
  fn: async () => {
    // Determine total books in DB
    const probe = await api('GET', '/books?limit=1');
    const total = probe.json?.data?.total ?? probe.json?.data?.meta?.total ?? probe.json?.total;
    if (typeof total !== 'number' || total <= 100) {
      console.log(`        (skipped: total books = ${total})`);
      return; // skip — can't realistically simulate >100 distinct books
    }
    // Use customer2 fresh state; collect 100 unique book ids and try 101st
    const c = await loginCustomer2();
    await clearWishlist(c.token);
    const allIds = [];
    for (let p = 1; p <= 5 && allIds.length < 102; p++) {
      const r = await api('GET', `/books?page=${p}&limit=50`);
      for (const b of r.json?.data?.items ?? []) {
        allIds.push(b.id);
        if (allIds.length >= 102) break;
      }
    }
    const first100 = allIds.slice(0, 100);
    for (const id of first100) {
      const t = await api('POST', `/wishlist/${id}`, { token: c.token });
      assertEq(t.status, 200, `add ok for ${id}`);
    }
    const extra = allIds[100];
    const fail = await api('POST', `/wishlist/${extra}`, { token: c.token });
    assertEq(fail.status, 400, 'expected 400 over limit');
    const msg = (fail.json?.message || fail.text || '').toLowerCase();
    assert(msg.includes('100') || msg.includes('giới hạn') || msg.includes('gioi han'), `expected limit msg got: ${msg}`);
    await clearWishlist(c.token);
  },
});

export default tests;
