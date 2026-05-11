import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

const SESSION_COOKIE = 'cm_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TTL_MS = 60 * 60 * 1000;             // 1 hour
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function createSession(userId) {
  const id = randomToken(32);
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)'
  ).run(id, userId, now + SESSION_TTL_MS, now);
  return id;
}

function destroySession(id) {
  if (!id) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function lookupSession(id) {
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at, u.id AS user_id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(id);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(id);
    return null;
  }
  return row;
}

function setSessionCookie(res, sid) {
  const parts = [
    `${SESSION_COOKIE}=${sid}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function requireAuth(req, res, next) {
  const sid = req.cookies?.[SESSION_COOKIE];
  const session = lookupSession(sid);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: session.user_id, email: session.email };
  req.sessionId = session.sid;
  next();
}

export function seedAdminUser() {
  const email = (process.env.ADMIN_EMAIL || 'luffyheng@gmail.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'Testing123';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;
  const id = randomToken(8);
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run(id, email, hash, now, now);
  console.log(`[auth] seeded admin user ${email}`);
}

const router = Router();

router.get('/me', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  const session = lookupSession(sid);
  if (!session) return res.json({ user: null });
  res.json({ user: { id: session.user_id, email: session.email } });
});

router.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const sid = createSession(user.id);
  setSessionCookie(res, sid);
  res.json({ user: { id: user.id, email: user.email } });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  destroySession(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/forgot', (req, res) => {
  const { email = '' } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  // Always respond 200 to prevent email enumeration
  if (!normalizedEmail) return res.json({ ok: true });
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalizedEmail);
  if (user) {
    const token = randomToken(32);
    const now = Date.now();
    db.prepare(
      'INSERT INTO password_resets (token, user_id, expires_at, created_at) VALUES (?,?,?,?)'
    ).run(token, user.id, now + RESET_TTL_MS, now);

    const resetUrl = `${APP_ORIGIN}/reset/${token}`;
    // TODO: send email via SMTP once configured. For now, log it.
    console.log(`\n[auth] password reset requested for ${user.email}`);
    console.log(`[auth] reset link (valid 1h):\n  ${resetUrl}\n`);
  }
  res.json({ ok: true });
});

router.post('/reset/:token', async (req, res) => {
  const { password = '' } = req.body || {};
  const { token } = req.params;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!reset || reset.used_at || reset.expires_at < Date.now()) {
    return res.status(400).json({ error: 'invalid or expired token' });
  }
  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hash,
      now,
      reset.user_id
    );
    db.prepare('UPDATE password_resets SET used_at = ? WHERE token = ?').run(now, token);
    // Invalidate any other sessions for safety
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
  });
  tx();
  res.json({ ok: true });
});

export default router;
