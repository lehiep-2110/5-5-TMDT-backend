// Independent helpers for Agent C E2E tests.
// Talks to a live backend on port 8001.

export const BASE = process.env.E2E_BASE || 'http://localhost:8001/api';
export const BACKEND_ORIGIN = process.env.E2E_BACKEND_ORIGIN || 'http://localhost:8001';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Make an HTTP request against the live backend.
 * Returns { status, json, text } unless `raw=true` in which case the raw
 * `Response` object is returned (useful for SSE streaming).
 */
export async function api(method, path, opts = {}) {
  const { token, body, expectStatus, headers: extraHeaders, raw, signal } = opts;
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...(extraHeaders || {}) };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { method, headers, body: payload, signal });

  if (raw) {
    if (expectStatus !== undefined && res.status !== expectStatus) {
      const peek = await res.text().catch(() => '');
      throw new Error(
        `[${method} ${path}] expected ${expectStatus} got ${res.status}: ${peek.slice(0, 200)}`,
      );
    }
    return res;
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(
      `[${method} ${path}] expected ${expectStatus} got ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// Login helpers
// ---------------------------------------------------------------------------

export async function login(email, password) {
  const { status, json } = await api('POST', '/auth/login', {
    body: { email, password },
  });
  if (status !== 200 || !json?.success) {
    throw new Error(`login(${email}) failed: status=${status} body=${JSON.stringify(json)}`);
  }
  return { token: json.data.accessToken, user: json.data.user };
}

export const loginAdmin = () => login('admin@bookstore.vn', 'Admin@123');
export const loginStaff = () => login('staff@bookstore.vn', 'Staff@123');
export const loginCustomer1 = () => login('customer1@test.com', 'Customer@123');
export const loginCustomer2 = () => login('customer2@test.com', 'Customer@123');

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

export async function run(suiteName, tests) {
  console.log(`\n=== ${suiteName} ===`);
  const results = [];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    const start = Date.now();
    try {
      await t.fn();
      const ms = Date.now() - start;
      passed += 1;
      console.log(`  PASS  ${t.name}  (${ms} ms)`);
      results.push({ suite: suiteName, name: t.name, status: 'pass', ms });
    } catch (err) {
      const ms = Date.now() - start;
      failed += 1;
      const reason = err && err.message ? err.message : String(err);
      console.log(`  FAIL  ${t.name}  (${ms} ms)`);
      console.log(`        -> ${reason}`);
      results.push({ suite: suiteName, name: t.name, status: 'fail', ms, reason });
    }
  }
  return { suite: suiteName, passed, failed, total: tests.length, results };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${msg}. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export async function pickBookWithStock(minStock = 2) {
  const r = await api('GET', '/books?limit=50&page=1');
  if (r.status !== 200 || !Array.isArray(r.json?.data?.items)) {
    throw new Error(`failed listing books: status=${r.status}`);
  }
  const items = r.json.data.items.filter((b) => b.stockQuantity > minStock);
  if (items.length === 0) throw new Error('no books with sufficient stock');
  // Pick a deterministic random item to avoid hammering same one.
  return items[Math.floor(Math.random() * items.length)];
}

export async function ensureAddress(customerToken) {
  const r = await api('GET', '/users/me/addresses', { token: customerToken });
  if (r.status !== 200 || !Array.isArray(r.json?.data)) {
    throw new Error(`failed loading addresses: status=${r.status}`);
  }
  if (r.json.data.length > 0) return r.json.data[0].id;
  const create = await api('POST', '/users/me/addresses', {
    token: customerToken,
    body: {
      recipientName: 'E2E Recipient',
      phone: '0900111222',
      province: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      streetAddress: 'E2E street 1',
      isDefault: true,
    },
  });
  if (create.status !== 201 && create.status !== 200) {
    throw new Error(`createAddress failed: status=${create.status} ${create.text?.slice?.(0, 200)}`);
  }
  return create.json?.data?.id ?? create.json?.id;
}

export async function clearCart(customerToken) {
  await api('DELETE', '/cart', { token: customerToken });
}

/**
 * Create a fresh COD order from a randomly picked book and march it to
 * DELIVERED via the admin token. Returns the orderId, single orderItemId,
 * and bookId.
 */
export async function setupDeliveredOrder(customerToken) {
  const adminToken = (await loginAdmin()).token;
  const order = await placeCodOrder(customerToken);
  await marchToDelivered(adminToken, order.orderId);
  return order;
}

export async function placeCodOrder(customerToken) {
  await clearCart(customerToken);
  const book = await pickBookWithStock(2);
  const addressId = await ensureAddress(customerToken);

  const add = await api('POST', '/cart/items', {
    token: customerToken,
    body: { bookId: book.id, quantity: 1 },
  });
  if (add.status !== 200 && add.status !== 201) {
    throw new Error(`addItem failed: status=${add.status} ${add.text?.slice?.(0, 200)}`);
  }

  const create = await api('POST', '/orders', {
    token: customerToken,
    body: { addressId, paymentMethod: 'COD' },
  });
  if (create.status !== 201 && create.status !== 200) {
    throw new Error(`createOrder failed: status=${create.status} ${create.text?.slice?.(0, 300)}`);
  }
  const data = create.json?.data ?? create.json;
  const orderId = data?.id;
  const items = data?.items ?? [];
  if (!orderId) throw new Error(`orderId missing in createOrder response: ${JSON.stringify(data).slice(0, 300)}`);
  const orderItemId = items[0]?.id ?? items[0]?.orderItemId;
  if (!orderItemId) {
    // Fall back to fetching detail
    const detail = await api('GET', `/orders/${orderId}`, { token: customerToken });
    const dItems = detail.json?.data?.items ?? detail.json?.items ?? [];
    return { orderId, orderItemId: dItems[0]?.id, bookId: book.id, status: data?.status };
  }
  return { orderId, orderItemId, bookId: book.id, status: data?.status };
}

export async function adminUpdateStatus(adminToken, orderId, toStatus) {
  const r = await api('PATCH', `/admin/orders/${orderId}/status`, {
    token: adminToken,
    body: { toStatus },
  });
  if (r.status !== 200) {
    throw new Error(
      `admin update status to ${toStatus} failed: status=${r.status} ${r.text?.slice?.(0, 300)}`,
    );
  }
  return r.json;
}

export async function marchToDelivered(adminToken, orderId) {
  // COD auto-confirms to CONFIRMED, then we walk through PROCESSING -> SHIPPING -> DELIVERED.
  await adminUpdateStatus(adminToken, orderId, 'PROCESSING');
  await adminUpdateStatus(adminToken, orderId, 'SHIPPING');
  await adminUpdateStatus(adminToken, orderId, 'DELIVERED');
}
