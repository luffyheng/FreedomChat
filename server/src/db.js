import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';

const dbPath = process.env.DB_PATH || './data/chatmamba.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// node:sqlite ships with Node.js (no native compilation required).
// Requires Node.js 22.5+. Flagless since Node 24.
export const db = new DatabaseSync(dbPath);
try { db.exec('PRAGMA journal_mode = WAL;'); } catch {}

// Wrap db so callers that used better-sqlite3-style `db.transaction(fn)`
// keep working (node:sqlite doesn't ship a transaction helper).
db.transaction = function (fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,
  tags TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  graph_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT DEFAULT '',
  match_mode TEXT DEFAULT 'contains',
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  phone TEXT NOT NULL,
  body TEXT,
  media_type TEXT,
  flow_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  media_url TEXT,
  status TEXT DEFAULT 'draft',
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  delay_ms INTEGER DEFAULT 2000,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_targets (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  sent_at INTEGER,
  FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sequence_queues (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  delay_ms INTEGER DEFAULT 86400000,
  graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  FOREIGN KEY(sequence_id) REFERENCES sequences(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sequence_subscribers (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  subscribed_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  UNIQUE(sequence_id, phone),
  FOREIGN KEY(sequence_id) REFERENCES sequences(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sequence_dispatches (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at INTEGER,
  error TEXT,
  UNIQUE(subscriber_id, queue_id),
  FOREIGN KEY(subscriber_id) REFERENCES sequence_subscribers(id) ON DELETE CASCADE,
  FOREIGN KEY(queue_id) REFERENCES sequence_queues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_attributes (
  phone TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (phone, key)
);
`);

// Add last_activity column to contacts if missing (lightweight migration)
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN last_activity INTEGER`);
} catch {}
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN status TEXT DEFAULT 'reachable'`);
} catch {}
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN jid TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN push_name TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0`);
} catch {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN mimetype TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN resolved_number TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN author_jid TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN author_name TEXT`);
} catch {}

// Contact lists
db.exec(`
CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_list_members (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(list_id, phone),
  FOREIGN KEY(list_id) REFERENCES contact_lists(id) ON DELETE CASCADE
);
`);

// Auth: users, sessions, password resets
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pwdresets_user ON password_resets(user_id);
`);

// Broadcast: drip-style fields
const bcCols = [
  ['min_delay_ms', 'INTEGER DEFAULT 600000'],   // 10 minutes
  ['max_delay_ms', 'INTEGER DEFAULT 900000'],   // 15 minutes
  ['daily_limit',  'INTEGER DEFAULT 30'],
  ['daily_sent',   'INTEGER DEFAULT 0'],
  ['last_dispatch_date', 'TEXT'],               // 'YYYY-MM-DD'
  ['list_id',      'TEXT'],
  ['image_url',    'TEXT'],
  ['next_due_at',  'INTEGER DEFAULT 0'],
  ['paused_until', 'INTEGER DEFAULT 0'],
  ['resume_hour',  'INTEGER DEFAULT 10'],        // 0-23 — when to resume after daily quota hit
  ['resume_minute','INTEGER DEFAULT 0'],         // 0-59
  ['messages_json','TEXT'],                      // JSON array of message variants (round-robin)
];
for (const [name, type] of bcCols) {
  try { db.exec(`ALTER TABLE broadcasts ADD COLUMN ${name} ${type}`); } catch {}
}

// Broadcast targets: ack tracking + name snapshot + retry bookkeeping
const btCols = [
  ['message_id',    'TEXT'],                     // WhatsApp message id (for ack matching)
  ['delivered_at',  'INTEGER'],
  ['read_at',       'INTEGER'],
  ['replied_at',    'INTEGER'],
  ['contact_name',  'TEXT'],                     // snapshot at send time, optional
  ['variant_index', 'INTEGER'],                  // which message variant was used (0-based)
  ['attempts',      'INTEGER DEFAULT 0'],        // number of failed send attempts
];
for (const [name, type] of btCols) {
  try { db.exec(`ALTER TABLE broadcast_targets ADD COLUMN ${name} ${type}`); } catch {}
}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_bt_message_id ON broadcast_targets(message_id)`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_bt_phone ON broadcast_targets(phone)`); } catch {}

// Quick Replies — pre-built bundles (text + audio + media) triggered by keyword
db.exec(`
CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_trigger ON quick_replies(trigger_code) WHERE trigger_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS quick_reply_items (
  id TEXT PRIMARY KEY,
  quick_reply_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  url TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(quick_reply_id) REFERENCES quick_replies(id) ON DELETE CASCADE
);
`);

export default db;
