const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./auth');
const { getBoardState } = require('../boardCache');

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

  try {
    const elements = await getBoardState(targetUserId);
    res.json({ canvas_data: JSON.stringify(elements) });
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ message: 'Error fetching board' });
  }
});

module.exports = router;
