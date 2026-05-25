import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

const SESSION_COOKIE = 'cm_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TTL_MS = 60 * 60 * 1000;              // 1 hour
// Cross-domain (Firebase → Railway) requires SameSite=None; Secure
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function createSession(userId) {
  const id = randomToken(32);
  const now = Date.now();
  await db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)'
  ).run(id, userId, now + SESSION_TTL_MS, now);
  return id;
}

async function destroySession(id) {
  if (!id) return;
  await db.prepare('DELETE FROM sessions WHERE id = $1').run(id);
}

async function lookupSession(id) {
  if (!id) return null;
  const row = await db.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id AS user_id, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`
  ).get(id);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await destroySession(id);
    return null;
  }
  return row;
}

function setSessionCookie(res, sid) {
  const parts = [
    `${SESSION_COOKIE}=${sid}`,
    'HttpOnly',
    IS_PROD ? 'SameSite=None' : 'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (IS_PROD) parts.push('Secure'); // SameSite=None requires Secure
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    IS_PROD ? 'SameSite=None' : 'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Extract session token from cookie OR Authorization: Bearer header
function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return req.cookies?.[SESSION_COOKIE] || null;
}

export async function requireAuth(req, res, next) {
  try {
    const sid = extractToken(req);
    const session = await lookupSession(sid);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    req.user = { id: session.user_id, email: session.email };
    req.sessionId = session.sid;
    next();
  } catch (e) {
    next(e);
  }
}

export async function seedAdminUser() {
  const email = (process.env.ADMIN_EMAIL || 'luffyheng@gmail.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'Testing123';
  const existing = await db.prepare('SELECT id FROM users WHERE email = $1').get(email);
  if (existing) return;
  const id = randomToken(8);
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  await db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)'
  ).run(id, email, hash, now, now);
  console.log(`[auth] seeded admin user ${email}`);
}

const router = Router();

router.get('/me', async (req, res) => {
  try {
    const sid = extractToken(req);
    const session = await lookupSession(sid);
    if (!session) return res.json({ user: null });
    res.json({ user: { id: session.user_id, email: session.email } });
  } catch {
    res.json({ user: null });
  }
});

router.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = $1').get(normalizedEmail);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const sid = await createSession(user.id);
  setSessionCookie(res, sid); // kept for same-domain/local dev
  // Also return token in body so cross-domain clients can store in localStorage
  res.json({ user: { id: user.id, email: user.email }, token: sid });
});

router.post('/logout', async (req, res) => {
  const sid = extractToken(req);
  await destroySession(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/forgot', async (req, res) => {
  const { email = '' } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  if (!normalizedEmail) return res.json({ ok: true });
  const user = await db.prepare('SELECT id, email FROM users WHERE email = $1').get(normalizedEmail);
  if (user) {
    const token = randomToken(32);
    const now = Date.now();
    await db.prepare(
      'INSERT INTO password_resets (token, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)'
    ).run(token, user.id, now + RESET_TTL_MS, now);

    const resetUrl = `${APP_ORIGIN}/reset/${token}`;
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
  const reset = await db.prepare('SELECT * FROM password_resets WHERE token = $1').get(token);
  if (!reset || reset.used_at || reset.expires_at < Date.now()) {
    return res.status(400).json({ error: 'invalid or expired token' });
  }
  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  await db.prepare('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3').run(
    hash, now, reset.user_id
  );
  await db.prepare('UPDATE password_resets SET used_at = $1 WHERE token = $2').run(now, token);
  await db.prepare('DELETE FROM sessions WHERE user_id = $1').run(reset.user_id);
  res.json({ ok: true });
});

export default router;
