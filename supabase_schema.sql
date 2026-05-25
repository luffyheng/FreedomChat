-- ChatMamba — PostgreSQL schema for Supabase
-- Paste this entire file into Supabase → SQL Editor → New query → Run

-- ─── contacts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,
  tags TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  last_activity BIGINT,
  status TEXT DEFAULT 'reachable',
  jid TEXT,
  push_name TEXT,
  resolved_number TEXT
);

-- ─── flows ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  graph_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

-- ─── triggers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT DEFAULT '',
  match_mode TEXT DEFAULT 'contains',
  enabled INTEGER DEFAULT 1,
  created_at BIGINT NOT NULL
);

-- ─── messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  phone TEXT NOT NULL,
  body TEXT,
  media_type TEXT,
  flow_id TEXT,
  created_at BIGINT NOT NULL,
  read INTEGER DEFAULT 0,
  media_url TEXT,
  mimetype TEXT,
  author_jid TEXT,
  author_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ─── broadcasts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'draft',
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  delay_ms INTEGER DEFAULT 2000,
  min_delay_ms INTEGER DEFAULT 600000,
  max_delay_ms INTEGER DEFAULT 900000,
  daily_limit INTEGER DEFAULT 30,
  daily_sent INTEGER DEFAULT 0,
  last_dispatch_date TEXT,
  list_id TEXT,
  next_due_at BIGINT DEFAULT 0,
  paused_until BIGINT DEFAULT 0,
  resume_hour INTEGER DEFAULT 10,
  resume_minute INTEGER DEFAULT 0,
  messages_json TEXT,
  created_at BIGINT NOT NULL
);

-- ─── broadcast_targets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcast_targets (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  sent_at BIGINT,
  message_id TEXT,
  delivered_at BIGINT,
  read_at BIGINT,
  replied_at BIGINT,
  contact_name TEXT,
  variant_index INTEGER,
  attempts INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_bt_message_id ON broadcast_targets(message_id);
CREATE INDEX IF NOT EXISTS idx_bt_phone ON broadcast_targets(phone);
CREATE INDEX IF NOT EXISTS idx_bt_broadcast_status ON broadcast_targets(broadcast_id, status);

-- ─── sequences ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at BIGINT NOT NULL
);

-- ─── sequence_queues ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_queues (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  delay_ms BIGINT DEFAULT 86400000,
  graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}'
);

-- ─── sequence_subscribers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_subscribers (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  subscribed_at BIGINT NOT NULL,
  status TEXT DEFAULT 'active',
  UNIQUE(sequence_id, phone)
);

-- ─── sequence_dispatches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_dispatches (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES sequence_subscribers(id) ON DELETE CASCADE,
  queue_id TEXT NOT NULL REFERENCES sequence_queues(id) ON DELETE CASCADE,
  due_at BIGINT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at BIGINT,
  error TEXT,
  UNIQUE(subscriber_id, queue_id)
);

-- ─── user_attributes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_attributes (
  phone TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (phone, key)
);

-- ─── contact_lists ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);

-- ─── contact_list_members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_list_members (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  UNIQUE(list_id, phone)
);

-- ─── users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- ─── sessions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ─── password_resets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pwdresets_user ON password_resets(user_id);

-- ─── quick_replies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_code TEXT,
  presence_seconds INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_trigger
  ON quick_replies(trigger_code) WHERE trigger_code IS NOT NULL;

-- ─── quick_reply_items ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quick_reply_items (
  id TEXT PRIMARY KEY,
  quick_reply_id TEXT NOT NULL REFERENCES quick_replies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT,
  url TEXT,
  sort_order INTEGER DEFAULT 0
);
