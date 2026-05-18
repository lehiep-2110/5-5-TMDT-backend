// UC-17 Reports
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  loginStaff,
} from './helpers-c.mjs';

const tests = [];

function isMetric(m) {
  return m && typeof m.value === 'number'
    && typeof m.deltaPct === 'number'
    && ['up', 'down', 'flat'].includes(m.direction);
}

tests.push({
  name: 'UC-17 overview-shape (period=month)',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/overview?period=month', { token: adm.token });
    assertEq(r.status, 200, 'overview status');
    const data = r.json?.data ?? r.json;
    assert(data.metrics, 'metrics present');
    assert(isMetric(data.metrics.revenue), 'revenue metric shape');
    assert(isMetric(data.metrics.orderCount), 'orderCount metric shape');
    assert(isMetric(data.metrics.newCustomers), 'newCustomers metric shape');
    assert(isMetric(data.metrics.averageOrderValue), 'averageOrderValue metric shape');
    // deltaPct math sanity: rounded to 1 decimal
    for (const m of Object.values(data.metrics)) {
      assert(Math.abs(m.deltaPct - Math.round(m.deltaPct * 10) / 10) < 1e-9, 'deltaPct rounded to 1dp');
    }
  },
});

tests.push({
  name: 'UC-17 overview-period-week',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/overview?period=week', { token: adm.token });
    assertEq(r.status, 200, 'overview week status');
    const data = r.json?.data ?? r.json;
    assertEq(data.period, 'week', 'period echo');
    assert(isMetric(data.metrics.revenue), 'revenue metric shape');
  },
});

tests.push({
  name: 'UC-17 revenue-series-densified-day',
  fn: async () => {
    const adm = await loginAdmin();
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const r = await api(
      'GET',
      `/admin/reports/revenue-series?from=${from.toISOString()}&to=${to.toISOString()}&granularity=day`,
      { token: adm.token },
    );
    assertEq(r.status, 200, 'revenue-series status');
    const data = r.json?.data ?? r.json;
    assertEq(data.granularity, 'day', 'granularity=day');
    assert(Array.isArray(data.points), 'points array');
    assert(data.points.length >= 30 && data.points.length <= 32, `expected ~31 points, got ${data.points.length}`);
    for (const p of data.points) {
      assert(typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date), `bad date ${p.date}`);
      assert(typeof p.revenue === 'number', 'revenue numeric');
      assert(typeof p.orderCount === 'number', 'orderCount numeric');
    }
  },
});

tests.push({
  name: 'UC-17 revenue-series-week-granularity',
  fn: async () => {
    const adm = await loginAdmin();
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000);
    const r = await api(
      'GET',
      `/admin/reports/revenue-series?from=${from.toISOString()}&to=${to.toISOString()}&granularity=week`,
      { token: adm.token },
    );
    assertEq(r.status, 200, 'status');
    const data = r.json?.data ?? r.json;
    assertEq(data.granularity, 'week', 'granularity=week');
    assert(data.points.length > 0 && data.points.length < 20, `weekly points sane, got ${data.points.length}`);
  },
});

tests.push({
  name: 'UC-17 top-products-limit-3',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/top-products?limit=3', { token: adm.token });
    assertEq(r.status, 200, 'status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.items), 'items array');
    assert(data.items.length <= 3, `limit honored, got ${data.items.length}`);
    if (data.items.length > 0) {
      const it = data.items[0];
      assert(typeof it.bookId === 'string', 'bookId');
      assert(typeof it.title === 'string', 'title');
      assert(typeof it.slug === 'string', 'slug');
      assert(typeof it.unitsSold === 'number', 'unitsSold');
      assert(typeof it.revenue === 'number', 'revenue');
    }
  },
});

tests.push({
  name: 'UC-17 recent-orders-limit-5',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/recent-orders?limit=5', { token: adm.token });
    assertEq(r.status, 200, 'status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.items), 'items array');
    assert(data.items.length <= 5, 'limit honored');
    if (data.items.length > 0) {
      const it = data.items[0];
      assert(typeof it.orderCode === 'string', 'orderCode');
      assert('totalAmount' in it, 'totalAmount');
      assert('status' in it, 'status');
      assert('paymentStatus' in it, 'paymentStatus');
      assert('paymentMethod' in it, 'paymentMethod');
      assert('createdAt' in it, 'createdAt');
    }
  },
});

tests.push({
  name: 'UC-17 low-stock-threshold-200',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/low-stock?threshold=200&limit=10', { token: adm.token });
    assertEq(r.status, 200, 'status');
    const data = r.json?.data ?? r.json;
    assert(Array.isArray(data.items), 'items array');
    // With threshold 200, most books should appear
    assert(data.items.length > 0, 'expected some low-stock rows below 200');
    for (const it of data.items) {
      assert(typeof it.id === 'string', 'id');
      assert(typeof it.title === 'string', 'title');
      assert(typeof it.slug === 'string', 'slug');
      assert(typeof it.stockQuantity === 'number', 'stockQuantity');
      assert(it.stockQuantity < 200, `stock < threshold, got ${it.stockQuantity}`);
    }
  },
});

tests.push({
  name: 'UC-17 inventory-summary-shape',
  fn: async () => {
    const adm = await loginAdmin();
    const r = await api('GET', '/admin/reports/inventory-summary', { token: adm.token });
    assertEq(r.status, 200, 'status');
    const data = r.json?.data ?? r.json;
    for (const k of ['totalTitles', 'totalQuantity', 'lowStockCount', 'inventoryValue']) {
      assert(typeof data[k] === 'number', `${k} numeric`);
    }
  },
});

tests.push({
  name: 'UC-17 export-csv-revenue',
  fn: async () => {
    const adm = await loginAdmin();
    const url = '/admin/reports/export?type=revenue';
    const res = await api('GET', url, { token: adm.token, raw: true });
    assertEq(res.status, 200, 'export status');
    const ct = res.headers.get('content-type') || '';
    assert(ct.toLowerCase().includes('text/csv'), `csv content-type, got: ${ct}`);
    const body = await res.text();
    const firstLine = body.split('\n')[0];
    assertEq(firstLine.trim(), 'date,revenue_vnd,order_count', `header: ${firstLine}`);
  },
});

tests.push({
  name: 'UC-17 non-admin-403 (staff and customer)',
  fn: async () => {
    const staff = await loginStaff();
    const r1 = await api('GET', '/admin/reports/overview', { token: staff.token });
    assertEq(r1.status, 403, `staff expected 403, got ${r1.status}`);
    const cust = await loginCustomer1();
    const r2 = await api('GET', '/admin/reports/overview', { token: cust.token });
    assertEq(r2.status, 403, `customer expected 403, got ${r2.status}`);
  },
});

export default tests;
