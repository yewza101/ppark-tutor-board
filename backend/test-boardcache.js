// Self-check for the board cache. Run with: node backend/test-boardcache.js
// Covers the two failure modes that used to corrupt or lose a student's work:
//   1. a DB error leaving a rejected promise cached, bricking that board for good
//   2. a clear-canvas landing mid-load and then being overwritten by stale DB data
// No framework on purpose: plain asserts, exits non-zero on failure.

const assert = require('assert');
const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_KEY = 'stub';

// Stub ./db/database before boardCache requires it.
let mode = 'ok';
let stored = null;
let upserts = 0;

const stub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              single: async () => {
                if (mode === 'throw') throw new Error('connection reset');
                if (mode === 'slow') {
                  await new Promise(r => setTimeout(r, 30));
                  return { data: { canvas_data: JSON.stringify([{ id: 'from-db' }]) } };
                }
                return { data: stored };
              }
            };
          }
        };
      },
      upsert: async (row) => {
        upserts++;
        stored = { canvas_data: row.canvas_data };
        return { error: null };
      }
    };
  }
};

const dbPath = path.join(__dirname, 'db', 'database.js');
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = stub;

const cache = require('./boardCache');
const { boardStates, getBoardState, saveBoardState, flushSave } = cache;

const run = async () => {
  // --- 1. A DB error must not poison the cache entry forever. -----------------
  mode = 'throw';
  const first = await getBoardState('101');
  assert.deepStrictEqual(first, [], 'a failed load should yield an empty board, not throw');

  // The board must still be usable afterwards: before the fix the rejected promise
  // stayed in loadingPromises and every later call awaited it and threw.
  delete boardStates['101'];
  mode = 'ok';
  stored = { canvas_data: JSON.stringify([{ id: 'a' }]) };
  const second = await getBoardState('101');
  assert.deepStrictEqual(second, [{ id: 'a' }], 'board must load normally after an earlier DB error');

  // --- 2. A clear landing mid-load must win over the in-flight DB read. -------
  delete boardStates['202'];
  mode = 'slow';
  const pending = getBoardState('202');
  boardStates['202'] = []; // a clear-canvas arriving while the read is in flight
  await pending;
  assert.deepStrictEqual(
    boardStates['202'], [],
    'a clear during load must not be overwritten by stale DB data'
  );

  // --- 3. Double-encoded canvas_data (a legacy row) still parses. -------------
  delete boardStates['303'];
  mode = 'ok';
  stored = { canvas_data: JSON.stringify(JSON.stringify([{ id: 'legacy' }])) };
  assert.deepStrictEqual(
    await getBoardState('303'), [{ id: 'legacy' }],
    'double-encoded canvas_data must be unwrapped'
  );

  // --- 4. Teacher boards are memory-only and must never hit the DB. -----------
  upserts = 0;
  boardStates['teacher_board_Room A'] = [{ id: 'x' }];
  saveBoardState('teacher_board_Room A');
  await flushSave('teacher_board_Room A');
  assert.strictEqual(upserts, 0, 'teacher boards must not be written to the boards table');

  // --- 5. A debounced save coalesces, and flushSave writes exactly once. ------
  upserts = 0;
  boardStates['404'] = [{ id: 'one' }];
  saveBoardState('404');
  saveBoardState('404');
  saveBoardState('404');
  await flushSave('404');
  assert.strictEqual(upserts, 1, 'three rapid saves plus a flush should be one write');
  assert.deepStrictEqual(
    JSON.parse(stored.canvas_data), [{ id: 'one' }],
    'the flushed row should hold the current board'
  );

  console.log('boardCache self-check: all 5 checks passed');
};

run().catch(err => {
  console.error('boardCache self-check FAILED:', err.message);
  process.exit(1);
});
