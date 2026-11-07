// Self-check for the teacher-board write lock.
// Run with: node backend/test-teacher-board-lock.js
//
// Students can open the teacher board to watch the lesson, but may only draw on it
// while the teacher has pressed "อนุญาตให้นักเรียนเขียน". This drives the real server
// over real sockets, because the gate has to hold on the wire: both the relay to the
// other clients and the write into the board cache.
//
// Borrows the socket.io-client already installed for the frontend: no new dependency.

const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_KEY = 'stub';
process.env.PORT = '4098';

let ioClient;
try {
  ({ io: ioClient } = require('../frontend/node_modules/socket.io-client'));
} catch {
  console.error('This check borrows socket.io-client from the frontend: run npm install in frontend/ first.');
  process.exit(1);
}

// Stub ./db/database before server.js requires it: nothing here needs a real DB.
const stub = {
  from() {
    const api = {
      select: () => api, eq: () => api, neq: () => api, limit: () => api,
      single: async () => ({ data: null, error: { code: 'PGRST116' } }),
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ error: null }),
      then: (res) => Promise.resolve({ data: [], error: null }).then(res)
    };
    return api;
  }
};
const dbPath = path.join(__dirname, 'db', 'database.js');
const m = new Module(dbPath, null);
m.filename = dbPath; m.loaded = true; m.exports = stub;
require.cache[dbPath] = m;

require('./server');
// The very module instance the server writes strokes into.
const { boardStates } = require('./boardCache');

const TB = 'teacher_board_MOOK';
const URL = 'http://localhost:4098';
const sign = (user) => jwt.sign(user, process.env.JWT_SECRET);

const teacherToken = sign({ id: 1, username: 'kru', role: 'admin', isMasterAdmin: true, group_name: 'MOOK' });
const studentToken = sign({ id: 42, username: 'nong', role: 'student', group_name: 'MOOK' });

const once = (sock, event, ms = 2000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { sock.off(event, handler); reject(new Error('timed out waiting for ' + event)); }, ms);
  const handler = (data) => { clearTimeout(timer); sock.off(event, handler); resolve(data); };
  sock.on(event, handler);
});

// Negative assertions need a quiet window, not an event.
const silentFor = (sock, event, ms = 350) => new Promise((resolve) => {
  let seen = false;
  const handler = () => { seen = true; };
  sock.on(event, handler);
  setTimeout(() => { sock.off(event, handler); resolve(!seen); }, ms);
});

const stroke = (id) => ({ id, tool: 'pencil', author: 'nong', points: [{ x: 1, y: 1 }] });
const onBoard = (id) => (boardStates[TB] || []).some(el => el && el.id === id);

const run = async () => {
  const teacher = ioClient(URL, { auth: { token: teacherToken }, transports: ['websocket'] });
  const student = ioClient(URL, { auth: { token: studentToken }, transports: ['websocket'] });

  const studentLock = once(student, 'student-write-allowed');
  teacher.emit('join-board', { boardId: TB });
  student.emit('join-board', { boardId: TB });
  await Promise.all([once(teacher, 'board-joined'), once(student, 'board-joined')]);

  // --- 1. A student joining is told the board is locked ---------------------------
  assert.strictEqual(await studentLock, false, 'a joining student must be told the board starts locked');

  // --- 2. Locked: the stroke is neither relayed nor stored -------------------------
  let quiet = silentFor(teacher, 'draw-stroke');
  student.emit('draw-stroke', { boardId: TB, stroke: stroke('locked-1'), socketId: student.id });
  assert.ok(await quiet, 'a locked board must not relay a student stroke to the teacher');
  assert.ok(!onBoard('locked-1'), 'a locked board must not store a student stroke either');

  // --- 3. The teacher is never locked out of their own board -----------------------
  let relayed = once(student, 'draw-stroke');
  teacher.emit('draw-stroke', { boardId: TB, stroke: { id: 'kru-1', tool: 'pencil' }, socketId: teacher.id });
  assert.strictEqual((await relayed).stroke.id, 'kru-1', 'the teacher must always be able to draw');

  // --- 4. Unlocking reaches the student and lets the stroke through ----------------
  const unlocked = once(student, 'student-write-allowed');
  teacher.emit('allow-student-write', true);
  assert.strictEqual(await unlocked, true, 'the unlock must be pushed to the student');

  relayed = once(teacher, 'draw-stroke');
  student.emit('draw-stroke', { boardId: TB, stroke: stroke('open-1'), socketId: student.id });
  assert.strictEqual((await relayed).stroke.id, 'open-1', 'an unlocked board must relay the student stroke');
  assert.ok(onBoard('open-1'), 'an unlocked board must store the student stroke');

  // --- 5. Locking again stops them mid-lesson -------------------------------------
  const relocked = once(student, 'student-write-allowed');
  teacher.emit('allow-student-write', false);
  assert.strictEqual(await relocked, false, 'the re-lock must be pushed to the student');

  quiet = silentFor(teacher, 'draw-stroke');
  student.emit('draw-stroke', { boardId: TB, stroke: stroke('locked-2'), socketId: student.id });
  assert.ok(await quiet, 'locking again must stop the student');
  assert.ok(!onBoard('locked-2'), 'locking again must stop the student writing to the cache');

  // --- 6. A student cannot unlock it for themselves --------------------------------
  const ignored = silentFor(student, 'student-write-allowed');
  student.emit('allow-student-write', true);
  assert.ok(await ignored, 'a student emitting allow-student-write must be ignored outright');
  quiet = silentFor(teacher, 'draw-stroke');
  student.emit('draw-stroke', { boardId: TB, stroke: stroke('self-unlock'), socketId: student.id });
  assert.ok(await quiet, 'a student must not be able to unlock their own writing');
  assert.ok(!onBoard('self-unlock'), 'a self-unlock must not write to the cache');

  // --- 7. Clearing the shared board is gated by the same lock ----------------------
  boardStates[TB] = [{ id: 'kru-lesson' }];
  const notCleared = silentFor(teacher, 'clear-canvas');
  student.emit('clear-canvas', TB);
  assert.ok(await notCleared, 'a locked board must not let a student clear it');
  assert.ok(onBoard('kru-lesson'), 'a student must not wipe away the lesson');

  console.log('teacher-board-lock self-check: all 7 groups passed');
  process.exit(0);
};

run().catch(err => {
  console.error('teacher-board-lock self-check FAILED:', err.message);
  process.exit(1);
});
