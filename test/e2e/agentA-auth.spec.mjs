// UC-01 Register & UC-02 Login + lockout + logout-revokes-refresh
import {
  api,
  assert,
  assertEq,
  login,
  loginAdmin,
  randomEmail,
  registerAndVerify,
  waitForVerifyToken,
} from './helpers.mjs';

const tests = [];

tests.push({
  name: 'UC-01 register-happy: register -> verify-email via /tmp/be.log token',
  fn: async () => {
    const email = randomEmail('reg-happy');
    const password = 'Passw0rd!';
    const reg = await api('POST', '/auth/register', {
      body: { email, password, confirmPassword: password, fullName: 'Happy' },
      expectStatus: 201,
    });
    assert(reg.json?.success === true, 'register success flag');

    const token = await waitForVerifyToken(email);
    assert(token && token.length > 10, 'extracted verify token');

    const verify = await api(
      'GET',
      `/auth/verify-email?token=${encodeURIComponent(token)}`,
      { expectStatus: 200 },
    );
    assert(verify.json?.success === true, 'verify success');

    // After verify, the user can log in.
    const r = await login(email, password);
    assertEq(r.user.role, 'CUSTOMER', 'role after verify');
  },
});

tests.push({
  name: 'UC-01 register-duplicate: 2nd registration with same email -> 409',
  fn: async () => {
    const email = randomEmail('dup');
    const body = {
      email,
      password: 'Passw0rd!',
      confirmPassword: 'Passw0rd!',
      fullName: 'Dup',
    };
    await api('POST', '/auth/register', { body, expectStatus: 201 });
    const second = await api('POST', '/auth/register', { body });
    assert(
      second.status === 409 || second.status === 400,
      `duplicate should be 409/400 got ${second.status}`,
    );
    assert(second.json?.success === false, 'duplicate success=false');
  },
});

tests.push({
  name: 'UC-01 register-weak-password: weak password -> 400 with field error',
  fn: async () => {
    const email = randomEmail('weak');
    const res = await api('POST', '/auth/register', {
      body: {
        email,
        password: 'abc',
        confirmPassword: 'abc',
        fullName: 'Weak',
      },
    });
    assertEq(res.status, 400, 'weak password 400');
    assert(res.json?.success === false, 'success=false');
    // Either errors[] or message should mention password
    const blob = JSON.stringify(res.json).toLowerCase();
    assert(
      blob.includes('mật khẩu') || blob.includes('password'),
      'error mentions password field',
    );
  },
});

tests.push({
  name: 'UC-02 login-happy: returns access token + role=CUSTOMER',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Login Happy' });
    assert(u.token && u.token.length > 20, 'has access token');
    assertEq(u.user.role, 'CUSTOMER', 'role customer');
  },
});

tests.push({
  name: 'UC-02 login-wrong-password: 401 generic message',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Login Wrong' });
    const res = await api('POST', '/auth/login', {
      body: { email: u.email, password: 'Wrong-Password-1' },
    });
    assertEq(res.status, 401, 'wrong password 401');
    const msg = String(res.json?.message || '').toLowerCase();
    assert(
      msg.includes('email') || msg.includes('mật khẩu'),
      'generic credentials message',
    );
  },
});

tests.push({
  name: 'UC-02 login-lockout: 5 wrong attempts trigger lock; admin unlocks',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Lockout' });
    // Five consecutive wrong attempts.
    let lastStatus = 0;
    let lastJson = null;
    for (let i = 0; i < 5; i += 1) {
      const r = await api('POST', '/auth/login', {
        body: { email: u.email, password: 'Wrong-Password-X' },
      });
      lastStatus = r.status;
      lastJson = r.json;
    }
    // The 5th attempt returns 403 with the lockout message.
    assertEq(lastStatus, 403, 'lockout on 5th wrong attempt');
    const msg = String(lastJson?.message || '');
    assert(msg.includes('khoá') || msg.includes('khóa'), 'message mentions khoá');

    // 6th attempt — even with correct password — must still be locked.
    const sixth = await api('POST', '/auth/login', {
      body: { email: u.email, password: u.password },
    });
    assertEq(sixth.status, 403, '6th attempt still locked');

    // Cleanup: admin unlocks.
    const admin = await loginAdmin();
    const list = await api('GET', `/admin/users?keyword=${encodeURIComponent(u.email)}`, {
      token: admin.token,
      expectStatus: 200,
    });
    const target = list.json?.data?.items?.find((x) => x.email === u.email);
    assert(target, 'admin can find locked user');
    await api('PATCH', `/admin/users/${target.id}/status`, {
      token: admin.token,
      body: { status: 'ACTIVE' },
      expectStatus: 200,
    });
  },
});

tests.push({
  name: 'UC-02 logout-revokes-refresh: refresh works once, fails after logout',
  fn: async () => {
    const u = await registerAndVerify({ fullName: 'Logout' });
    assert(u.refreshCookie, 'login set a refresh cookie');

    // First refresh — should succeed.
    const refreshed = await api('POST', '/auth/refresh', {
      cookie: `refreshToken=${u.refreshCookie}`,
    });
    assertEq(refreshed.status, 200, 'first refresh ok');
    const newCookie = refreshed.refreshCookie;
    assert(newCookie, 'refresh rotated cookie');

    // Logout (uses access token + refresh cookie).
    const logout = await api('POST', '/auth/logout', {
      token: u.token,
      cookie: `refreshToken=${newCookie}`,
      expectStatus: 200,
    });
    assert(logout.json?.success === true, 'logout ok');

    // Subsequent refresh on the rotated (now-revoked) cookie fails.
    const after = await api('POST', '/auth/refresh', {
      cookie: `refreshToken=${newCookie}`,
    });
    assertEq(after.status, 401, 'refresh after logout -> 401');
  },
});

export default tests;
