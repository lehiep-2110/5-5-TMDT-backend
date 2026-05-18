// Shared helpers for Agent B E2E tests.
// Talks to a live backend on port 8001. No external dependencies.

export const BASE = process.env.E2E_BASE || 'http://localhost:8001/api';
export const BACKEND_ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:8001';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Make an HTTP request against the live backend.
 *
 * Returns { status, json, text }.
 * If `expectStatus` is supplied, throws when the status doesn't match.
 */
export async function api(method, path, opts = {}) {
  const { token, body, expectStatus, headers: extraHeaders } = opts;
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...(extraHeaders || {}) };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(
      `[${method} ${path}] expected ${expectStatus} got ${res.status}: ${text.slice(
        0,
        300,
      )}`,
    );
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(email, password) {
  const { status, json } = await api('POST', '/auth/login', {
    body: { email, password },
  });
  if (status !== 200 || !json?.success) {
    throw new Error(
      `login(${email}) failed: status=${status} body=${JSON.stringify(json)}`,
    );
  }
  return { token: json.data.accessToken, user: json.data.user };
}

export const loginAdmin = () => login('admin@bookstore.vn', 'Admin@123');
export const loginStaff = () => login('staff@bookstore.vn', 'Staff@123');
export const loginCustomer1 = () => login('customer1@test.com', 'Customer@123');
export const loginCustomer2 = () => login('customer2@test.com', 'Customer@123');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick `n` book ids that have stock > 5 from the public catalogue.
 */
export async function pickBookIds(token, n = 2) {
  const { json } = await api('GET', '/books?limit=20', { token });
  const items = json?.data?.items ?? [];
  const usable = items
    .filter((b) => b.status === 'ACTIVE' && Number(b.stockQuantity) > 5)
    .slice(0, n);
  if (usable.length < n) {
    throw new Error(`Not enough books with stock>5; found ${usable.length}`);
  }
  return usable.map((b) => b.id);
}

export async function pickBooks(token, n = 2) {
  const { json } = await api('GET', '/books?limit=20', { token });
  const items = json?.data?.items ?? [];
  const usable = items
    .filter((b) => b.status === 'ACTIVE' && Number(b.stockQuantity) > 5)
    .slice(0, n);
  if (usable.length < n) {
    throw new Error(`Not enough books with stock>5; found ${usable.length}`);
  }
  return usable;
}

/** Look up a single book detail (admin) so we have stock_quantity directly. */
export async function getBookAdmin(token, bookId) {
  const { json, status } = await api('GET', `/admin/books/${bookId}`, { token });
  if (status !== 200) throw new Error(`get book ${bookId} failed: ${status}`);
  return json?.data;
}

/** Get the customer's first address id. */
export async function pickAddressId(token) {
  const { json } = await api('GET', '/users/me/addresses', { token });
  const list = json?.data ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('No addresses for current user.');
  }
  return list[0].id;
}

export function uniqVoucherCode(prefix = 'B') {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${ts}${rand}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${msg}. expected=${JSON.stringify(
        expected,
      )} actual=${JSON.stringify(actual)}`,
    );
  }
}

/** Parse `paymentUrl` like "/api/payments/vnpay/sim?orderId=<id>&sig=<hex>" */
export function parsePaymentUrl(paymentUrl) {
  const u = new URL(paymentUrl, BACKEND_ORIGIN);
  return { orderId: u.searchParams.get('orderId'), sig: u.searchParams.get('sig') };
}

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
      results.push({
        suite: suiteName,
        name: t.name,
        status: 'fail',
        ms,
        reason,
      });
    }
  }
  return { suite: suiteName, passed, failed, total: tests.length, results };
}
