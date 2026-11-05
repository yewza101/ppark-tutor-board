// Self-check for the master admin account. Run with: node backend/test-master-auth.js
//
// The master account moved out of env vars and into the users table so its password
// can be rotated from inside the app. That touches the most security-sensitive code
// in the project, so this exercises the whole flow against a stubbed database:
// bootstrap, rotation, old password death, and the privilege boundary.

const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_KEY = 'stub';
process.env.MASTER_ADMIN_USERNAME = 'adminpark';
process.env.MASTER_ADMIN_PASSWORD = 'bootstrap-password-123';
process.env.PORT = '4099';

// ---- in-memory stand-in for the users table -----------------------------------
const rows = [];
let nextId = 1;

const matches = (row, filters) => filters.every(([col, val]) => String(row[col]) === String(val));

const builder = (table) => {
  const state = { filters: [], action: null, payload: null };
  const api = {
    select() { if (!state.action) state.action = 'select'; return api; },
    insert(items) { state.action = 'insert'; state.payload = items; return api; },
    update(patch) { state.action = 'update'; state.payload = patch; return api; },
    delete() { state.action = 'delete'; return api; },
    eq(col, val) { state.filters.push([col, val]); return api; },
    neq() { return api; },
    order() { return api; },
    run() {
      if (table !== 'users') return { data: [], error: null };
      if (state.action === 'insert') {
        const item = state.payload[0];
        if (rows.some(r => r.username === item.username)) {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        const row = { id: nextId++, created_at: new Date().toISOString(), ...item };
        rows.push(row);
        return { data: row, error: null };
      }
      const hit = rows.filter(r => matches(r, state.filters));
      if (state.action === 'update') {
        hit.forEach(r => Object.assign(r, state.payload));
        return { data: hit, error: null };
      }
      if (state.action === 'delete') {
        hit.forEach(r => rows.splice(rows.indexOf(r), 1));
        return { data: hit, error: null };
      }
      return { data: hit, error: null };
    },
    maybeSingle() { const r = api.run(); const d = Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null); return Promise.resolve({ data: d, error: null }); },
    single() { const r = api.run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve({ data: d ?? null, error: r.error || (d ? null : { code: 'PGRST116' }) }); },
    then(res) { const r = api.run(); return Promise.resolve(r).then(res); }
  };
  return api;
};

const stub = {
  from: (table) => builder(table),
  storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({ error: null }), upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) }
};

const dbPath = path.join(__dirname, 'db', 'database.js');
const m = new Module(dbPath, null);
m.filename = dbPath; m.loaded = true; m.exports = stub;
require.cache[dbPath] = m;

// ---- tiny HTTP helper ---------------------------------------------------------
const call = (method, p, body, token) => new Promise((resolve) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({
    host: '127.0.0.1', port: 4099, path: p, method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    }
  }, (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
      resolve({ status: res.statusCode, body: json });
    });
  });
  req.on('error', () => resolve({ status: 0, body: null }));
  if (data) req.write(data);
  req.end();
});

require('./server');

const run = async () => {
  await new Promise(r => setTimeout(r, 400));

  // --- 1. First sign-in bootstraps the row from env ----------------------------
  let r = await call('POST', '/api/auth/login', { username: 'adminpark', password: 'bootstrap-password-123' });
  assert.strictEqual(r.status, 200, 'env password should work on first sign-in');
  assert.strictEqual(r.body.user.isMasterAdmin, true, 'the bootstrap login must be master');
  assert.strictEqual(rows.length, 1, 'the master row should have been created');
  assert.ok(rows[0].password_hash.startsWith('$2'), 'the password must be stored hashed, not in plain text');
  assert.notStrictEqual(rows[0].id, 999999, 'the master must have a real row id, not the old fake one');
  const token = r.body.token;

  // --- 2. The same secret works in the Teacher Code field ----------------------
  r = await call('POST', '/api/auth/login-teacher', { teacher_code: 'bootstrap-password-123' });
  assert.strictEqual(r.status, 200, 'one account, one secret: the code route must accept it too');
  assert.strictEqual(r.body.user.isMasterAdmin, true);

  // --- 3. The old hardcoded backdoor stays dead --------------------------------
  for (const code of ['adminpark', 'admin123']) {
    r = await call('POST', '/api/auth/login-teacher', { teacher_code: code });
    assert.strictEqual(r.status, 401, `"${code}" must not be accepted`);
  }

  // --- 4. Rotating the password needs the current one --------------------------
  r = await call('PUT', '/api/admin/master-password',
    { currentPassword: 'wrong-one', newPassword: 'brand-new-password-456' }, token);
  assert.strictEqual(r.status, 401, 'a wrong current password must be refused');

  r = await call('PUT', '/api/admin/master-password',
    { currentPassword: 'bootstrap-password-123', newPassword: 'short' }, token);
  assert.strictEqual(r.status, 400, 'a too-short new password must be refused');

  r = await call('PUT', '/api/admin/master-password',
    { currentPassword: 'bootstrap-password-123', newPassword: 'brand-new-password-456' }, token);
  assert.strictEqual(r.status, 200, 'the rotation should succeed');

  // The secret must never be stored anywhere readable.
  const masterRow = rows.find(r => r.username === 'adminpark');
  assert.ok(!Object.values(masterRow).includes('brand-new-password-456'),
    'the password must not be stored in plain text in any column');
  assert.strictEqual(masterRow.teacher_code, null,
    'teacher_code is matched in plain text, so the master must not keep its secret there');

  // --- 5. The new password works on both routes, the old one on neither --------
  r = await call('POST', '/api/auth/login', { username: 'adminpark', password: 'brand-new-password-456' });
  assert.strictEqual(r.status, 200, 'the new password must work');
  r = await call('POST', '/api/auth/login-teacher', { teacher_code: 'brand-new-password-456' });
  assert.strictEqual(r.status, 200, 'the new password must work as the teacher code too');

  r = await call('POST', '/api/auth/login', { username: 'adminpark', password: 'bootstrap-password-123' });
  assert.strictEqual(r.status, 401, 'the old password must stop working');
  // The env var still holds the bootstrap value; it must not act as a standing backdoor.
  r = await call('POST', '/api/auth/login-teacher', { teacher_code: 'bootstrap-password-123' });
  assert.strictEqual(r.status, 401, 'env must not override the stored password once the row exists');

  // --- 6. A normal teacher cannot touch the master account ---------------------
  const bcrypt = require('bcrypt');
  rows.push({
    id: nextId++, username: 'kru_som', role: 'admin', teacher_code: 'som-secret-code',
    password_hash: await bcrypt.hash('x'.repeat(12), 10), group_name: 'Room A'
  });
  r = await call('POST', '/api/auth/login-teacher', { teacher_code: 'som-secret-code' });
  assert.strictEqual(r.status, 200, 'a normal teacher should still sign in');
  assert.ok(!r.body.user.isMasterAdmin, 'a normal teacher must not be flagged master');
  const teacherToken = r.body.token;

  for (const [method, p] of [['PUT', '/api/admin/master-password'], ['POST', '/api/admin/clear-all-documents'], ['GET', '/api/admin/teachers']]) {
    r = await call(method, p, method === 'PUT'
      ? { currentPassword: 'brand-new-password-456', newPassword: 'hijacked-password-1' } : null, teacherToken);
    assert.strictEqual(r.status, 403, `a teacher must be refused ${method} ${p}`);
  }
  r = await call('POST', '/api/auth/login', { username: 'adminpark', password: 'brand-new-password-456' });
  assert.strictEqual(r.status, 200, 'the master password must be unchanged after that attempt');

  // --- 7. The master row cannot be deleted through the teacher management UI ---
  // It is a real row now, so it sits in the same table as the teachers it manages.
  r = await call('POST', '/api/auth/login', { username: 'adminpark', password: 'brand-new-password-456' });
  const masterToken = r.body.token;
  const masterId = rows.find(x => x.username === 'adminpark').id;
  r = await call('DELETE', '/api/admin/teachers/' + masterId, null, masterToken);
  assert.strictEqual(r.status, 400, 'deleting the master account must be refused');
  assert.ok(rows.some(x => x.username === 'adminpark'), 'the master row must survive');

  console.log('master-auth self-check: all 7 groups passed');
  process.exit(0);
};

run().catch(err => {
  console.error('master-auth self-check FAILED:', err.message);
  process.exit(1);
});
