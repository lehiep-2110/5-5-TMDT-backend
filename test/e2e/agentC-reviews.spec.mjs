// UC-07 Reviews
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  placeCodOrder,
  setupDeliveredOrder,
} from './helpers-c.mjs';

const tests = [];

async function getBookSlugById(bookId) {
  // /books endpoint caps limit at 50; iterate pages until we find the book.
  for (let page = 1; page <= 5; page++) {
    const r = await api('GET', `/books?page=${page}&limit=50`);
    const items = r.json?.data?.items ?? [];
    const found = items.find((b) => b.id === bookId);
    if (found) return found.slug;
    if (items.length < 50) break;
  }
  return null;
}

tests.push({
  name: 'UC-07 cannot-review-non-delivered',
  fn: async () => {
    const c = await loginCustomer1();
    const order = await placeCodOrder(c.token);
    // Order is CONFIRMED (COD auto-confirm), not delivered.
    const r = await api('POST', '/reviews', {
      token: c.token,
      body: { orderItemId: order.orderItemId, stars: 5 },
    });
    assert(r.status === 400, `expected 400 got ${r.status}: ${r.text?.slice?.(0, 200)}`);
  },
});

tests.push({
  name: 'UC-07 review-happy-201',
  fn: async () => {
    const c = await loginCustomer1();
    const order = await setupDeliveredOrder(c.token);
    const r = await api('POST', '/reviews', {
      token: c.token,
      body: {
        orderItemId: order.orderItemId,
        stars: 5,
        title: 'Tuyệt vời',
        content: 'E2E test review',
      },
    });
    assert(r.status === 201, `expected 201 got ${r.status}: ${r.text?.slice?.(0, 200)}`);
    const review = r.json?.data ?? r.json;
    assert(review?.id, 'review id present');
    assertEq(review.stars, 5, 'stars stored');
    // Cache for subsequent tests
    const slug = await getBookSlugById(order.bookId);
    assert(slug, `slug for book ${order.bookId} found`);
    globalThis.__C_review = {
      id: review.id,
      bookId: order.bookId,
      orderItemId: order.orderItemId,
      customerToken: c.token,
      slug,
    };
  },
});

tests.push({
  name: 'UC-07 review-recomputes-book-rating-and-count',
  fn: async () => {
    const ctx = globalThis.__C_review;
    assert(ctx, 'previous review test must have run');
    const r = await api('GET', `/books/${ctx.slug}/reviews`);
    assertEq(r.status, 200, 'book reviews status');
    const data = r.json?.data ?? r.json;
    assert(data && typeof data.reviewCount === 'number', `reviewCount missing: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.reviewCount >= 1, `reviewCount should be >= 1, got ${data.reviewCount}`);
    assert(data.avgRating !== undefined && data.avgRating !== null, 'avgRating present');
    globalThis.__C_review.priorReviewCount = data.reviewCount;
  },
});

tests.push({
  name: 'UC-07 cannot-review-twice',
  fn: async () => {
    const ctx = globalThis.__C_review;
    assert(ctx, 'context');
    const r = await api('POST', '/reviews', {
      token: ctx.customerToken,
      body: { orderItemId: ctx.orderItemId, stars: 4 },
    });
    assert(r.status === 400, `expected 400 got ${r.status}`);
    const msg = (r.json?.message || r.text || '').toLowerCase();
    assert(msg.includes('đánh giá') || msg.includes('danh gia'), `expected vietnamese duplicate message; got: ${msg}`);
  },
});

tests.push({
  name: 'UC-07 review-update-within-48h',
  fn: async () => {
    const ctx = globalThis.__C_review;
    const r = await api('PATCH', `/reviews/${ctx.id}`, {
      token: ctx.customerToken,
      body: { stars: 4 },
    });
    assert(r.status === 200, `expected 200 got ${r.status}: ${r.text?.slice?.(0, 200)}`);
    const updated = r.json?.data ?? r.json;
    assertEq(updated.stars, 4, 'stars updated');
    // Recompute should keep reviewCount intact
    const listing = await api('GET', `/books/${ctx.slug}/reviews`);
    const data = listing.json?.data ?? listing.json;
    assert(
      data.reviewCount === ctx.priorReviewCount,
      `reviewCount preserved: prior=${ctx.priorReviewCount} now=${data.reviewCount}`,
    );
  },
});

tests.push({
  name: 'UC-07 admin-hide-review-decrements-public-count',
  fn: async () => {
    const ctx = globalThis.__C_review;
    const adm = await loginAdmin();

    const before = await api('GET', `/books/${ctx.slug}/reviews`);
    const beforeCount = (before.json?.data ?? before.json)?.reviewCount ?? 0;
    assert(beforeCount >= 1, `precondition: have a published review (got ${beforeCount})`);

    const r = await api('PATCH', `/admin/reviews/${ctx.id}/status`, {
      token: adm.token,
      body: { status: 'HIDDEN' },
    });
    assert(r.status === 200, `expected 200 got ${r.status}: ${r.text?.slice?.(0, 300)}`);

    const after = await api('GET', `/books/${ctx.slug}/reviews`);
    const afterCount = (after.json?.data ?? after.json)?.reviewCount ?? 0;
    assert(
      afterCount === beforeCount - 1,
      `expected count to drop by 1: before=${beforeCount} after=${afterCount}`,
    );
  },
});

tests.push({
  name: 'UC-07 public-list-reviews-by-slug',
  fn: async () => {
    const list = await api('GET', `/books?limit=20`);
    const slug = list.json?.data?.items?.[0]?.slug;
    assert(slug, 'have a slug');
    const r = await api('GET', `/books/${slug}/reviews?page=1&limit=5`);
    assertEq(r.status, 200, 'public reviews status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.items), 'items is array');
    assert(typeof data.total === 'number', 'total numeric');
    assert(typeof data.page === 'number', 'page numeric');
    assert(typeof data.limit === 'number', 'limit numeric');
  },
});

tests.push({
  name: 'UC-07 me-reviews-customer-can-list-own',
  fn: async () => {
    const c = await loginCustomer1();
    const r = await api('GET', '/reviews/me', { token: c.token });
    assertEq(r.status, 200, 'me reviews status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.items), 'items is array');
    assert(typeof data.total === 'number', 'total is number');
  },
});

export default tests;
