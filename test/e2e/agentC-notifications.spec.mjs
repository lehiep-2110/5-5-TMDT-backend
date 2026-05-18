// UC-10 SSE Notifications + UC-18 Admin Broadcast
import {
  api,
  assert,
  assertEq,
  loginAdmin,
  loginCustomer1,
  sleep,
  BASE,
  BACKEND_ORIGIN,
} from './helpers-c.mjs';

const tests = [];

tests.push({
  name: 'UC-10 unread-count-baseline',
  fn: async () => {
    const c = await loginCustomer1();
    const r = await api('GET', '/notifications/unread-count', { token: c.token });
    assertEq(r.status, 200, 'unread-count status');
    const data = r.json?.data ?? r.json;
    assert(typeof data.count === 'number', `count numeric, got ${typeof data.count}`);
    assert(data.count >= 0, 'count >= 0');
    globalThis.__C_n_baseline = data.count;
  },
});

tests.push({
  name: 'UC-18 admin-broadcast-target-all',
  fn: async () => {
    const adm = await loginAdmin();
    const c1 = await loginCustomer1();
    const beforeUnread = await api('GET', '/notifications/unread-count', { token: c1.token });
    const beforeCount = (beforeUnread.json?.data ?? beforeUnread.json)?.count ?? 0;

    const title = `E2E Broadcast ${Date.now()}`;
    const r = await api('POST', '/admin/notifications', {
      token: adm.token,
      body: { target: 'all', title, content: 'Test broadcast all' },
    });
    assertEq(r.status, 200, 'broadcast status');
    const data = r.json?.data ?? r.json;
    assert(typeof data.sent === 'number' && data.sent >= 1, `sent should be >=1 got ${data.sent}`);
    globalThis.__C_n_lastTitle = title;

    // Verify customer1 sees it
    const list = await api('GET', '/notifications?page=1&limit=5', { token: c1.token });
    const items = (list.json?.data ?? list.json)?.items ?? [];
    const found = items.find((n) => n.title === title);
    assert(found, `notification with title ${title} not found in latest list`);

    const after = await api('GET', '/notifications/unread-count', { token: c1.token });
    const afterCount = (after.json?.data ?? after.json)?.count ?? 0;
    assert(afterCount > beforeCount, `unread should increase: before=${beforeCount} after=${afterCount}`);
  },
});

tests.push({
  name: 'UC-18 admin-broadcast-targeted',
  fn: async () => {
    const adm = await loginAdmin();
    const c1 = await loginCustomer1();
    const r = await api('POST', '/admin/notifications', {
      token: adm.token,
      body: { target: [c1.user.id], title: `E2E Targeted ${Date.now()}`, content: 'Hello target' },
    });
    assertEq(r.status, 200, 'broadcast targeted status');
    const data = r.json?.data ?? r.json;
    assertEq(data.sent, 1, 'sent=1');
  },
});

tests.push({
  name: 'UC-10 mark-read-decrements-unread',
  fn: async () => {
    const c = await loginCustomer1();
    // Find latest unread notif
    const list = await api('GET', '/notifications?page=1&limit=20&unreadOnly=true', { token: c.token });
    const items = (list.json?.data ?? list.json)?.items ?? [];
    if (items.length === 0) {
      // Force one by broadcasting
      const adm = await loginAdmin();
      await api('POST', '/admin/notifications', {
        token: adm.token,
        body: { target: [c.user.id], title: `MarkRead ${Date.now()}`, content: 'x' },
      });
      const refreshed = await api('GET', '/notifications?page=1&limit=20&unreadOnly=true', { token: c.token });
      const its = (refreshed.json?.data ?? refreshed.json)?.items ?? [];
      assert(its.length > 0, 'have unread after broadcast');
      var pick = its[0];
    } else {
      var pick = items[0];
    }
    const before = await api('GET', '/notifications/unread-count', { token: c.token });
    const beforeCount = (before.json?.data ?? before.json)?.count ?? 0;

    const r = await api('PATCH', `/notifications/${pick.id}/read`, { token: c.token });
    assertEq(r.status, 200, 'mark-read status');
    const body = r.json?.data ?? r.json;
    assertEq(body.isRead, true, 'isRead=true after PATCH');

    const after = await api('GET', '/notifications/unread-count', { token: c.token });
    const afterCount = (after.json?.data ?? after.json)?.count ?? 0;
    assert(afterCount === beforeCount - 1, `count expected to drop by 1: before=${beforeCount} after=${afterCount}`);
  },
});

tests.push({
  name: 'UC-10 mark-all-read-zeroes-unread',
  fn: async () => {
    const c = await loginCustomer1();
    const r = await api('POST', '/notifications/read-all', { token: c.token });
    assertEq(r.status, 200, 'read-all status');
    const after = await api('GET', '/notifications/unread-count', { token: c.token });
    const count = (after.json?.data ?? after.json)?.count ?? -1;
    assertEq(count, 0, 'unread = 0 after read-all');
  },
});

tests.push({
  name: 'UC-10 sse-stream-headers-and-first-chunk',
  fn: async () => {
    const c = await loginCustomer1();
    const ctrl = new AbortController();
    const url = `${BASE}/notifications/stream?token=${encodeURIComponent(c.token)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    try {
      assertEq(res.status, 200, 'stream status');
      const ct = res.headers.get('content-type') || '';
      assert(ct.toLowerCase().includes('text/event-stream'), `content-type should include event-stream, got: ${ct}`);

      // Read first chunk with a 5s timeout
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const start = Date.now();
      let received = '';
      while (Date.now() - start < 5000) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), 5100 - (Date.now() - start))),
        ]);
        if (done) break;
        if (!value) continue;
        received += decoder.decode(value, { stream: true });
        if (received.includes(':') || received.includes('data:')) break;
      }
      assert(received.includes(':') || received.includes('data:'), `expected SSE-style line, got: ${received.slice(0, 200)}`);
      try { reader.cancel(); } catch {}
    } finally {
      ctrl.abort();
    }
  },
});

tests.push({
  name: 'UC-10 sse-receives-broadcast',
  fn: async () => {
    const c = await loginCustomer1();
    const adm = await loginAdmin();
    const ctrl = new AbortController();
    const url = `${BASE}/notifications/stream?token=${encodeURIComponent(c.token)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    try {
      assertEq(res.status, 200, 'stream status');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Wait briefly for stream registration
      await sleep(300);

      const title = `SSE-Push-${Date.now()}`;
      const broadcastP = api('POST', '/admin/notifications', {
        token: adm.token,
        body: { target: [c.user.id], title, content: 'SSE push payload' },
      });

      const start = Date.now();
      let buffer = '';
      let gotIt = false;
      while (Date.now() - start < 5000) {
        const remaining = 5000 - (Date.now() - start);
        const result = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining + 50)),
        ]);
        if (result?.timeout) break;
        if (result.done) break;
        if (!result.value) continue;
        buffer += decoder.decode(result.value, { stream: true });
        if (buffer.includes(title)) {
          gotIt = true;
          break;
        }
      }
      await broadcastP.catch(() => {});
      assert(gotIt, `expected SSE to deliver "${title}". buffer head: ${buffer.slice(0, 300)}`);
      try { reader.cancel(); } catch {}
    } finally {
      ctrl.abort();
    }
  },
});

tests.push({
  name: 'UC-10 sse-bad-token-401',
  fn: async () => {
    const url = `${BASE}/notifications/stream?token=not-a-real-token`;
    const res = await fetch(url);
    // drain body to free socket
    try { await res.text(); } catch {}
    assertEq(res.status, 401, 'bad token => 401');
  },
});

export default tests;
