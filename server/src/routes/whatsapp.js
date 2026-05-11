import { Router } from 'express';
import { initWhatsApp, getStatus, logout, sendText, resolveAllContacts } from '../services/whatsapp.js';

const router = Router();

router.get('/status', (req, res) => res.json(getStatus()));

router.post('/connect', async (req, res) => {
  try {
    await initWhatsApp();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', async (req, res) => {
  await logout();
  res.json({ ok: true });
});

router.post('/resolve-contacts', async (req, res) => {
  try {
    const result = await resolveAllContacts();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/send', async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });
  try {
    await sendText(phone, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
