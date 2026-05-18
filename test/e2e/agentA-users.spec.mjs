// UC-08 Account, UC-11 Internal login, UC-15 Admin user mgmt
import {
  api,
  assert,
  assertEq,
  login,
  loginAdmin,
  loginCustomer1,
  loginStaff,
  registerAndVerify,
} from './helpers.mjs';

const tests = [];

const SAMPLE_ADDR = (suffix = '') => ({
  recipientName: `Người nhận ${suffix}`.trim(),
  phone: '0900111222',
  province: 'Hà Nội',
  district: 'Cầu Giấy',
  ward: 'Dịch Vọng',
  streetAddress: `Số ${suffix || 1}, Phố Test`,
});

tests.push({
  name: 'UC-08 get-me: returns id, email, role for current user',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Me User' });
    const res = await api('GET', '/users/me', {
      token: u.token,
      expectStatus: 200,
    });
    const me = res.json?.data;
    assert(me?.id, 'has id');
    assertEq(me?.email, u.email, 'email matches');
    assertEq(me?.role, 'CUSTOMER', 'role is customer');
  },
});

tests.push({
  name: 'UC-08 patch-me: change phone reflects on next GET',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Patch Me' });
    const newPhone = '0987654321';
    const patch = await api('PATCH', '/users/me', {
      token: u.token,
      body: { phone: newPhone },
      expectStatus: 200,
    });
    assertEq(patch.json?.data?.phone, newPhone, 'patch returns new phone');
    const after = await api('GET', '/users/me', {
      token: u.token,
      expectStatus: 200,
    });
    assertEq(after.json?.data?.phone, newPhone, 'GET reflects new phone');
  },
});

tests.push({
  name: 'UC-08 address-crud: create 2, default toggles, delete migrates default',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Addr CRUD' });
    const a1 = await api('POST', '/users/me/addresses', {
      token: u.token,
      body: SAMPLE_ADDR('1'),
      expectStatus: 201,
    });
    const a2 = await api('POST', '/users/me/addresses', {
      token: u.token,
      body: SAMPLE_ADDR('2'),
      expectStatus: 201,
    });
    const list = await api('GET', '/users/me/addresses', {
      token: u.token,
      expectStatus: 200,
    });
    const items = list.json?.data || [];
    assertEq(items.length, 2, 'list has 2 addresses');

    // a1 was created first so it should be default; a2 wasn't.
    const id1 = a1.json?.data?.id;
    const id2 = a2.json?.data?.id;
    assert(items.find((x) => x.id === id1)?.isDefault === true, 'a1 default');
    assert(items.find((x) => x.id === id2)?.isDefault === false, 'a2 not default');

    // Mark a2 as default — a1 should auto-clear.
    await api('PATCH', `/users/me/addresses/${id2}`, {
      token: u.token,
      body: { isDefault: true },
      expectStatus: 200,
    });
    const list2 = await api('GET', '/users/me/addresses', {
      token: u.token,
      expectStatus: 200,
    });
    const items2 = list2.json?.data || [];
    assertEq(
      items2.find((x) => x.id === id2)?.isDefault,
      true,
      'a2 default after toggle',
    );
    assertEq(
      items2.find((x) => x.id === id1)?.isDefault,
      false,
      'a1 cleared',
    );

    // Delete a2 (the default). a1 should become default automatically.
    await api('DELETE', `/users/me/addresses/${id2}`, {
      token: u.token,
      expectStatus: 200,
    });
    const list3 = await api('GET', '/users/me/addresses', {
      token: u.token,
      expectStatus: 200,
    });
    const items3 = list3.json?.data || [];
    assertEq(items3.length, 1, 'one address left');
    assertEq(items3[0].id, id1, 'remaining is a1');
    assertEq(items3[0].isDefault, true, 'a1 auto-promoted to default');
  },
});

tests.push({
  name: 'UC-08 address-max-5: 6th address rejected with 400',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Addr Max' });
    for (let i = 1; i <= 5; i += 1) {
      await api('POST', '/users/me/addresses', {
        token: u.token,
        body: SAMPLE_ADDR(String(i)),
        expectStatus: 201,
      });
    }
    const sixth = await api('POST', '/users/me/addresses', {
      token: u.token,
      body: SAMPLE_ADDR('6'),
    });
    assertEq(sixth.status, 400, '6th must be 400');
    const msg = String(sixth.json?.message || '');
    assert(msg.includes('5') || msg.toLowerCase().includes('max'), 'mentions limit');
  },
});

tests.push({
  name: 'UC-08 change-password: old fails after change, new works',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'CP User' });
    const newPw = 'NewPassw0rd!';
    await api('POST', '/users/me/change-password', {
      token: u.token,
      body: {
        oldPassword: u.password,
        newPassword: newPw,
        confirmPassword: newPw,
      },
      expectStatus: 200,
    });
    // Old password fails.
    const oldLogin = await api('POST', '/auth/login', {
      body: { email: u.email, password: u.password },
    });
    assertEq(oldLogin.status, 401, 'old password rejected');
    // New password works.
    const next = await login(u.email, newPw);
    assertEq(next.user.email, u.email, 'new password login ok');
  },
});

tests.push({
  name: 'UC-11 admin-login: role=ADMIN; can list /admin/users; customer cannot',
  fn: async () => {
    const a = await loginAdmin();
    assertEq(a.user.role, 'ADMIN', 'role admin');

    const okList = await api('GET', '/admin/users', {
      token: a.token,
      expectStatus: 200,
    });
    assert(Array.isArray(okList.json?.data?.items), 'admin sees user list');

    const c = await loginCustomer1();
    const denied = await api('GET', '/admin/users', { token: c.token });
    assertEq(denied.status, 403, 'customer 403');
  },
});

tests.push({
  name: 'UC-11 staff-login: role=WAREHOUSE_STAFF',
  fn: async () => {
    const s = await loginStaff();
    assertEq(s.user.role, 'WAREHOUSE_STAFF', 'role staff');
  },
});

tests.push({
  name: 'UC-15 lock-customer: PATCH status=LOCKED revokes refresh tokens',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Lock Target' });
    assert(u.refreshCookie, 'has refresh cookie');

    const admin = await loginAdmin();
    await api('PATCH', `/admin/users/${u.user.id}/status`, {
      token: admin.token,
      body: { status: 'LOCKED' },
      expectStatus: 200,
    });

    // refresh now must fail (Redis & DB cleared by revokeAllForUser).
    const r = await api('POST', '/auth/refresh', {
      cookie: `refreshToken=${u.refreshCookie}`,
    });
    assertEq(r.status, 401, 'refresh after LOCK -> 401');

    // Cleanup: unlock for hygiene.
    await api('PATCH', `/admin/users/${u.user.id}/status`, {
      token: admin.token,
      body: { status: 'ACTIVE' },
      expectStatus: 200,
    });
  },
});

export default tests;
