const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../db/database');
const { JWT_SECRET } = require('./auth');
const { clearAllBoardCache } = require('../boardCache');

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

// Get all students (Master admin sees all; regular teacher sees their assigned students)
router.get('/students', async (req, res) => {
  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  let query = supabase
    .from('users')
    .select('id, username, created_at, group_name, teacher_id')
    .eq('role', 'student');

  if (!isMaster) {
    query = query.eq('teacher_id', req.user.id);
  }

  const { data: students, error } = await query.order('id', { ascending: false });

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
      .insert([{ username, password_hash: hash, role: 'student', group_name: group_name || 'General', teacher_id: req.user.id }])
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

  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  const hash = bcrypt.hashSync(password, 10);
  
  let query = supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('id', req.params.id)
    .eq('role', 'student');
  
  if (!isMaster) {
    query = query.eq('teacher_id', req.user.id);
  }

  const { error } = await query;
  if (error) {
    return res.status(500).json({ message: 'Failed to update password' });
  }

  res.json({ message: 'Password updated successfully' });
});

// Delete student
router.delete('/students/:id', async (req, res) => {
  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  let query = supabase
    .from('users')
    .delete()
    .eq('id', req.params.id)
    .eq('role', 'student');

  if (!isMaster) {
    query = query.eq('teacher_id', req.user.id);
  }

  const { error } = await query;
  if (error) {
    return res.status(500).json({ message: 'Failed to delete student' });
  }

  res.json({ message: 'Student deleted successfully' });
});

// Register a new teacher (Master admin only)
router.post('/register-teacher', async (req, res) => {
  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  if (!isMaster) {
    return res.status(403).json({ message: 'Only Master Admin (adminpark) can register new teachers' });
  }

  const { teacher_code, username } = req.body;
  
  if (!teacher_code || !username) {
    return res.status(400).json({ message: 'Username and teacher code are required' });
  }

  const defaultPasswordHash = bcrypt.hashSync('default-teacher-password', 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ 
      username, 
      password_hash: defaultPasswordHash, 
      role: 'admin', 
      teacher_code 
    }])
    .select('id, username, role, teacher_code');
    
  if (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ message: 'Teacher code or username already exists' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
  
  res.status(201).json({ message: 'Teacher registered successfully', user: data[0] });
});

// Get all teachers (for master admin management)
router.get('/teachers', async (req, res) => {
  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  if (!isMaster) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { data: teachers, error } = await supabase
    .from('users')
    .select('id, username, teacher_code, created_at')
    .eq('role', 'admin')
    .neq('username', 'adminpark')
    .order('id', { ascending: false });

  if (error) {
    return res.status(500).json({ message: 'Error fetching teachers' });
  }
  res.json(teachers || []);
});

// Delete a teacher (Master admin only)
router.delete('/teachers/:id', async (req, res) => {
  const isMaster = req.user.isMasterAdmin || req.user.username === 'adminpark';
  if (!isMaster) {
    return res.status(403).json({ message: 'Only Master Admin (adminpark) can delete teachers' });
  }

  const teacherId = req.params.id;
  
  // Guard: Never delete adminpark
  const { data: targetUser } = await supabase
    .from('users')
    .select('username')
    .eq('id', teacherId)
    .single();

  if (targetUser?.username === 'adminpark') {
    return res.status(400).json({ message: 'Cannot delete master admin' });
  }

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', teacherId)
    .eq('role', 'admin');

  if (error) {
    return res.status(500).json({ message: 'Failed to delete teacher' });
  }

  res.json({ message: 'Teacher deleted successfully' });
});

// Master System Cleanup: Clear all board cache, canvas drawings, and uploaded documents
// IMPORTANT: Does NOT delete student or teacher accounts from `users`
router.post('/clear-all-documents', async (req, res) => {
  try {
    // 1. Clear in-memory board cache and debounced timers
    clearAllBoardCache();

    // 2. Clear all boards data from database
    const { error: dbError } = await supabase
      .from('boards')
      .delete()
      .neq('user_id', 0); // deletes all rows

    if (dbError) {
      console.warn('Delete rows from boards warning, fallback to update:', dbError);
      await supabase.from('boards').update({ canvas_data: '[]' }).neq('user_id', 0);
    }

    // 3. Clear all files in storage bucket 'board-assests'
    let deletedFilesCount = 0;
    try {
      const { data: files } = await supabase.storage
        .from('board-assests')
        .list('', { limit: 1000 });

      if (files && files.length > 0) {
        const filePaths = files.map(f => f.name).filter(Boolean);
        if (filePaths.length > 0) {
          const { error: delError } = await supabase.storage
            .from('board-assests')
            .remove(filePaths);
          if (!delError) deletedFilesCount = filePaths.length;
        }
      }
    } catch (storageErr) {
      console.warn('Storage files cleanup notice:', storageErr);
    }

    res.json({ 
      message: 'ลบแคชกระดานและเอกสารทั้งหมดเรียบร้อยแล้ว (All documents and cache cleared)',
      deletedFilesCount 
    });
  } catch (err) {
    console.error('Failed to clear documents:', err);
    res.status(500).json({ message: 'Failed to clear all documents: ' + (err?.message || err) });
  }
});

module.exports = router;
