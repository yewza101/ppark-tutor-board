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

// The master account lives in the `users` table like everyone else, so its password
// can be changed from inside the app. The env values below are bootstrap only: they
// create the row the first time someone signs in with them, and are ignored from
// then on. To recover a forgotten password, delete that row in Supabase and the
// next sign-in will seed it from env again.
const MASTER_USERNAME = process.env.MASTER_ADMIN_USERNAME || 'adminpark';
const MASTER_PASSWORD = process.env.MASTER_ADMIN_PASSWORD;
if (!MASTER_PASSWORD) {
  console.warn('WARNING: MASTER_ADMIN_PASSWORD is not set. If the master row does not exist yet, nobody can create it.');
}

const isMasterName = (username) => username === MASTER_USERNAME;

const signUser = (user) => jwt.sign(
  {
    id: user.id,
    username: user.username,
    role: user.role,
    group_name: user.group_name,
    ...(isMasterName(user.username) ? { isMasterAdmin: true } : {})
  },
  JWT_SECRET,
  { expiresIn: '24h' }
);

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  teacher_code: user.teacher_code,
  group_name: user.group_name,
  ...(isMasterName(user.username) ? { isMasterAdmin: true } : {})
});

// Constant-time-ish comparison so a wrong secret cannot be timed out character by character.
const secretsMatch = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const findMasterRow = async () => {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('username', MASTER_USERNAME)
    .maybeSingle();
  return data || null;
};

// Create the master row from the env bootstrap values. Only ever called after the
// caller has already proved they know one of those values.
const seedMasterRow = async () => {
  const hash = await bcrypt.hash(MASTER_PASSWORD, 10);
  const { data, error } = await supabase
    .from('users')
    .insert([{
      username: MASTER_USERNAME,
      password_hash: hash,
      role: 'admin',
      // Deliberately null: teacher codes are stored and matched in plain text, and
      // the master signs in on that route by hash comparison instead (below).
      teacher_code: null,
      group_name: 'Master'
    }])
    .select('*')
    .single();

  if (error) {
    // Another request may have seeded it first; re-read rather than fail the login.
    const existing = await findMasterRow();
    if (existing) return existing;
    console.error('Could not create the master admin row:', error.message || error);
    return null;
  }
  console.log('Master admin row created from MASTER_ADMIN_* env values.');
  return data;
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

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (isMasterName(username) && !user) {
    // First ever sign-in: accept the env password once, then persist the account.
    if (!MASTER_PASSWORD || !secretsMatch(password, MASTER_PASSWORD)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const seeded = await seedMasterRow();
    if (!seeded) return res.status(500).json({ message: 'Could not initialise the master account' });
    clearRate(req);
    return res.json({ token: signUser(seeded), user: publicUser(seeded) });
  }

  // A row with no usable hash must never fall through to a successful compare.
  if (!user || !user.password_hash) {
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

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'admin')
    .eq('teacher_code', teacher_code)
    .maybeSingle();

  if (user) {
    clearRate(req);
    return res.json({ token: signUser(user), user: publicUser(user) });
  }

  // The master has no stored teacher_code. Its one secret is the password, so this
  // route accepts it by comparing against the hash - the same value works in both
  // fields without ever being written down in the clear.
  const master = await findMasterRow();
  if (master?.password_hash) {
    if (await bcrypt.compare(teacher_code, master.password_hash)) {
      clearRate(req);
      return res.json({ token: signUser(master), user: publicUser(master) });
    }
    return res.status(401).json({ message: 'Invalid teacher code' });
  }

  // No master row yet: bootstrap it from env, same as the password route.
  if (MASTER_PASSWORD && secretsMatch(teacher_code, MASTER_PASSWORD)) {
    const seeded = await seedMasterRow();
    if (seeded) {
      clearRate(req);
      return res.json({ token: signUser(seeded), user: publicUser(seeded) });
    }
  }

  return res.status(401).json({ message: 'Invalid teacher code' });
});

module.exports = { authRouter: router, JWT_SECRET, MASTER_USERNAME };
