/**
 * Authentication and password-recovery suite.
 *
 * Covers the eighteen required cases. It starts its own API server and a local
 * stand-in for the email provider, so the reset link is captured the same way a
 * real inbox would receive it. That matters: the raw token exists nowhere but
 * the email, so a suite that invented one would not be testing the real flow.
 *
 * Requires a DEV/TEST database with migrations 0000-0003 applied and no user
 * account. The suite creates one and removes it on the way out.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm verify:auth
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const url = process.env.DATABASE_URL;
const RUN = `authtest-${Date.now().toString(36)}`;
const REPO = path.resolve(import.meta.dirname, '../..');

const EMAIL = `${RUN}@example.com`;
const PASSWORD = 'original-passphrase-42';
const NEW_PASSWORD = 'replacement-passphrase-77';
const THIRD_PASSWORD = 'third-passphrase-99';

if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
// Guard against pointing a stateful suite at production. A hosted *branch* is a
// genuinely separate database, so it can be allowed deliberately once someone
// has confirmed the endpoints differ.
const looksProduction = /onrender\.com|supabase\.co|neon\.tech|amazonaws\.com|rds\./i.test(url);
if (looksProduction && process.env.ALLOW_PROVIDER_HOST !== '1') {
  console.error(
    'This host looks like a production provider. Refusing to run.\n' +
      'If it is a verified development branch, re-run with ALLOW_PROVIDER_HOST=1.',
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

const numbered = (n, label) => console.log(`\n${n}. ${label}`);
const section = (title) => console.log(`\n== ${title} ==`);

/** Emails the mock provider received, newest last. */
const inbox = [];

function startMockEmailProvider() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        inbox.push({ to: parsed.to?.[0], subject: parsed.subject, text: parsed.text });
      } catch {
        inbox.push({ to: null, subject: null, text: body });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Pulls the reset token out of the most recent email to the given address. */
function tokenFromLatestEmail(to) {
  const message = [...inbox].reverse().find((entry) => entry.to === to);
  if (!message?.text) return null;
  const match = message.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function startApiServer(port, emailPort) {
  // The API is started from its build output rather than through a TS loader,
  // so the suite exercises the same bundle that gets deployed.
  const apiDir = path.join(REPO, 'artifacts/api-server');
  if (!fs.existsSync(path.join(apiDir, 'dist/index.mjs'))) {
    throw new Error(
      'artifacts/api-server/dist/index.mjs is missing. Run `pnpm --filter @workspace/api-server build` first.',
    );
  }

  const child = spawn('node', ['./dist/index.mjs'], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      RESEND_API_KEY: 'test-key-not-real',
      RESEND_ENDPOINT: `http://127.0.0.1:${emailPort}/emails`,
      // Lower scrypt cost so the suite is not dominated by key derivation.
      PASSWORD_SCRYPT_N: '4096',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return { child, logs };
    } catch {
      // not listening yet
    }
  }
  child.kill('SIGKILL');
  throw new Error(`API server did not start:\n${logs.join('')}`);
}

/** A cookie-aware client; each instance is a separate device. */
function makeClient(label) {
  const jar = new Map();

  const absorb = (response) => {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /expires=thu, 01 jan 1970/i.test(entry)) jar.delete(name);
      else jar.set(name, value);
    }
  };

  const base = `http://127.0.0.1:${basePort}/api`;

  return {
    label,
    /** Raw Set-Cookie headers seen by this client, for attribute assertions. */
    setCookieHeaders: [],
    get cookies() {
      return Object.fromEntries(jar);
    },
    async call(method, endpoint, body) {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (jar.size) headers.cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
      const response = await fetch(`${base}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      this.setCookieHeaders.push(...(response.headers.getSetCookie?.() ?? []));
      absorb(response);
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed, raw: text };
    },
    get(endpoint) {
      return this.call('GET', endpoint);
    },
    post(endpoint, body) {
      return this.call('POST', endpoint, body ?? {});
    },
  };
}

let basePort = 0;

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  const email = await startMockEmailProvider();
  basePort = 4200 + (process.pid % 300);
  const server = await startApiServer(basePort, email.port);
  console.log(`\nAuthentication verification  (${RUN})`);
  console.log(`API:  http://127.0.0.1:${basePort}/api`);
  console.log(`Mail:  local stand-in on 127.0.0.1:${email.port}`);

  let currentToken = null;

  try {
    section('Preflight');
    const { rows: existing } = await db.query('select count(*)::int as n from users');
    if (existing[0].n > 0) {
      console.log('  A user already exists; run against a clean DEV database.');
      process.exitCode = 1;
      return;
    }
    check('no account exists yet, so setup can run', existing[0].n === 0);

    const anon = makeClient('anon');
    check('financial data is refused without a session',
      (await anon.get('/expenses')).status === 401);
    check('the refusal leaks no data',
      !JSON.stringify((await anon.get('/expenses')).body).includes('amount'));
    check('state reports setup is needed',
      (await anon.get('/auth/state')).body?.needsSetup === true);
    check('state reports no session',
      (await anon.get('/auth/state')).body?.authenticated === false);

    // ---------------------------------------------------------- account + login
    section('Account creation');
    const owner = makeClient('device-a');
    const setup = await owner.post('/auth/setup', {
      email: EMAIL,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    check('setup creates the account and signs in', setup.status === 201, JSON.stringify(setup.body));
    check('a session cookie is issued', Boolean(owner.cookies['pocketful_session']));
    const cookie = owner.cookies['pocketful_session'];
    const sessionCookieHeader = owner.setCookieHeaders.find((entry) =>
      entry.startsWith('pocketful_session='));
    check('the session cookie is HttpOnly', /HttpOnly/i.test(sessionCookieHeader ?? ''),
      sessionCookieHeader);
    check('the session cookie is SameSite=Lax', /SameSite=Lax/i.test(sessionCookieHeader ?? ''),
      sessionCookieHeader);
    check('the session cookie is scoped to the site',
      /Path=\//i.test(sessionCookieHeader ?? ''), sessionCookieHeader);

    const { rows: sessionRow } = await db.query(
      'select token_hash from sessions order by created_at desc limit 1',
    );
    check('the cookie value is never stored as-is', cookie !== sessionRow[0].token_hash);
    check('the stored session value is a sha256 digest',
      /^[0-9a-f]{64}$/.test(sessionRow[0].token_hash));

    const me = await owner.get('/auth/me');
    check('the session resolves to the account', me.body?.user?.email === EMAIL);
    // The response legitimately carries passwordChangedAt (a timestamp), so this
// looks for anything that could actually be a secret rather than the word.
    check('the account payload carries no hash or secret',
      !/scrypt\$|\$scrypt|passwordHash|"password"\s*:/i.test(me.raw),
      me.raw.slice(0, 200));

    const second = makeClient('device-b');
    check('a second device can sign in',
      (await second.post('/auth/login', { email: EMAIL, password: PASSWORD })).status === 200);
    check('the second device holds a different cookie',
      second.cookies['pocketful_session'] !== cookie);
    check('the second device can read data', (await second.get('/auth/me')).status === 200);

    // ------------------------------------------------------ 1, 2, 3: existence
    numbered(1, 'Forgot password with a registered email');
    const known = await owner.post('/auth/forgot-password', { email: EMAIL });
    check('the request succeeds', known.status === 200, `status ${known.status}`);
    check('an email was actually sent', inbox.some((m) => m.to === EMAIL));

    numbered(2, 'Forgot password with an unknown email');
    const unknown = await owner.post('/auth/forgot-password', {
      email: `nobody-${RUN}@example.com`,
    });
    check('the request succeeds', unknown.status === 200, `status ${unknown.status}`);
    check('no email was sent for the unknown address',
      !inbox.some((m) => m.to === `nobody-${RUN}@example.com`));

    numbered(3, 'Both responses are indistinguishable');
    check('both status codes match', known.status === unknown.status);
    check('both bodies are byte-identical', known.raw === unknown.raw,
      JSON.stringify({ known: known.body, unknown: unknown.body }));
    check('the wording is the generic one',
      known.body?.message ===
        'If an account exists for this email, a password reset link has been sent.',
      JSON.stringify(known.body));

    // ------------------------------------------------------- 4, 5, 17: the token
    numbered(4, 'A reset token is generated');
    const liveToken = tokenFromLatestEmail(EMAIL);
    check('a reset link reached the inbox', Boolean(liveToken));
    check('the token is long and random-looking',
      Boolean(liveToken) && liveToken.length >= 40, `${liveToken?.length} chars`);
    // Two separate requests must not hand out the same token.
    await owner.post('/auth/forgot-password', { email: EMAIL });
    const secondToken = tokenFromLatestEmail(EMAIL);
    check('a second request issues a different token',
      Boolean(secondToken) && secondToken !== liveToken,
      `${liveToken?.slice(0, 12)}… vs ${secondToken?.slice(0, 12)}…`);
    check('each request creates exactly one token row',
      (await db.query('select count(*)::int as n from password_reset_tokens')).rows[0].n === 1,
      'the previous unused token should have been replaced');
    // Keep using the newest token from here on.
    currentToken = secondToken;

    numbered(5, 'The token is stored hashed');
    const { rows: tokenRows } = await db.query(
      'select token_hash from password_reset_tokens order by created_at desc limit 1',
    );
    const tokenHash = tokenRows[0].token_hash;
    check('the stored value is a 64-char hex sha256 digest', /^[0-9a-f]{64}$/.test(tokenHash));
    check('the stored value is not the raw token', tokenHash !== liveToken);
    check('the raw token appears nowhere in the row', !JSON.stringify(tokenRows).includes(liveToken));
    const { rows: rawSearch } = await db.query(
      'select count(*)::int as n from password_reset_tokens where token_hash = $1', [liveToken],
    );
    check('the raw token cannot be used to look the row up', rawSearch[0].n === 0);

    numbered(17, 'The reset token is never returned in an API response');
    check('forgot-password returns no token',
      !known.raw.includes(liveToken) && !/token/i.test(known.raw), known.raw);
    check('no other response echoes it',
      ![me.raw, unknown.raw].some((text) => text.includes(liveToken)));

    // --------------------------------------------------------- 18: no secret logs
    numbered(18, 'Passwords and reset secrets never appear in logs');
    const { rows: userRows } = await db.query('select password_hash from users');
    const storedHash = userRows[0].password_hash;
    check('the password is not stored in the clear', !storedHash.includes(PASSWORD));
    check('the hash is a self-describing scrypt digest',
      /^scrypt\$\d+\$\d+\$\d+\$/.test(storedHash), storedHash.slice(0, 32));
    check('the hash carries a per-user random salt',
      Buffer.from(storedHash.split('$')[4], 'base64').length >= 16);
    const logText = server.logs.join('');
    check('the password never reaches the logs', !logText.includes(PASSWORD));
    check('the new password never reaches the logs', !logText.includes(NEW_PASSWORD));
    check('the reset token never reaches the logs', !logText.includes(liveToken));
    check('the email body carries no password',
      !inbox.some((m) => (m.text ?? '').includes(PASSWORD)));

    // ------------------------------------------------------------ 6, 7: expiry
    numbered(6, 'Reset tokens expire');
    const { rows: ttlRows } = await db.query(
      `select extract(epoch from (expires_at - created_at))::int as ttl
       from password_reset_tokens order by created_at desc limit 1`,
    );
    check('the token carries a short expiry',
      ttlRows[0].ttl > 0 && ttlRows[0].ttl <= 1800, `${ttlRows[0].ttl}s`);

    numbered(7, 'An expired token is rejected');
    // Age the row rather than only pushing expires_at back: the table forbids an
// already-expired token, so created_at moves with it to keep the row legal.
    await db.query(
      `update password_reset_tokens
       set created_at = now() - interval '31 minutes',
           expires_at = now() - interval '1 minute'
       where token_hash = (select token_hash from password_reset_tokens order by created_at desc limit 1)`,
    );
    const { rows: agedRows } = await db.query(
      'select extract(epoch from (expires_at - now()))::int as ttl from password_reset_tokens limit 1',
    );
    check('the token is genuinely in the past', agedRows[0].ttl < 0, `${agedRows[0].ttl}s`);
    const expiredAttempt = await owner.post('/auth/reset-password', {
      token: currentToken,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    check('an expired token cannot be redeemed', expiredAttempt.status === 400,
      `status ${expiredAttempt.status}`);
    check('the password is untouched by the expired attempt',
      (await db.query('select password_hash from users')).rows[0].password_hash === storedHash);

    // --------------------------------------------------------- 9, 10, 11: reset
    await owner.post('/auth/forgot-password', { email: EMAIL });
    const goodToken = tokenFromLatestEmail(EMAIL);
    check('a fresh token was issued', Boolean(goodToken) && goodToken !== liveToken);

    numbered(9, 'A valid token allows the password to be reset');
    check('a mismatched confirmation is refused',
      (await owner.post('/auth/reset-password', {
        token: goodToken, password: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x`,
      })).status === 400);
    check('a short password is refused',
      (await owner.post('/auth/reset-password', {
        token: goodToken, password: 'short', confirmPassword: 'short',
      })).status === 400);
    const invented = crypto.randomBytes(32).toString('base64url');
    check('an invented token is refused',
      (await owner.post('/auth/reset-password', {
        token: invented, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD,
      })).status === 400);
    check('a refused attempt changes nothing',
      (await db.query('select password_hash from users')).rows[0].password_hash === storedHash);

    const reset = await owner.post('/auth/reset-password', {
      token: goodToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD,
    });
    check('the reset succeeds', reset.status === 200, JSON.stringify(reset.body));
    check('the reset response contains no token', !reset.raw.includes(goodToken));

    numbered(11, 'The old password no longer works');
    const stale = makeClient('stale');
    const staleAttempt = await stale.post('/auth/login', { email: EMAIL, password: PASSWORD });
    check('the old password is rejected', staleAttempt.status === 401,
      `status ${staleAttempt.status}`);
    check('the wording does not confirm the account exists',
      staleAttempt.body?.error === 'That email and password do not match.',
      JSON.stringify(staleAttempt.body));

    numbered(10, 'The new password works');
    const fresh = makeClient('fresh');
    check('the new password is accepted',
      (await fresh.post('/auth/login', { email: EMAIL, password: NEW_PASSWORD })).status === 200);
    check('the new session can read data', (await fresh.get('/auth/me')).status === 200);

    const { rows: afterReset } = await db.query('select password_hash from users');
    check('the stored hash changed', afterReset[0].password_hash !== storedHash);
    check('the new password is still not stored in the clear',
      !afterReset[0].password_hash.includes(NEW_PASSWORD));
    check('a new salt was used',
      afterReset[0].password_hash.split('$')[4] !== storedHash.split('$')[4]);

    // ---------------------------------------------------------- 8: single use
    numbered(8, 'A used token is rejected');
    const replay = await owner.post('/auth/reset-password', {
      token: goodToken, password: THIRD_PASSWORD, confirmPassword: THIRD_PASSWORD,
    });
    check('the same token cannot be redeemed twice', replay.status === 400,
      `status ${replay.status}`);
    check('the replay wording matches any other failure',
      replay.body?.error === expiredAttempt.body?.error, JSON.stringify(replay.body));
    check('the password is still the one just set',
      (await db.query('select password_hash from users')).rows[0].password_hash ===
      afterReset[0].password_hash);
    check('the token row is marked used',
      (await db.query('select count(*)::int as n from password_reset_tokens where used_at is not null'))
        .rows[0].n >= 1);

    // ----------------------------------------------------- 12: sessions revoked
    numbered(12, 'Existing sessions are invalidated after a reset');
    check('the device that reset is signed out', (await owner.get('/auth/me')).status === 401);
    check('the other device is signed out too', (await second.get('/auth/me')).status === 401);
    // A session created *after* the reset is legitimate (the suite signed in again
// to prove the new password works), so the assertion is that no session issued
// under the old token version survives, not that the table is empty.
const { rows: staleSessions } = await db.query(
  `select count(*)::int as n from sessions s join users u on u.id = s.user_id
   where s.token_version <> u.token_version`,
);
check('no session issued under the old password survives', staleSessions[0].n === 0,
  `${staleSessions[0].n} stale`);
    check('the device can sign in again with the new password',
      (await owner.post('/auth/login', { email: EMAIL, password: NEW_PASSWORD })).status === 200);

    // ------------------------------------------------ 13, 14: change while in
    numbered(14, 'An incorrect current password is rejected');
    check('the wrong current password is refused',
      (await owner.post('/auth/change-password', {
        currentPassword: PASSWORD, newPassword: THIRD_PASSWORD, confirmPassword: THIRD_PASSWORD,
      })).status === 400);
    check('the refusal does not echo the submitted password',
      !(await owner.post('/auth/change-password', {
        currentPassword: PASSWORD, newPassword: THIRD_PASSWORD, confirmPassword: THIRD_PASSWORD,
      })).raw.includes(PASSWORD));
    check('a mismatched confirmation is refused',
      (await owner.post('/auth/change-password', {
        currentPassword: NEW_PASSWORD, newPassword: THIRD_PASSWORD,
        confirmPassword: `${THIRD_PASSWORD}!`,
      })).status === 400);
    check('a refused change left the password intact',
      (await owner.post('/auth/login', { email: EMAIL, password: NEW_PASSWORD })).status === 200);

    numbered(13, 'Changing the password while signed in works');
    const changed = await owner.post('/auth/change-password', {
      currentPassword: NEW_PASSWORD, newPassword: THIRD_PASSWORD, confirmPassword: THIRD_PASSWORD,
    });
    check('the change succeeds', changed.status === 200, JSON.stringify(changed.body));
    check('the caller is signed out', (await owner.get('/auth/me')).status === 401);
    check('the other device is signed out too', (await second.get('/auth/me')).status === 401);
    check('the previous password no longer works',
      (await makeClient('mid').post('/auth/login', { email: EMAIL, password: NEW_PASSWORD }))
        .status === 401);
    check('the newest password works',
      (await makeClient('last').post('/auth/login', { email: EMAIL, password: THIRD_PASSWORD }))
        .status === 200);

    section('Additional invariants');
    check('setup cannot add a second account',
      (await makeClient('again').post('/auth/setup', {
        email: `second-${RUN}@example.com`, password: THIRD_PASSWORD,
        confirmPassword: THIRD_PASSWORD,
      })).status === 409);
    check('sign-in is case-insensitive on the email',
      (await makeClient('case').post('/auth/login', {
        email: EMAIL.toUpperCase(), password: THIRD_PASSWORD,
      })).status === 200);
    check('a weak password is refused',
      (await makeClient('weak').post('/auth/reset-password', {
        token: crypto.randomBytes(32).toString('base64url'),
        password: 'password12345', confirmPassword: 'password12345',
      })).status === 400);

    const signoutClient = makeClient('signout');
    await signoutClient.post('/auth/login', { email: EMAIL, password: THIRD_PASSWORD });
    check('sign-out succeeds', (await signoutClient.post('/auth/logout')).status === 200);
    check('the session is dead afterwards', (await signoutClient.get('/auth/me')).status === 401);

    // Issuing a second link must void the first, so an older email in an inbox
    // cannot be used after a newer one is requested.
    const reused = makeClient('reused');
    await reused.post('/auth/forgot-password', { email: EMAIL });
    const newestToken = tokenFromLatestEmail(EMAIL);
    const superseded = await reused.post('/auth/reset-password', {
      token: currentToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD,
    });
    check('requesting a new reset invalidates the previous link',
      superseded.status === 400,
      `got ${superseded.status} ${JSON.stringify(superseded.body)}`);
    const newestAttempt = await reused.post('/auth/reset-password', {
      token: newestToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD,
    });
    check('the newest link still works',
      newestAttempt.status === 200,
      `got ${newestAttempt.status} ${JSON.stringify(newestAttempt.body)}`);

    // A password change must also void any link issued before it.
    await reused.post('/auth/login', { email: EMAIL, password: NEW_PASSWORD });
    await reused.post('/auth/forgot-password', { email: EMAIL });
    const doomedToken = tokenFromLatestEmail(EMAIL);
    const changeOut = await reused.post('/auth/change-password', {
      currentPassword: NEW_PASSWORD, newPassword: THIRD_PASSWORD,
      confirmPassword: THIRD_PASSWORD,
    });
    const doomedAttempt = await reused.post('/auth/reset-password', {
      token: doomedToken, password: PASSWORD, confirmPassword: PASSWORD,
    });
    check('a password change voids an outstanding reset link',
      changeOut.status === 200 && doomedAttempt.status === 400,
      `change=${changeOut.status} ${JSON.stringify(changeOut.body)} reset=${doomedAttempt.status}`);
    // ----------------------------------------------------------- 15, 16: limits
    numbered(15, 'Reset requests are rate limited');
    const spray = makeClient('spray');
    const sprayStatuses = [];
    let resetLimited = false;
    for (let i = 0; i < 12; i += 1) {
      const response = await spray.post('/auth/forgot-password', { email: `${RUN}-${i}@example.com` });
      sprayStatuses.push(response.status);
      if (response.status === 429) { resetLimited = true; break; }
    }
    check('repeated reset requests are throttled', resetLimited, JSON.stringify(sprayStatuses));

    numbered(16, 'Login attempts are rate limited');
    const brute = makeClient('brute');
    const loginStatuses = [];
    let loginLimited = false;
    for (let i = 0; i < 20; i += 1) {
      const response = await brute.post('/auth/login', { email: EMAIL, password: `wrong-${i}` });
      loginStatuses.push(response.status);
      if (response.status === 429) { loginLimited = true; break; }
    }
    check('repeated login attempts are throttled', loginLimited, JSON.stringify(loginStatuses));
    // Every client in this suite originates from 127.0.0.1, so the per-address
    // login limit necessarily covers them all. What is asserted here is that the
    // limit is keyed on the address rather than on the submitted email: a
    // completely different account is throttled too.
    const otherAccount = await makeClient('other');
    check('the login limit is keyed per client, not per account',
      (await otherAccount.post('/auth/login', {
        email: `other-${RUN}@example.com`, password: THIRD_PASSWORD,
      })).status === 429);

  } finally {
    section('Cleaning up');
    try {
      const { rows: users } = await db.query('select id from users where email like $1', [`%${RUN}%`]);
      for (const user of users) {
        await db.query('delete from sessions where user_id = $1', [user.id]);
        await db.query('delete from password_reset_tokens where user_id = $1', [user.id]);
        await db.query('delete from users where id = $1', [user.id]);
      }
      console.log(`  removed ${users.length} test account(s)`);
    } catch (err) {
      console.log(`  cleanup warning: ${err.message}`);
    }
    server.child.kill('SIGKILL');
    email.server.close();
    await db.end();
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  if (failures.length) {
    console.log('\n  failures:');
    for (const line of failures) console.log(`    - ${line}`);
  }
  console.log(`${'-'.repeat(60)}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nSUITE ERROR:', error.stack ?? error.message);
  process.exit(1);
});