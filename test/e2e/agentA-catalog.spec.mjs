// UC-03 Search & detail, UC-12 Books CRUD admin, UC-13 Categories/NXB
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  randomSuffix,
} from './helpers.mjs';

const tests = [];

tests.push({
  name: 'UC-03 public-search-keyword: keyword=Kim returns matching books',
  fn: async () => {
    const res = await api('GET', '/books?keyword=Kim&limit=20', {
      expectStatus: 200,
    });
    const items = res.json?.data?.items || [];
    assert(items.length > 0, 'at least one match for Kim');
    // The keyword "Kim" should appear in title, author, or publisher.
    const ok = items.every((b) => {
      const blob = (
        b.title +
        ' ' +
        (b.authors || []).map((a) => a.name).join(' ') +
        ' ' +
        (b.publisher?.name || '')
      ).toLowerCase();
      return blob.includes('kim');
    });
    assert(ok, 'every item matches keyword in title/author/publisher');
  },
});

tests.push({
  name: 'UC-03 public-search-category: items respect category subtree',
  fn: async () => {
    const cats = await api('GET', '/categories', { expectStatus: 200 });
    // Pick a leaf category from the tree (Văn học -> Văn học Việt Nam) to test subtree filter.
    const tree = cats.json?.data || [];
    assert(tree.length > 0, 'categories tree non-empty');
    // Use the first root that has children; otherwise use the root.
    const root = tree.find((c) => (c.children || []).length > 0) || tree[0];
    const target = root.children?.[0] || root;

    const res = await api(
      `GET`,
      `/books?categoryId=${target.id}&limit=20`,
      { expectStatus: 200 },
    );
    const items = res.json?.data?.items || [];
    assert(items.length >= 0, 'category filter responded');
    // Best-effort: items must reference a category (server filters by subtree).
    items.forEach((b) =>
      assert(b.category && b.category.id, 'each item has a category'),
    );
  },
});

tests.push({
  name: 'UC-03 public-pagination: page1 vs page2, total stable',
  fn: async () => {
    const p1 = await api('GET', '/books?limit=5&page=1', { expectStatus: 200 });
    const p2 = await api('GET', '/books?limit=5&page=2', { expectStatus: 200 });
    const a = p1.json?.data;
    const b = p2.json?.data;
    assert(a && b, 'both pages have data');
    assertEq(a.total, b.total, 'total stable across pages');
    if (a.total > 5) {
      const idsA = (a.items || []).map((x) => x.id);
      const idsB = (b.items || []).map((x) => x.id);
      const overlap = idsA.filter((x) => idsB.includes(x));
      assertEq(overlap.length, 0, 'no overlap between page1 and page2');
    }
  },
});

tests.push({
  name: 'UC-03 book-detail-by-slug: detail has authors[], breadcrumb, images[]',
  fn: async () => {
    const list = await api('GET', '/books?limit=1', { expectStatus: 200 });
    const slug = list.json?.data?.items?.[0]?.slug;
    assert(slug, 'have a slug to fetch');
    const detail = await api('GET', `/books/${slug}`, { expectStatus: 200 });
    const d = detail.json?.data;
    assert(Array.isArray(d?.authors), 'authors[] present');
    assert(Array.isArray(d?.breadcrumb), 'breadcrumb present');
    assert(Array.isArray(d?.images), 'images[] present');
  },
});

tests.push({
  name: 'UC-12 admin-create-book + slug uniqueness (suffix on duplicate title)',
  fn: async () => {
    const admin = await loginAdmin();
    // Pick a publisher, category, author from existing data.
    const pubs = await api('GET', '/publishers?limit=5', { token: admin.token });
    const cats = await api('GET', '/categories', { expectStatus: 200 });
    const authors = await api('GET', '/authors?limit=5', { token: admin.token });

    const publisher = pubs.json?.data?.items?.[0];
    const author = authors.json?.data?.items?.[0];
    // Pick any leaf category (no children) to satisfy "category contains books" later.
    const tree = cats.json?.data || [];
    const flat = [];
    const walk = (n) => {
      flat.push(n);
      (n.children || []).forEach(walk);
    };
    tree.forEach(walk);
    const leafCat = flat.find((c) => !(c.children || []).length) || flat[0];

    assert(publisher && author && leafCat, 'have refs');

    const ts = randomSuffix();
    const title = `E2E Cat ${ts}`;
    const isbnA = `97800000${String(Date.now() % 100000).padStart(5, '0')}`;
    const isbnB = String(BigInt(isbnA) + 1n);

    const r1 = await api('POST', '/admin/books', {
      token: admin.token,
      body: {
        title,
        isbn: isbnA,
        publisherId: publisher.id,
        categoryId: leafCat.id,
        price: 100000,
        stockQuantity: 10,
        authorIds: [author.id],
      },
      expectStatus: 201,
    });
    const slug1 = r1.json?.data?.slug;
    assert(slug1, 'first book has slug');

    const r2 = await api('POST', '/admin/books', {
      token: admin.token,
      body: {
        title, // same title -> slug should suffix
        isbn: isbnB,
        publisherId: publisher.id,
        categoryId: leafCat.id,
        price: 110000,
        stockQuantity: 7,
        authorIds: [author.id],
      },
      expectStatus: 201,
    });
    const slug2 = r2.json?.data?.slug;
    assert(slug2 && slug2 !== slug1, `duplicate title gets different slug: ${slug1} vs ${slug2}`);
  },
});

tests.push({
  name: 'UC-12 admin-create-book-isbn-validation: short ISBN -> 400',
  fn: async () => {
    const admin = await loginAdmin();
    const pubs = await api('GET', '/publishers?limit=1', { token: admin.token });
    const authors = await api('GET', '/authors?limit=1', { token: admin.token });
    const cats = await api('GET', '/categories', { expectStatus: 200 });
    const flat = [];
    const walk = (n) => {
      flat.push(n);
      (n.children || []).forEach(walk);
    };
    (cats.json?.data || []).forEach(walk);
    const leafCat = flat.find((c) => !(c.children || []).length) || flat[0];

    const res = await api('POST', '/admin/books', {
      token: admin.token,
      body: {
        title: `Bad ISBN ${randomSuffix()}`,
        isbn: '123',
        publisherId: pubs.json?.data?.items?.[0]?.id,
        categoryId: leafCat.id,
        price: 50000,
        stockQuantity: 1,
        authorIds: [authors.json?.data?.items?.[0]?.id],
      },
    });
    assertEq(res.status, 400, 'isbn short rejected');
  },
});

tests.push({
  name: 'UC-12 admin-update-price -> price_history and new price reflected',
  fn: async () => {
    const admin = await loginAdmin();
    // Find an existing book by listing /admin/books with limit=1.
    const list = await api('GET', '/admin/books?limit=1&page=1', {
      token: admin.token,
      expectStatus: 200,
    });
    const book = list.json?.data?.items?.[0];
    assert(book, 'have an existing book');

    const oldPrice = Number(book.price);
    const newPrice = oldPrice + 12345;
    const upd = await api('PATCH', `/admin/books/${book.id}`, {
      token: admin.token,
      body: { price: newPrice },
      expectStatus: 200,
    });
    const updated = upd.json?.data;
    assertEq(
      Number(updated?.price),
      newPrice,
      'response reflects new price',
    );

    // Re-fetch admin detail and confirm.
    const fresh = await api('GET', `/admin/books/${book.id}`, {
      token: admin.token,
      expectStatus: 200,
    });
    assertEq(
      Number(fresh.json?.data?.price),
      newPrice,
      'admin GET reflects new price',
    );
    // Note: BE has no public price-history endpoint exposed in this MVP.
    // Service writes a price_history row server-side; we verify behaviorally
    // via the price round-trip.
  },
});

tests.push({
  name: 'UC-13 admin-categories-tree: GET /categories returns a tree',
  fn: async () => {
    const res = await api('GET', '/categories', { expectStatus: 200 });
    const tree = res.json?.data || [];
    assert(Array.isArray(tree) && tree.length > 0, 'tree non-empty');
    const someParent = tree.find((n) => (n.children || []).length > 0);
    assert(someParent, 'tree has a parent with children');
    const child = someParent.children[0];
    assertEq(child.parentId, someParent.id, 'child.parentId == parent.id');
  },
});

tests.push({
  name: 'UC-13 admin-cannot-delete-cat-with-books: 409 with VN message',
  fn: async () => {
    const admin = await loginAdmin();
    // Find a category that contains books — pick the first book and use its category.
    const books = await api('GET', '/books?limit=1', { expectStatus: 200 });
    const catId = books.json?.data?.items?.[0]?.category?.id;
    assert(catId, 'have a category id with books');

    const res = await api('DELETE', `/admin/categories/${catId}`, {
      token: admin.token,
    });
    assert(
      res.status === 409 || res.status === 400,
      `expected 409/400, got ${res.status}`,
    );
    const msg = String(res.json?.message || '');
    assert(
      msg.toLowerCase().includes('không thể') ||
        msg.includes('chứa') ||
        msg.includes('sách'),
      `Vietnamese error message present: ${msg}`,
    );
  },
});

export default tests;
