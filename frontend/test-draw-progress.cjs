// Self-check for the draw-progress delta protocol.
// Run with: node frontend/test-draw-progress.cjs
//
// draw-progress used to resend the whole accumulated point array every 75ms, so a
// 600-point stroke went out as ~20,000 points. It now sends only the points added
// since the last emit and the receiver appends them. If that append is wrong, live
// strokes silently lose points, so this reproduces sender and receiver and checks
// the reconstruction is byte-for-byte identical to the original.

const assert = require('node:assert');

// ---- sender: mirrors the emit logic in Board.jsx -------------------------------
const makeSender = () => {
  let sentStrokeId = null;
  let sentCount = 0;
  return {
    emit(live) {
      const all = Array.isArray(live.points) ? live.points : null;
      const first = live.id !== sentStrokeId;
      const chunk = all ? all.slice(first ? 0 : sentCount) : null;
      const payload = chunk ? { ...live, points: chunk } : live;
      if (chunk && !first && chunk.length === 0) return null; // nothing new
      const msg = { path: payload, socketId: 'peer1', append: Boolean(chunk) && !first };
      if (chunk) { sentStrokeId = live.id; sentCount = first ? chunk.length : sentCount + chunk.length; }
      return msg;
    },
    end() { sentStrokeId = null; sentCount = 0; }
  };
};

// ---- receiver: mirrors the handler in Board.jsx / MiniBoard.jsx ----------------
const makeReceiver = () => {
  const remote = {};
  return {
    remote,
    recv(data) {
      if (!data) return;
      if (data.path === null) { delete remote[data.socketId]; return; }
      if (data.append && remote[data.socketId]?.id === data.path.id) {
        const ex = remote[data.socketId];
        remote[data.socketId] = {
          ...ex,
          points: [...(ex.points || []), ...(data.path.points || [])],
          path2d: null
        };
      } else {
        remote[data.socketId] = data.path;
      }
    }
  };
};

const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

const run = () => {
  // --- 1. A normal stroke reconstructs exactly, and costs far less ---------------
  const sender = makeSender();
  const rx = makeReceiver();
  const live = { id: 's1', type: 'path', tool: 'pencil', color: '#000', size: 5, points: [] };

  let sent = 0;
  let wholePathCost = 0;
  for (let tick = 0; tick < 60; tick++) {
    for (let i = 0; i < 9; i++) live.points.push({ x: tick * 9 + i, y: tick, pressure: 0.5 });
    wholePathCost += bytes({ path: live, socketId: 'peer1' }); // the old behaviour
    const msg = sender.emit(live);
    if (msg) { sent += bytes(msg); rx.recv(msg); }
  }

  assert.deepStrictEqual(
    rx.remote.peer1.points, live.points,
    'the receiver must reconstruct the stroke exactly'
  );
  assert.strictEqual(rx.remote.peer1.points.length, 540, 'no points may be lost');
  assert.ok(sent * 8 < wholePathCost, 'delta should cost well under an eighth of resending');
  console.log('  reconstruction exact; egress ' +
    (wholePathCost / sent).toFixed(1) + 'x smaller (' +
    Math.round(wholePathCost / 1024) + ' KB -> ' + Math.round(sent / 1024) + ' KB)');

  // --- 2. Metadata still rides along (colour change mid-stroke, snapping) --------
  assert.strictEqual(rx.remote.peer1.color, '#000');
  assert.strictEqual(rx.remote.peer1.tool, 'pencil');

  // --- 3. A second stroke must not append onto the first ------------------------
  sender.end();
  const live2 = { id: 's2', type: 'path', tool: 'pencil', color: '#f00', size: 2, points: [] };
  live2.points.push({ x: 1, y: 1, pressure: 1 });
  rx.recv(sender.emit(live2));
  assert.strictEqual(rx.remote.peer1.id, 's2', 'a new stroke must replace, not extend');
  assert.strictEqual(rx.remote.peer1.points.length, 1, 'the new stroke must start clean');

  // --- 4. Joining mid-stroke: the first chunk a late viewer sees is an append it
  //        cannot apply, so it must replace rather than throw or drop the stroke --
  const late = makeReceiver();
  const mid = { path: { id: 's3', type: 'path', points: [{ x: 9, y: 9 }] }, socketId: 'peer1', append: true };
  late.recv(mid);
  assert.strictEqual(late.remote.peer1.points.length, 1, 'a late viewer still renders what it got');

  // --- 5. Pen lift clears the preview -------------------------------------------
  rx.recv({ path: null, socketId: 'peer1' });
  assert.strictEqual(rx.remote.peer1, undefined, 'lifting the pen clears the live preview');

  // --- 6. Shapes have no point array and must pass through untouched ------------
  sender.end();
  const rect = { id: 'r1', type: 'rectangle', x: 0, y: 0, w: 10, h: 10, color: '#00f' };
  const rectMsg = sender.emit(rect);
  assert.strictEqual(rectMsg.append, false, 'a shape is never an append');
  rx.recv(rectMsg);
  assert.deepStrictEqual(rx.remote.peer1, rect, 'shapes pass through unchanged');

  // --- 7. An emit with no new points is skipped entirely ------------------------
  sender.end();
  const still = { id: 's4', type: 'path', points: [{ x: 0, y: 0 }] };
  assert.ok(sender.emit(still), 'first chunk is always sent');
  assert.strictEqual(sender.emit(still), null, 'an unchanged stroke sends nothing');

  console.log('draw-progress self-check: all 7 checks passed');
};

try {
  run();
} catch (err) {
  console.error('draw-progress self-check FAILED:', err.message);
  process.exit(1);
}
