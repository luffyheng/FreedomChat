/**
 * db.js — PostgreSQL adapter for ChatMamba (replaces node:sqlite)
 *
 * Uses the `pg` package to connect to Supabase (or any PostgreSQL server).
 * Set DATABASE_URL in .env — find it in Supabase dashboard:
 *   Project Settings → Database → Connection string → URI
 *   Use the "Transaction pooler" URL (port 6543) for VPS deployments.
 *
 * API mirrors the old SQLite API but every method is async (returns a Promise).
 *   db.prepare(sql).all(...params)  → Promise<row[]>
 *   db.prepare(sql).get(...params)  → Promise<row | null>
 *   db.prepare(sql).run(...params)  → Promise<{ changes: number }>
 *   db.exec(sql)                    → Promise<void>
 *   db.query(sql, params)           → Promise<row[]>   (raw pg)
 */
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('[db] DATABASE_URL is not set. Add it to your .env file.');
}

// Parse the URL manually so pg gets the FULL username (e.g. postgres.projectref)
// rather than truncating at the dot — a known issue with pg's built-in URL parser.
function parseDbUrl(rawUrl) {
  const u = new URL(rawUrl);
  return {
    host:     u.hostname,
    port:     parseInt(u.port) || 5432,
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: { rejectUnauthorized: false },
  };
}

export const pool = new Pool({
  ...parseDbUrl(process.env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Convert SQLite ? placeholders to PostgreSQL $1, $2, … */
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Thin compatibility shim.
 * Transforms SQL and exposes .all() / .get() / .run() as async methods.
 */
function prepare(sql) {
  const pgSql = toPositional(sql);
  return {
    /** Returns array of rows */
    all(...args) {
      const params = args.flat();
      return pool.query(pgSql, params.length ? params : undefined).then((r) => r.rows);
    },
    /** Returns first row or null */
    get(...args) {
      const params = args.flat();
      return pool
        .query(pgSql, params.length ? params : undefined)
        .then((r) => r.rows[0] ?? null);
    },
    /** Returns { changes: rowCount } */
    run(...args) {
      const params = args.flat();
      return pool
        .query(pgSql, params.length ? params : undefined)
        .then((r) => ({ changes: r.rowCount ?? 0 }));
    },
  };
}

export const db = {
  prepare,
  /** Execute raw SQL (no return value — used for DDL) */
  exec: (sql) => pool.query(sql).then(() => undefined),
  /** Raw query — returns row array */
  query: (sql, params = []) => pool.query(sql, params).then((r) => r.rows),
  /**
   * Fake transaction wrapper — calls fn directly without BEGIN/COMMIT.
   * Real transactions would need a client handle passed into fn; for the
   * bulk-insert use-cases in this app, sequential execution is fine.
   */
  transaction: (fn) =>
    async (...args) =>
      fn(...args),
};

export default db;
