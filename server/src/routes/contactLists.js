import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import db from '../db.js';

const COUNTRY_CODES = {
  malaysia: '60', singapore: '65', indonesia: '62', thailand: '66',
  philippines: '63', vietnam: '84', brunei: '673', australia: '61',
  india: '91', china: '86', 'hong kong': '852', taiwan: '886',
  japan: '81', korea: '82', uk: '44', usa: '1', us: '1', canada: '1',
};

function normalizePhone(rawPhone, country, defaultCC) {
  let digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length >= 10 && digits[0] !== '0') return digits;
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
    for (const c of candidates) if (keys.includes(c)) return c;
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

router.get('/', async (req, res) => {
  const rows = await db.prepare(
    `SELECT cl.*,
      (SELECT COUNT(*) FROM contact_list_members WHERE list_id = cl.id) AS member_count
     FROM contact_lists cl
     ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name = 'Untitled List', description = '' } = req.body || {};
  const id = nanoid();
  await db.prepare(
    'INSERT INTO contact_lists (id, name, description, created_at) VALUES ($1,$2,$3,$4)'
  ).run(id, name, description, Date.now());
  res.json({ id });
});

router.get('/:id', async (req, res) => {
  const list = await db.prepare('SELECT * FROM contact_lists WHERE id = $1').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const [countRow, members] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM contact_list_members WHERE list_id = $1').get(req.params.id),
    db.prepare('SELECT * FROM contact_list_members WHERE list_id = $1 ORDER BY created_at DESC').all(req.params.id),
  ]);
  list.member_count = Number(countRow?.c ?? 0);
  res.json({ ...list, members });
});

router.put('/:id', async (req, res) => {
  const { name, description } = req.body || {};
  const ex = await db.prepare('SELECT * FROM contact_lists WHERE id = $1').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'not found' });
  await db.prepare('UPDATE contact_lists SET name = $1, description = $2 WHERE id = $3').run(
    name ?? ex.name,
    description ?? ex.description,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM contact_lists WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/members', async (req, res) => {
  const { phone, name = '' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const digits = String(phone).replace(/[^\d]/g, '');
  if (!digits) return res.status(400).json({ error: 'invalid phone' });
  try {
    const id = nanoid();
    await db.prepare(
      'INSERT INTO contact_list_members (id, list_id, phone, name, created_at) VALUES ($1,$2,$3,$4,$5)'
    ).run(id, req.params.id, digits, name, Date.now());
    res.json({ id });
  } catch (e) {
    res.status(409).json({ error: 'already in list' });
  }
});

router.delete('/:id/members/:memberId', async (req, res) => {
  await db.prepare(
    'DELETE FROM contact_list_members WHERE id = $1 AND list_id = $2'
  ).run(req.params.memberId, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/members/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const defaultCountryCode = req.body?.defaultCountryCode || req.query?.defaultCountryCode || '60';
  let rows;
  try {
    rows = parseUpload(req.file, { defaultCountryCode });
  } catch (e) {
    return res.status(400).json({ error: 'parse failed: ' + e.message });
  }
  const now = Date.now();
  let added = 0;
  for (const r of rows) {
    const result = await db.prepare(
      'INSERT INTO contact_list_members (id, list_id, phone, name, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (list_id, phone) DO NOTHING'
    ).run(nanoid(), req.params.id, r.phone, r.name || '', now);
    if (result.changes) added++;
  }
  res.json({ added, total: rows.length });
});

export default router;
