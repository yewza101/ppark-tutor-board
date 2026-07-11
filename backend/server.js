const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

const { authRouter } = require('./routes/auth');
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

// Use a wide cors configuration since this is a local setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/boards', boardRouter);

app.get('/api/admin/active-boards', (req, res) => {
  res.json(Object.keys(studentConnectionCount));
});

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max per file
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const ext = req.file.originalname.split('.').pop();
  const filename = `${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
  
  const { data, error } = await supabase.storage
    .from('board-assests')
    .upload(filename, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    
  if (error) return res.status(500).json({ message: error.message });
  
  const { data: publicUrlData } = supabase.storage.from('board-assests').getPublicUrl(filename);
  res.json({ url: publicUrlData.publicUrl });
});

// Socket.io for Real-time Drawing
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-board', (boardId) => {
    socket.join(`board_${boardId}`);
    socketRooms[socket.id] = boardId;
    boardConnectionCount[boardId] = (boardConnectionCount[boardId] || 0) + 1;
    console.log(`Socket ${socket.id} joined board_${boardId} (${boardConnectionCount[boardId]} connected)`);
  });

  // Cache logic moved to boardCache.js

  socket.on('draw-progress', (data) => {
    // data = { boardId, path, socketId }
    socket.to(`board_${data.boardId}`).emit('draw-progress', data);
  });

  socket.on('viewport-update', (data) => {
    socket.to(`board_${data.boardId}`).emit('viewport-update', data);
  });

  socket.on('draw-stroke', async (data) => {
    // data = { boardId, stroke, socketId }
    socket.to(`board_${data.boardId}`).emit('draw-stroke', data);
    const elements = await getBoardState(data.boardId);
    elements.push(data.stroke);
    saveBoardState(data.boardId);
  });

  socket.on('undo', async (boardId) => {
    socket.to(`board_${boardId}`).emit('undo');
    const elements = await getBoardState(boardId);
    elements.pop();
    saveBoardState(boardId);
  });

  socket.on('clear-canvas', async (boardId) => {
    socket.to(`board_${boardId}`).emit('clear-canvas');
    boardStates[boardId] = [];
    saveBoardState(boardId);
  });

  socket.on('delete-element', async (data) => {
    // data = { boardId, elementId }
    socket.to(`board_${data.boardId}`).emit('delete-element', data);
    const elements = await getBoardState(data.boardId);
    boardStates[data.boardId] = elements.filter(el => el.id !== data.elementId);
    saveBoardState(data.boardId);
  });

  socket.on('update-element', async (data) => {
    // data = { boardId, element }
    socket.to(`board_${data.boardId}`).emit('update-element', data);
    const elements = await getBoardState(data.boardId);
    const index = elements.findIndex(el => el.id === data.element.id);
    if (index !== -1) {
      elements[index] = data.element;
      boardStates[data.boardId] = elements;
      saveBoardState(data.boardId);
    }
  });

  socket.on('canvas-update', async (data) => {
    // Fallback for full sync if needed
    socket.to(`board_${data.boardId}`).emit('canvas-update', data.canvasState);
    boardStates[data.boardId] = data.canvasState;
    saveBoardState(data.boardId);
  });

  socket.on('cursor-move', (data) => {
    // data = { boardId, username, x, y, color }
    socket.to(`board_${data.boardId}`).emit('cursor-move', { ...data, socketId: socket.id });
  });

  socket.on('disconnect', async () => {
    const boardId = socketRooms[socket.id];
    if (boardId) {
      socket.to(`board_${boardId}`).emit('cursor-leave', socket.id);
      delete socketRooms[socket.id];
      
      // Decrement connection count and evict cache if no one is left
      boardConnectionCount[boardId] = (boardConnectionCount[boardId] || 1) - 1;
      if (boardConnectionCount[boardId] <= 0) {
        delete boardConnectionCount[boardId];
        // Flush pending save to DB first, then free RAM
        await flushSave(boardId);
        delete boardStates[boardId];
        console.log(`Board ${boardId} evicted from memory (no users remaining)`);
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
