const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../db/database');
const { JWT_SECRET } = require('./auth');

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
  const targetUserId = parseInt(req.params.userId, 10);
  
  // Student can only access their own board
  if (req.user.role === 'student' && req.user.id !== targetUserId) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { data: board, error } = await supabase
    .from('boards')
    .select('canvas_data')
    .eq('user_id', targetUserId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
    return res.status(500).json({ message: 'Error fetching board' });
  }

  res.json({ canvas_data: board ? board.canvas_data : null });
});

module.exports = router;
