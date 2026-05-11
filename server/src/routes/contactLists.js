import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import db from '../db.js';

/**
 * Parse CSV / XLSX / XLS uploads into a flat array of {phone, name?} rows.
 * Tolerates messy column names: phone, Phone, number, Number, contact, mobile,
 * "Phone Number", "Contact Number", with-or-without-spaces, etc.
 */
// Country name → E.164 calling code (no + prefix). Add more as needed.
const COUNTRY_CODES = {
  malaysia: '60', singapore: '65', indonesia: '62', thailand: '66',
  philippines: '63', vietnam: '84', brunei: '673', australia: '61',
  india: '91', china: '86', 'hong kong': '852', taiwan: '886',
  japan: '81', korea: '82', uk: '44', usa: '1', us: '1', canada: '1',
};

/**
 * Normalize a phone string into the form WhatsApp expects: digits only,
 * including country code. Tries:
 *   1) If number already starts with a known country code (8+ digits), use as-is.
 *   2) If row has a COUNTRY column we recognize, strip leading zeros and prefix.
 *   3) If `defaultCC` is supplied, fall back to that.
 *   4) Otherwise return the raw digits (caller can decide to skip).
 */
function normalizePhone(rawPhone, country, defaultCC) {
  let digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  // Already looks E.164-ish: 10+ digits, doesn't start with 0
  if (digits.length >= 10 && digits[0] !== '0') return digits;
  // Strip a single leading 0 (national prefix)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  const cc = (country && COUNTRY_CODES[String(country).trim().toLowerCase()]) || defaultCC || '';
  if (cc) return cc + digits;
  return digits;
}

function parseUpload(file, opts = {}) {
  const defaultCC = String(opts.defaultCountryCode || '').replace(/[^\d]/g, '');
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  let records = [];
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    records = parse(file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } else {
    // xlsx / xls / xlsm — read first sheet
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    records = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  const phoneKeys = ['phone', 'Phone', 'PHONE', 'number', 'Number', 'NUMBER', 'mobile', 'Mobile',
    'contact', 'Contact', 'phone_number', 'Phone Number', 'Contact Number', 'tel', 'Tel',
    'whatsapp', 'WhatsApp', 'wa'];
  const nameKeys = ['name', 'Name', 'NAME', 'full_name', 'Full Name', 'contact_name',
    'Contact Name', 'fullname'];
  const countryKeys = ['country', 'Country', 'COUNTRY', 'nation'];

  const findKey = (obj, candidates) => {
    const keys = Object.keys(obj);
    // exact match first
    for (const c of candidates) if (keys.includes(c)) return c;
    // case-insensitive normalized match
    const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
    const want = candidates.map(norm);
    for (const k of keys) if (want.includes(norm(k))) return k;
    return null;
  };

  return records
    .map((r) => {
      const pk = findKey(r, phoneKeys);
      const nk = findKey(r, nameKeys);
      const ck = findKey(r, countryKeys);
      let raw = pk ? r[pk] : null;
      if (!raw) {
        for (const v of Object.values(r)) {
          const s = String(v || '');
          const digits = s.replace(/[^\d]/g, '');
          if (digits.length >= 8) { raw = s; break; }
        }
      }
      const country = ck ? String(r[ck] || '') : '';
      const phone = normalizePhone(raw, country, defaultCC);
      return { phone, name: nk ? String(r[nk] || '') : '' };
    })
    .filter((r) => r.phone && r.phone.length >= 8);
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT cl.*,
        (SELECT COUNT(*) FROM contact_list_members WHERE list_id = cl.id) AS member_count
       FROM contact_lists cl
       ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name = 'Untitled List', description = '' } = req.body || {};
  const id = nanoid();
  db.prepare(
    'INSERT INTO contact_lists (id, name, description, created_at) VALUES (?,?,?,?)'
  ).run(id, name, description, Date.now());
  res.json({ id });
});

router.get('/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM contact_lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const total = db
    .prepare('SELECT COUNT(*) AS c FROM contact_list_members WHERE list_id = ?')
    .get(req.params.id).c;
  const members = db
    .prepare('SELECT * FROM contact_list_members WHERE list_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  list.member_count = total;
  res.json({ ...list, members });
});

router.put('/:id', (req, res) => {
  const { name, description } = req.body || {};
  const ex = db.prepare('SELECT * FROM contact_lists WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE contact_lists SET name = ?, description = ? WHERE id = ?').run(
    name ?? ex.name,
    description ?? ex.description,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contact_lists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/members', (req, res) => {
  const { phone, name = '' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const digits = String(phone).replace(/[^\d]/g, '');
  if (!digits) return res.status(400).json({ error: 'invalid phone' });
  try {
    const id = nanoid();
    db.prepare(
      'INSERT INTO contact_list_members (id, list_id, phone, name, created_at) VALUES (?,?,?,?,?)'
    ).run(id, req.params.id, digits, name, Date.now());
    res.json({ id });
  } catch (e) {
    res.status(409).json({ error: 'already in list' });
  }
});

router.delete('/:id/members/:memberId', (req, res) => {
  db.prepare('DELETE FROM contact_list_members WHERE id = ? AND list_id = ?').run(
    req.params.memberId,
    req.params.id
  );
  res.json({ ok: true });
});

router.post('/:id/members/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const defaultCountryCode = req.body?.defaultCountryCode || req.query?.defaultCountryCode || '60';
  let rows;
  try {
    rows = parseUpload(req.file, { defaultCountryCode });
  } catch (e) {
    return res.status(400).json({ error: 'parse failed: ' + e.message });
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO contact_list_members (id, list_id, phone, name, created_at) VALUES (?,?,?,?,?)'
  );
  const now = Date.now();
  let added = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const info = insert.run(nanoid(), req.params.id, r.phone, r.name || '', now);
      if (info.changes) added++;
    }
  });
  tx(rows);
  res.json({ added, total: rows.length });
});

export default router;
