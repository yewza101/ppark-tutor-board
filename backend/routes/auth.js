const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../db/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start with a guessable signing key.');
  process.exit(1);
}

// Master admin credentials come from env. Without them the master account is simply disabled.
const MASTER_USERNAME = process.env.MASTER_ADMIN_USERNAME || 'adminpark';
const MASTER_PASSWORD = process.env.MASTER_ADMIN_PASSWORD;
const MASTER_CODE = process.env.MASTER_ADMIN_CODE;
if (!MASTER_PASSWORD && !MASTER_CODE) {
  console.warn('WARNING: neither MASTER_ADMIN_PASSWORD nor MASTER_ADMIN_CODE is set - the master admin account is disabled. Set them in backend/.env to manage teachers.');
}

const masterUser = () => ({
  id: 999999,
  username: MASTER_USERNAME,
  role: 'admin',
  isMasterAdmin: true,
  teacher_code: MASTER_USERNAME,
  group_name: 'Master'
});

const signUser = (user) => jwt.sign(
  { id: user.id, username: user.username, role: user.role, group_name: user.group_name },
  JWT_SECRET,
  { expiresIn: '24h' }
);

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  teacher_code: user.teacher_code,
  group_name: user.group_name
});

// Constant-time-ish comparison so a wrong master password cannot be timed out character by character.
const secretsMatch = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// Teacher codes are short and are the only credential for a teacher account, so an
// unthrottled endpoint is brute-forceable. Fixed-window counter per IP.
// ponytail: in-memory, so it resets on restart and is per-instance; move to Redis
// only if this ever runs on more than one dyno.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 30;
const attempts = new Map();

const rateLimit = (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else if (++entry.count > RATE_MAX) {
    return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
  }

  // Drop expired buckets so the map cannot grow without bound.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  next();
};

// A successful sign-in clears the counter so a busy classroom on one shared IP
// is not locked out by its own students logging in.
const clearRate = (req) => attempts.delete(req.ip || req.socket.remoteAddress || 'unknown');

router.post('/login', rateLimit, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (MASTER_PASSWORD && username === MASTER_USERNAME && secretsMatch(password, MASTER_PASSWORD)) {
    clearRate(req);
    const master = masterUser();
    return res.json({ token: jwt.sign(master, JWT_SECRET, { expiresIn: '24h' }), user: master });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();

  // A user row with no usable hash (e.g. a teacher created before a password was set)
  // must never fall through to a successful compare.
  if (error || !user || !user.password_hash) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  clearRate(req);
  res.json({ token: signUser(user), user: publicUser(user) });
});

router.post('/login-teacher', rateLimit, async (req, res) => {
  const { teacher_code } = req.body;
  if (!teacher_code) {
    return res.status(400).json({ message: 'Teacher code is required' });
  }

  if (MASTER_CODE && secretsMatch(teacher_code, MASTER_CODE)) {
    clearRate(req);
    const master = masterUser();
    return res.json({ token: jwt.sign(master, JWT_SECRET, { expiresIn: '24h' }), user: master });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'admin')
    .eq('teacher_code', teacher_code)
    .single();

  if (error || !user) {
    return res.status(401).json({ message: 'Invalid teacher code' });
  }

  clearRate(req);
  res.json({ token: signUser(user), user: publicUser(user) });
});

module.exports = { authRouter: router, JWT_SECRET };
