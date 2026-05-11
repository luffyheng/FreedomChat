import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('./server/data/chatmamba.db');
const contacts = db.prepare(`SELECT id, phone FROM contacts WHERE jid IS NULL OR jid = ''`).all();
const upd = db.prepare('UPDATE contacts SET jid = ? WHERE id = ?');
let n = 0;
for (const c of contacts) {
  const digits = String(c.phone).replace(/[^0-9]/g, '');
  const m = db
    .prepare(
      `SELECT phone FROM messages
         WHERE REPLACE(REPLACE(REPLACE(phone,'@c.us',''),'@lid',''),'@g.us','') = ?
         ORDER BY created_at DESC LIMIT 1`
    )
    .get(digits);
  if (m && m.phone) {
    upd.run(m.phone, c.id);
    n++;
  }
}
console.log('backfilled jid on', n, 'contacts');
