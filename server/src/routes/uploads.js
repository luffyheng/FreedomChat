import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

const UPLOAD_DIR = path.resolve('./data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^.\w]/g, '').slice(0, 8);
    cb(null, `${nanoid()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const router = Router();

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  // Return a relative URL — the frontend's Vite dev proxy forwards /uploads/*
  // to the backend. Works in production too when everything serves off one host.
  const url = `/uploads/${req.file.filename}`;
  res.json({
    url,
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

export default router;
export { UPLOAD_DIR };
