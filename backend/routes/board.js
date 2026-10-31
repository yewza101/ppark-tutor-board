const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./auth');
const { getBoardState } = require('../boardCache');
const supabase = require('../db/database');

const router = express.Router();

// Middleware to verify Auth
const verifyAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

router.use(verifyAuth);

// Get board data for a specific user
router.get('/:userId', async (req, res) => {
  const userIdParam = req.params.userId;
  const isTeacherBoard = userIdParam.startsWith('teacher_board');

  // Teacher boards are shared rooms, but cap the id length so a client cannot
  // mint unbounded cache keys by spamming random suffixes.
  if (isTeacherBoard) {
    if (userIdParam.length > 128) {
      return res.status(400).json({ message: 'Invalid board id' });
    }
    try {
      const elements = await getBoardState(userIdParam);
      return res.json({ canvas_data: JSON.stringify(elements) });
    } catch (err) {
      console.error('Error fetching board:', err);
      return res.status(500).json({ message: 'Error fetching board' });
    }
  }

  // Students may only ever read their own board, by id or by username.
  if (req.user.role === 'student') {
    if (userIdParam !== req.user.username && String(userIdParam) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    try {
      const elements = await getBoardState(req.user.id);
      return res.json({ canvas_data: JSON.stringify(elements) });
    } catch (err) {
      console.error('Error fetching board:', err);
      return res.status(500).json({ message: 'Error fetching board' });
    }
  }

  // Teachers: numeric id only, and only for a student they own.
  const targetUserId = parseInt(userIdParam, 10);
  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ message: 'Invalid board id' });
  }

  if (!req.user.isMasterAdmin) {
    const { data: student } = await supabase
      .from('users')
      .select('id')
      .eq('id', targetUserId)
      .eq('role', 'student')
      .eq('teacher_id', req.user.id)
      .single();

    // Without this check any teacher could read every other teacher's students' boards.
    if (!student) {
      return res.status(403).json({ message: 'Forbidden' });
    }
  }

  try {
    const elements = await getBoardState(targetUserId);
    res.json({ canvas_data: JSON.stringify(elements) });
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ message: 'Error fetching board' });
  }
});

module.exports = router;
