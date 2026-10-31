const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const multer = require('multer');
const jwt = require('jsonwebtoken');

dotenv.config();

const { authRouter, JWT_SECRET } = require('./routes/auth');
const adminRouter = require('./routes/admin');
const boardRouter = require('./routes/board');
const supabase = require('./db/database');
const { boardStates, getBoardState, saveBoardState, flushSave } = require('./boardCache');

const app = express();
const server = http.createServer(app);
const socketRooms = {}; // Track which board each socket is in
const boardConnectionCount = {}; // Track total sockets (for memory eviction)
const studentConnectionCount = {}; // Track only student sockets (for online status)
const socketRoles = {}; // Track role of each socket (admin/student)
const voiceRooms = {}; // Track active voice participants: { [boardId]: { [socketId]: { username, isMuted } } }

// Hard ceiling on elements kept per board. A runaway client (or a stuck pen) would
// otherwise grow boardStates without bound until the process is OOM-killed.
// ponytail: fixed cap with oldest-first eviction; swap for a byte budget if boards vary wildly in stroke size.
const MAX_ELEMENTS_PER_BOARD = 20000;

const NUMERIC_ID = /^\d+$/;
const isTeacherBoard = (id) => typeof id === 'string' && id.startsWith('teacher_board');

// Use a wide cors configuration since this is a local setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  },
  maxHttpBufferSize: 1e8, // 100 MB to prevent large boards from being dropped
  perMessageDeflate: {
    threshold: 1024 // Automatically compress WebSocket payloads > 1KB
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Every socket must present the same JWT the REST API uses. Without this the role in
// `join-board` was simply whatever the client claimed, so any visitor could emit
// teacher-only events such as teacher-clear-room and wipe a whole classroom.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

const isAdminSocket = (socket) => socket.user?.role === 'admin';

// Who is allowed into a room at all. Checked once, on join, because it can hit the DB.
const mayJoinBoard = async (socket, boardId) => {
  const id = String(boardId ?? '');
  if (!id || id === 'undefined') return false;
  if (id.startsWith('voice_group_')) return true;
  if (isTeacherBoard(id)) return id.length <= 128;

  if (!isAdminSocket(socket)) return id === String(socket.user.id);
  if (socket.user.isMasterAdmin) return true;
  if (!NUMERIC_ID.test(id)) return false;

  // Teachers switch between student boards constantly, so remember the answer for
  // this socket: it saves a round-trip per switch, and it means a transient DB
  // failure cannot lock a teacher out of a board they were already teaching on.
  socket.ownedBoards = socket.ownedBoards || new Map();
  if (socket.ownedBoards.has(id)) return socket.ownedBoards.get(id);

  // A regular teacher may only open boards of students they own.
  const { data: student, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', Number(id))
    .eq('role', 'student')
    .eq('teacher_id', socket.user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "no row matched", i.e. a real answer. Anything else is an
    // infrastructure problem: deny this attempt but do not cache the denial.
    console.error('Ownership check failed for board', id, error.message || error);
    return false;
  }

  const owned = Boolean(student);
  socket.ownedBoards.set(id, owned);
  return owned;
};

// Per-event check on the hot path: a socket may only write to the room it joined,
// which mayJoinBoard already authorised. No DB work, no trusting the payload.
const mayWriteBoard = (socket, boardId) => {
  const id = String(boardId ?? '');
  return Boolean(id) && socketRooms[socket.id] === id;
};

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/boards', boardRouter);

const verifyAdminRequest = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Only real student boards are "active"; voice rooms share the same room namespace
// and used to leak into this list.
app.get('/api/admin/active-boards', verifyAdminRequest, (req, res) => {
  res.json(Object.keys(studentConnectionCount).filter(id => NUMERIC_ID.test(id)));
});

// The bucket is public-read, so an unrestricted upload is a free hosting endpoint and
// an HTML/SVG upload would be a stored-XSS vector on the project's own origin.
const ALLOWED_UPLOAD_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB max per file
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_UPLOAD_TYPES[file.mimetype]) {
      return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
  }
});

const verifyAnyUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

app.post('/api/upload', verifyAnyUser, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message || 'Upload rejected' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Never derive the stored name from originalname: it can contain path separators.
    const ext = ALLOWED_UPLOAD_TYPES[req.file.mimetype];
    const filename = `${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;

    const { error } = await supabase.storage
      .from('board-assests')
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) return res.status(500).json({ message: error.message });

    const { data: publicUrlData } = supabase.storage.from('board-assests').getPublicUrl(filename);
    res.json({ url: publicUrlData.publicUrl });
  });
});

// Presentation is scoped per group: one teacher presenting must not force a PIP
// onto every student in every other classroom.
const presentingGroups = new Set();

const groupOfBoard = (boardId) =>
  isTeacherBoard(boardId) ? String(boardId).replace(/^teacher_board_?/, '') || 'General' : null;

// Socket.io for Real-time Drawing
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id, socket.user?.username);

  socket.on('join-board', async (data) => {
    const boardId = String((typeof data === 'object' && data !== null) ? data.boardId : data);
    if (!boardId || boardId === 'undefined') return;

    // Role comes from the verified token, never from the payload.
    const role = socket.user.role === 'admin' ? 'admin' : 'student';

    if (!(await mayJoinBoard(socket, boardId))) {
      console.warn(`Socket ${socket.id} denied join of board_${boardId}`);
      socket.emit('join-board-denied', { boardId });
      return;
    }

    const oldBoardId = socketRooms[socket.id];
    if (oldBoardId && oldBoardId !== boardId) {
      socket.leave(`board_${oldBoardId}`);
      socket.to(`board_${oldBoardId}`).emit('cursor-leave', socket.id);
      boardConnectionCount[oldBoardId] = Math.max(0, (boardConnectionCount[oldBoardId] || 1) - 1);
      // This decrement was missing, so a student who switched to the teacher board
      // stayed "online" on their own board forever in the dashboard.
      if (socketRoles[socket.id] === 'student') {
        studentConnectionCount[oldBoardId] = Math.max(0, (studentConnectionCount[oldBoardId] || 1) - 1);
        if (studentConnectionCount[oldBoardId] === 0) delete studentConnectionCount[oldBoardId];
      }
    } else if (oldBoardId === boardId) {
      return; // already in this room; a re-join would double-count
    }

    socket.join(`board_${boardId}`);
    socketRooms[socket.id] = boardId;
    socketRoles[socket.id] = role;

    boardConnectionCount[boardId] = (boardConnectionCount[boardId] || 0) + 1;

    if (role === 'student') {
      studentConnectionCount[boardId] = (studentConnectionCount[boardId] || 0) + 1;
    }

    // Tell the joiner whether their own classroom is currently being presented.
    const group = socket.user.group_name || 'General';
    if (role !== 'admin') {
      socket.emit('force-presentation', presentingGroups.has(group));
    }

    // join-board is async, so anything the client emits immediately after it would
    // race the room check. Ack instead, and let the client speak once it is in.
    socket.emit('board-joined', { boardId });

    console.log(`Socket ${socket.id} joined board_${boardId} as ${role} (Total: ${boardConnectionCount[boardId]})`);
  });

  // Cache logic moved to boardCache.js

  // Relay-only events: cheap guard, no DB work.
  const relay = (event) => socket.on(event, (data) => {
    if (!data || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit(event, data);
  });
  relay('draw-progress');
  relay('viewport-update');
  relay('laser-fade');

  socket.on('draw-stroke', async (data) => {
    // data = { boardId, stroke, socketId }
    if (!data || !data.stroke || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit('draw-stroke', data);
    try {
      const elements = await getBoardState(data.boardId);
      if (elements.length >= MAX_ELEMENTS_PER_BOARD) {
        elements.splice(0, elements.length - MAX_ELEMENTS_PER_BOARD + 1);
      }
      elements.push(data.stroke);
      saveBoardState(data.boardId);
    } catch (err) {
      console.error('Error in draw-stroke cache:', err);
    }
  });

  socket.on('undo', async (boardId) => {
    // Deprecated global undo: no-op to prevent wiping other users' work.
    // Client boards now use targeted 'delete-element' for per-user undo.
  });

  socket.on('clear-canvas', async (boardId) => {
    if (!mayWriteBoard(socket, boardId)) return;
    socket.to(`board_${boardId}`).emit('clear-canvas');
    boardStates[boardId] = [];
    saveBoardState(boardId);
  });
  // Students of a group, from the real table. This used to query a non-existent
  // `students` table, which is why teacher-clear-room appeared to do nothing at all.
  const studentsInGroup = async (groupName) => {
    const targetGroup = groupName || 'General';
    let query = supabase
      .from('users')
      .select('id, group_name')
      .eq('role', 'student');
    // A regular teacher must not be able to clear or overwrite another teacher's class.
    if (!socket.user.isMasterAdmin) {
      query = query.eq('teacher_id', socket.user.id);
    }
    const { data, error } = await query;
    if (error) {
      console.error('Error loading students for group:', targetGroup, error);
      return [];
    }
    return (data || []).filter(st => (st.group_name || 'General') === targetGroup);
  };

  socket.on('teacher-clear-room', async (groupName) => {
    if (!isAdminSocket(socket)) return; // teacher-only: this wipes every board in the group
    try {
      const targets = await studentsInGroup(groupName);
      for (const student of targets) {
        const sid = String(student.id);
        boardStates[sid] = [];
        io.to(`board_${sid}`).emit('clear-canvas');
        saveBoardState(sid);
      }

      const tbid = `teacher_board_${groupName || 'General'}`;
      boardStates[tbid] = [];
      io.to(`board_${tbid}`).emit('clear-canvas');
      saveBoardState(tbid);
    } catch (err) {
      console.error('Error clearing room boards:', err);
    }
  });

  socket.on('teacher-upload-sheet', async ({ groupName, strokes } = {}) => {
    if (!isAdminSocket(socket)) return; // teacher-only: this replaces every board in the group
    if (!Array.isArray(strokes)) return;
    try {
      const targets = await studentsInGroup(groupName);
      for (const student of targets) {
        const sid = String(student.id);
        boardStates[sid] = [...strokes];
        io.to(`board_${sid}`).emit('clear-canvas');
        for (const stroke of strokes) {
          io.to(`board_${sid}`).emit('draw-stroke', { boardId: sid, stroke });
        }
        saveBoardState(sid);
      }
    } catch (err) {
      console.error('Error syncing sheet to students:', err);
    }
  });

  socket.on('delete-element', async (data) => {
    // data = { boardId, elementId }
    if (!data || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit('delete-element', data);
    // Mutate the cached array in place: reassigning boardStates[id] here raced with a
    // concurrent getBoardState and silently dropped whichever operation finished first.
    const elements = await getBoardState(data.boardId);
    for (let i = elements.length - 1; i >= 0; i--) {
      if (elements[i] && elements[i].id === data.elementId) elements.splice(i, 1);
    }
    saveBoardState(data.boardId);
  });

  socket.on('update-element', async (data) => {
    // data = { boardId, element }
    if (!data || !data.element || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit('update-element', data);
    const elements = await getBoardState(data.boardId);
    const index = elements.findIndex(el => el && el.id === data.element.id);
    if (index !== -1) {
      elements[index] = data.element;
      saveBoardState(data.boardId);
    }
  });

  // Batched variant: dragging a 50-element selection used to emit 50 separate
  // update-element messages on every throttle tick.
  socket.on('update-elements', async (data) => {
    if (!data || !Array.isArray(data.elements) || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit('update-elements', data);
    const elements = await getBoardState(data.boardId);
    const byId = new Map(data.elements.filter(Boolean).map(el => [el.id, el]));
    for (let i = 0; i < elements.length; i++) {
      const next = elements[i] && byId.get(elements[i].id);
      if (next) elements[i] = next;
    }
    saveBoardState(data.boardId);
  });

  socket.on('canvas-update', async (data) => {
    // Fallback for full sync if needed
    if (!data || !Array.isArray(data.canvasState) || !mayWriteBoard(socket, data.boardId)) return;
    socket.to(`board_${data.boardId}`).emit('canvas-update', data.canvasState);
    boardStates[data.boardId] = data.canvasState.slice(0, MAX_ELEMENTS_PER_BOARD);
    saveBoardState(data.boardId);
  });

  socket.on('broadcast-elements', async (data) => {
    if (!isAdminSocket(socket)) return; // teacher-only: writes onto every student board
    if (!data || !Array.isArray(data.elements)) return;

    let activeBoards = Object.keys(studentConnectionCount).filter(id => NUMERIC_ID.test(id));

    let query = supabase.from('users').select('id').eq('role', 'student');
    if (data.group) query = query.eq('group_name', data.group);
    if (!socket.user.isMasterAdmin) query = query.eq('teacher_id', socket.user.id);
    const { data: students } = await query;
    const studentIds = new Set((students || []).map(st => String(st.id)));
    activeBoards = activeBoards.filter(b => studentIds.has(b));

    for (const boardId of activeBoards) {
      const elements = await getBoardState(boardId);
      elements.push(...data.elements);
      saveBoardState(boardId);
      io.to(`board_${boardId}`).emit('add-elements', { elements: data.elements });
    }
  });

  socket.on('cursor-move', (data) => {
    // data = { boardId, x, y, color }
    if (!data || !mayWriteBoard(socket, data.boardId)) return;
    // Identity comes from the token, so a cursor cannot impersonate the teacher.
    socket.to(`board_${data.boardId}`).emit('cursor-move', {
      ...data,
      username: socket.user.username,
      role: socket.user.role,
      isTeacher: socket.user.role === 'admin',
      socketId: socket.id
    });
  });

  socket.on('force-presentation', (isActive) => {
    if (!isAdminSocket(socket)) return; // teacher-only
    const group = groupOfBoard(socketRooms[socket.id]) || socket.user.group_name || 'General';
    if (isActive) presentingGroups.add(group);
    else presentingGroups.delete(group);

    // Only students whose own group is being presented should get the PIP.
    for (const [sid, other] of io.sockets.sockets) {
      if (sid === socket.id || other.user?.role === 'admin') continue;
      if ((other.user?.group_name || 'General') === group) {
        other.emit('force-presentation', isActive);
      }
    }
  });

  // --- WebRTC Voice Chat Signaling ---
  socket.on('join-voice', (data) => {
    const boardId = String(data?.boardId ?? '');
    if (!boardId) return;
    if (!voiceRooms[boardId]) {
      voiceRooms[boardId] = {};
    }

    // A duplicate join from the same socket used to resend existing-voice-users,
    // making the client tear down and rebuild every peer connection mid-call.
    if (voiceRooms[boardId][socket.id]) return;

    // Send existing participants in this room to the newly joined user
    const existingUsers = Object.entries(voiceRooms[boardId])
      .filter(([sid]) => sid !== socket.id)
      .map(([socketId, u]) => ({ socketId, username: u.username, isMuted: u.isMuted || false }));

    socket.emit('existing-voice-users', existingUsers);

    // Save this user to room
    voiceRooms[boardId][socket.id] = { username: socket.user.username, isMuted: false };

    // Broadcast to others in this room
    socket.to(`board_${boardId}`).emit('user-joined-voice', { socketId: socket.id, username: socket.user.username });
  });

  socket.on('leave-voice', (data) => {
    const boardId = String(data?.boardId ?? '');
    if (!boardId) return;
    if (voiceRooms[boardId] && voiceRooms[boardId][socket.id]) {
      delete voiceRooms[boardId][socket.id];
      if (Object.keys(voiceRooms[boardId]).length === 0) {
        delete voiceRooms[boardId];
      }
    }
    socket.to(`board_${boardId}`).emit('user-left-voice', { socketId: socket.id });
  });

  socket.on('mic-status-changed', (data) => {
    const boardId = String(data?.boardId ?? '');
    if (!boardId) return;
    if (voiceRooms[boardId] && voiceRooms[boardId][socket.id]) {
      voiceRooms[boardId][socket.id].isMuted = data.isMuted;
    }
    socket.to(`board_${boardId}`).emit('mic-status-changed', { socketId: socket.id, isMuted: data.isMuted });
  });

  // Peer-to-peer signalling relays. Each needs an explicit target, and the caller
  // identity is taken from the socket rather than the payload.
  const signal = (event, fields) => socket.on(event, (data) => {
    if (!data?.targetSocketId) return;
    const payload = { callerSocketId: socket.id };
    for (const f of fields) payload[f] = data[f];
    socket.to(data.targetSocketId).emit(event, payload);
  });
  signal('webrtc-answer', ['answer']);
  signal('webrtc-ice-candidate', ['candidate']);

  socket.on('webrtc-offer', (data) => {
    if (!data?.targetSocketId) return;
    socket.to(data.targetSocketId).emit('webrtc-offer', {
      offer: data.offer,
      callerSocketId: socket.id,
      callerUsername: socket.user.username
    });
  });

  socket.on('admin-mute-user', (data) => {
    if (!isAdminSocket(socket) || !data?.targetSocketId) return; // teacher-only
    socket.to(data.targetSocketId).emit('admin-mute-user', { callerSocketId: socket.id });
  });

  socket.on('disconnect', async () => {
    const boardId = socketRooms[socket.id];
    const role = socketRoles[socket.id];

    // Clean up from voiceRooms if present
    for (const [vid, room] of Object.entries(voiceRooms)) {
      if (room[socket.id]) {
        delete room[socket.id];
        socket.to(`board_${vid}`).emit('user-left-voice', { socketId: socket.id });
        if (Object.keys(room).length === 0) {
          delete voiceRooms[vid];
        }
      }
    }

    // A teacher dropping out must not leave their class stuck in presentation mode.
    if (isAdminSocket(socket)) {
      const group = groupOfBoard(boardId) || socket.user.group_name || 'General';
      if (presentingGroups.delete(group)) {
        for (const [sid, other] of io.sockets.sockets) {
          if (sid === socket.id || other.user?.role === 'admin') continue;
          if ((other.user?.group_name || 'General') === group) {
            other.emit('force-presentation', false);
          }
        }
      }
    }

    delete socketRooms[socket.id];
    delete socketRoles[socket.id];

    if (boardId) {
      socket.to(`board_${boardId}`).emit('cursor-leave', socket.id);

      if (role === 'student') {
        studentConnectionCount[boardId] = Math.max(0, (studentConnectionCount[boardId] || 1) - 1);
        if (studentConnectionCount[boardId] === 0) {
          delete studentConnectionCount[boardId];
        }
      }

      // Decrement connection count and evict cache if no one is left
      boardConnectionCount[boardId] = (boardConnectionCount[boardId] || 1) - 1;
      if (boardConnectionCount[boardId] <= 0) {
        delete boardConnectionCount[boardId];
        // Flush pending save to DB first, then free RAM
        await flushSave(boardId);
        // Someone may have re-joined while that write was in flight; only free RAM
        // if the board is still empty, otherwise we would drop a live board's state.
        if (!boardConnectionCount[boardId]) {
          delete boardStates[boardId];
          console.log(`Board ${boardId} evicted from memory (no users remaining)`);
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const gracefulShutdown = async () => {
  console.log('Received shutdown signal. Flushing pending saves...');
  const { flushAllSaves } = require('./boardCache');
  await flushAllSaves();
  console.log('Shutdown complete.');
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
