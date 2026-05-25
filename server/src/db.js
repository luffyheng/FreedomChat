/**
 * db.js — Supabase JS client adapter for ChatMamba
 *
 * Connects via @supabase/supabase-js (HTTPS / PostgREST) instead of a raw
 * PostgreSQL TCP connection, eliminating connection-pooler instability.
 *
 * Required env vars:
 *   SUPABASE_URL         https://your-ref.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key (Settings → API → service_role)
 *
 * Requires two helper functions in your Supabase SQL editor (run once):
 *
 *   create or replace function run_select(q text)
 *   returns json language plpgsql security definer set search_path = public as $$
 *   declare result json;
 *   begin
 *     execute 'select coalesce(json_agg(r),''[]''::json) from (' || q || ') r' into result;
 *     return coalesce(result, '[]'::json);
 *   exception when others then raise exception '%', sqlerrm;
 *   end; $$;
 *
 *   create or replace function run_dml(q text)
 *   returns int language plpgsql security definer set search_path = public as $$
 *   declare n int;
 *   begin
 *     execute q;
 *     get diagnostics n = row_count;
 *     return n;
 *   exception when others then raise exception '%', sqlerrm;
 *   end; $$;
 *
 * API (all methods return Promises — same as before):
 *   db.prepare(sql).all(...params)  → Promise<row[]>
 *   db.prepare(sql).get(...params)  → Promise<row | null>
 *   db.prepare(sql).run(...params)  → Promise<{ changes: number }>
 *   db.exec(sql)                    → Promise<void>   (DDL)
 *   db.query(sql, params)           → Promise<row[]>
 */

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    '[db] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. ' +
    'Get them from Supabase Dashboard → Settings → API.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

/**
 * Inline $1, $2 … positional params into a SQL string safely.
 * Numbers / booleans / null are inlined directly.
 * Strings get single-quote escaping ('' for every ').
 */
function bindParams(sql, params) {
  if (!params.length) return sql;
  return sql.replace(/\$(\d+)/g, (_, n) => {
    const val = params[Number(n) - 1];
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number' || typeof val === 'bigint') return String(val);
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    // Escape backslashes first, then single quotes
    return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  });
}

async function rpcSelect(sql) {
  const { data, error } = await supabase.rpc('run_select', { q: sql });
  if (error) {
    const err = new Error(error.message);
    err.hint = error.hint;
    err.details = error.details;
    throw err;
  }
  return Array.isArray(data) ? data : [];
}

async function rpcDml(sql) {
  const { data, error } = await supabase.rpc('run_dml', { q: sql });
  if (error) {
    const err = new Error(error.message);
    err.hint = error.hint;
    throw err;
  }
  return typeof data === 'number' ? data : 0;
}

/**
 * Thin compatibility shim — same API as the old pg-based db.prepare().
 */
function prepare(sql) {
  return {
    /** Returns array of rows */
    async all(...args) {
      return rpcSelect(bindParams(sql, args.flat()));
    },
    /** Returns first row or null */
    async get(...args) {
      const rows = await rpcSelect(bindParams(sql, args.flat()));
      return rows[0] ?? null;
    },
    /** Returns { changes: rowCount } */
    async run(...args) {
      const changes = await rpcDml(bindParams(sql, args.flat()));
      return { changes };
    },
  };
}

export const db = {
  prepare,
  /** Execute raw DDL — splits on ; and runs each statement */
  exec: async (sql) => {
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try {
        await rpcDml(stmt);
      } catch (e) {
        // Silently skip "already exists" errors during schema init
        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) throw e;
      }
    }
  },
  /** Raw query — returns row array */
  query: async (sql, params = []) => rpcSelect(bindParams(sql, params)),
  /**
   * Fake transaction wrapper — runs fn directly.
   * Real transactions would need explicit BEGIN/COMMIT via rpcDml; sufficient for this app.
   */
  transaction: (fn) => async (...args) => fn(...args),
};

export default db;
