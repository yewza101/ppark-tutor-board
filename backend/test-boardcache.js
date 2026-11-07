// Self-check for the board cache. Run with: node backend/test-boardcache.js
// Covers the failure modes that used to corrupt or lose a board:
//   1. a DB error leaving a rejected promise cached, bricking that board for good
//   2. a clear-canvas landing mid-load and then being overwritten by stale DB data
//   3. teacher boards living only in memory, so uploaded worksheets vanished as
//      soon as the room emptied or the server restarted
// No framework on purpose: plain asserts, exits non-zero on failure.

const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_KEY = 'stub';

// Stub ./db/database before boardCache requires it.
let mode = 'ok';
let teacherTableExists = true;
const tables = { boards: new Map(), teacher_boards: new Map() };
const upserts = { boards: 0, teacher_boards: 0 };

const missingTableError = { code: '42P01', message: 'relation "teacher_boards" does not exist' };

const stub = {
  from(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      neq() { return api; },
      single: async () => {
        if (mode === 'throw') throw new Error('connection reset');
        if (mode === 'slow') {
          await new Promise(r => setTimeout(r, 30));
          return { data: { canvas_data: JSON.stringify([{ id: 'from-db' }]) }, error: null };
        }
        const key = filters[0]?.[1];
        return { data: tables[table].get(String(key)) ?? null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'teacher_boards' && !teacherTableExists) return { data: null, error: missingTableError };
        if (mode === 'throw') throw new Error('connection reset');
        if (mode === 'slow') {
          await new Promise(r => setTimeout(r, 30));
          return { data: { canvas_data: JSON.stringify([{ id: 'from-db' }]) }, error: null };
        }
        const key = filters[0]?.[1];
        return { data: tables[table].get(String(key)) ?? null, error: null };
      },
      upsert: async (row) => {
        if (table === 'teacher_boards' && !teacherTableExists) return { error: missingTableError };
        upserts[table]++;
        const key = String(row.board_id ?? row.user_id);
        tables[table].set(key, { canvas_data: row.canvas_data });
        return { error: null };
      }
    };
    return api;
  }
};

const dbPath = path.join(__dirname, 'db', 'database.js');
const m = new Module(dbPath, null);
m.filename = dbPath; m.loaded = true; m.exports = stub;
require.cache[dbPath] = m;

const cache = require('./boardCache');
const { boardStates, getBoardState, saveBoardState, flushSave } = cache;

const run = async () => {
  // --- 1. A DB error must not poison the cache entry forever. -----------------
  mode = 'throw';
  assert.deepStrictEqual(await getBoardState('101'), [], 'a failed load should yield an empty board, not throw');

  // The board must still be usable afterwards: before the fix the rejected promise
  // stayed in loadingPromises and every later call awaited it and threw.
  delete boardStates['101'];
  mode = 'ok';
  tables.boards.set('101', { canvas_data: JSON.stringify([{ id: 'a' }]) });
  assert.deepStrictEqual(await getBoardState('101'), [{ id: 'a' }], 'board must load normally after an earlier DB error');

  // --- 2. A clear landing mid-load must win over the in-flight DB read. -------
  delete boardStates['202'];
  mode = 'slow';
  const pending = getBoardState('202');
  boardStates['202'] = []; // a clear-canvas arriving while the read is in flight
  await pending;
  assert.deepStrictEqual(boardStates['202'], [], 'a clear during load must not be overwritten by stale DB data');

  // --- 3. Double-encoded canvas_data (a legacy row) still parses. -------------
  delete boardStates['303'];
  mode = 'ok';
  tables.boards.set('303', { canvas_data: JSON.stringify(JSON.stringify([{ id: 'legacy' }])) });
  assert.deepStrictEqual(await getBoardState('303'), [{ id: 'legacy' }], 'double-encoded canvas_data must be unwrapped');

  // --- 4. Teacher boards persist, and in their own table ----------------------
  // `boards.user_id` is an integer FK, so a text id like this cannot go there.
  const TB = 'teacher_board_MOOK';
  upserts.boards = 0; upserts.teacher_boards = 0;
  boardStates[TB] = [{ id: 'worksheet-page-1', isPage: true }];
  await flushSave(TB);
  assert.strictEqual(upserts.boards, 0, 'a teacher board must never be written to the boards table');
  assert.strictEqual(upserts.teacher_boards, 1, 'a teacher board must be written to teacher_boards');

  // The whole point: it survives the room emptying.
  delete boardStates[TB];
  assert.deepStrictEqual(
    await getBoardState(TB), [{ id: 'worksheet-page-1', isPage: true }],
    'a teacher board must come back after being evicted from memory'
  );

  // --- 5. Without the migration it degrades instead of erroring ---------------
  teacherTableExists = false;
  delete boardStates['teacher_board_OLD'];
  assert.deepStrictEqual(await getBoardState('teacher_board_OLD'), [], 'a missing table must read as empty, not throw');
  boardStates['teacher_board_OLD'] = [{ id: 'x' }];
  await flushSave('teacher_board_OLD'); // must not throw
  teacherTableExists = true;

  // --- 6. A debounced save coalesces, and flushSave writes exactly once. ------
  upserts.boards = 0;
  boardStates['404'] = [{ id: 'one' }];
  saveBoardState('404');
  saveBoardState('404');
  saveBoardState('404');
  await flushSave('404');
  assert.strictEqual(upserts.boards, 1, 'three rapid saves plus a flush should be one write');
  assert.deepStrictEqual(
    JSON.parse(tables.boards.get('404').canvas_data), [{ id: 'one' }],
    'the flushed row should hold the current board'
  );

  console.log('boardCache self-check: all 6 checks passed');
};

run().catch(err => {
  console.error('boardCache self-check FAILED:', err.message);
  process.exit(1);
});
