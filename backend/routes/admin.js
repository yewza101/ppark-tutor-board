const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../db/database');
const { JWT_SECRET } = require('./auth');

const router = express.Router();

// Middleware to verify Admin
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

router.use(verifyAdmin);

// Get all students
router.get('/students', async (req, res) => {
  const { data: students, error } = await supabase
    .from('users')
    .select('id, username, created_at, group_name')
    .eq('role', 'student')
    .order('id', { ascending: false });

  if (error) {
    return res.status(500).json({ message: 'Error fetching students' });
  }
  res.json(students);
});

// Create a new student
router.post('/students', async (req, res) => {
  const { username, password, group_name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{ username, password_hash: hash, role: 'student', group_name: group_name || 'General' }])
      .select('id, username, group_name');
      
    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ message: 'Username already exists' });
      }
      throw error;
    }
    
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update student password
router.put('/students/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('id', req.params.id)
    .eq('role', 'student');
  
  if (error) {
    return res.status(500).json({ message: 'Failed to update password' });
  }

  res.json({ message: 'Password updated successfully' });
});

// Delete student
router.delete('/students/:id', async (req, res) => {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', req.params.id)
    .eq('role', 'student');
  
  if (error) {
    return res.status(500).json({ message: 'Failed to delete student' });
  }

  res.json({ message: 'Student deleted successfully' });
});

module.exports = router;
