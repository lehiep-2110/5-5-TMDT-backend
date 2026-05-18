// Shared helpers for Agent A E2E tests.
// Talks to a live backend on port 8001. No external dependencies.

import { readFile } from 'node:fs/promises';

export const BASE = process.env.E2E_BASE || 'http://localhost:8001/api';
export const BE_LOG = process.env.E2E_BE_LOG || '/tmp/be.log';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Make an HTTP request against the live backend.
 *
 * Returns { status, json, text } where `json` is null if the body wasn't JSON.
 * If `expectStatus` is supplied, throws when the status doesn't match.
 *
 * Cookies passed via `cookie` (string) are forwarded as the `Cookie` header.
 * If the response sets a `refreshToken` cookie, it is exposed via `setCookie`.
 */
export async function api(method, path, opts = {}) {
  const { token, body, expectStatus, cookie, headers: extraHeaders, raw } =
    opts;
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...(extraHeaders || {}) };
  let payload;
  if (body !== undefined) {
    if (raw) {
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const refreshCookie = extractRefreshCookie(setCookie);

  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(
      `[${method} ${path}] expected ${expectStatus} got ${res.status}: ${text.slice(
        0,
        300,
      )}`,
    );
  }
  return { status: res.status, json, text, setCookie, refreshCookie };
}

function extractRefreshCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // set-cookie may be a single string with multiple cookies separated by commas
  // (Node fetch joins them). Look for refreshToken=...
  const m = setCookieHeader.match(/refreshToken=([^;,\s]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Login helpers
// ---------------------------------------------------------------------------

export async function login(email, password) {
  const { status, json, refreshCookie } = await api('POST', '/auth/login', {
    body: { email, password },
  });
  if (status !== 200 || !json?.success) {
    throw new Error(
      `login(${email}) failed: status=${status} body=${JSON.stringify(json)}`,
    );
  }
  return {
    token: json.data.accessToken,
    user: json.data.user,
    refreshCookie,
  };
}

export const loginAdmin = () => login('admin@bookstore.vn', 'Admin@123');
export const loginStaff = () => login('staff@bookstore.vn', 'Staff@123');
export const loginCustomer1 = () => login('customer1@test.com', 'Customer@123');

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

export function randomEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}@test.com`;
}

export function randomSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// /tmp/be.log token poller
// ---------------------------------------------------------------------------

/**
 * Poll the BE log for the most recent verify-email token issued for `email`.
 *
 * Looks for `Verify link: http://...?token=<uuid>`. Returns the latest token
 * for the given email (matched by the To: ... — Verify line).
 */
export async function waitForVerifyToken(email, { timeoutMs = 5000 } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const text = await readFile(BE_LOG, 'utf8');
      // strip ANSI escape sequences so the regex matches reliably
      const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
      // Each verify line: "[MOCK EMAIL] To: <email> — Verify link: <url>?token=<uuid>"
      const re = new RegExp(
        `To:\\s*${escapeRegex(email)}\\s+—?\\s*-?\\s*Verify link:\\s*([^\\s]+)`,
        'gi',
      );
      // Some terminals print the dash differently — simpler regex: find lines with email and Verify link
      const fallbackRe = new RegExp(
        `To:\\s*${escapeRegex(email)}[^\\n]*Verify link:\\s*(\\S+)`,
        'gi',
      );
      let match;
      let lastUrl = null;
      while ((match = fallbackRe.exec(stripped)) !== null) {
        lastUrl = match[1];
      }
      if (lastUrl) {
        const tokMatch = lastUrl.match(/token=([\w-]+)/);
        if (tokMatch) return tokMatch[1];
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(150);
  }
  throw new Error(
    `Timed out waiting for verify token for ${email} in ${BE_LOG}: ${lastErr?.message ?? 'no match'}`,
  );
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

/**
 * Run a list of `{name, fn}` test cases sequentially. Each `fn` is invoked
 * and may throw to indicate failure. Prints pass/fail and returns a summary.
 */
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

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

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

/**
 * Helper to register and verify a brand-new customer in one shot.
 * Returns { email, password, userId, fullName }.
 */
export async function registerAndVerify({
  email = randomEmail(),
  password = 'Passw0rd!',
  fullName = 'E2E Test User',
} = {}) {
  const reg = await api('POST', '/auth/register', {
    body: { email, password, confirmPassword: password, fullName },
  });
  if (reg.status !== 201) {
    throw new Error(
      `register failed: status=${reg.status} body=${reg.text.slice(0, 200)}`,
    );
  }
  const token = await waitForVerifyToken(email);
  const verify = await api(
    'GET',
    `/auth/verify-email?token=${encodeURIComponent(token)}`,
    { expectStatus: 200 },
  );
  // status 200 ok, login next
  const loggedIn = await login(email, password);
  return {
    email,
    password,
    fullName,
    user: loggedIn.user,
    token: loggedIn.token,
    refreshCookie: loggedIn.refreshCookie,
    verifyOk: !!verify.json?.success,
  };
}
