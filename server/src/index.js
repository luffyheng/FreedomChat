import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';

import authRouter, { requireAuth, seedAdminUser } from './routes/auth.js';
import whatsappRouter from './routes/whatsapp.js';
import flowsRouter from './routes/flows.js';
import contactsRouter from './routes/contacts.js';
import broadcastsRouter from './routes/broadcasts.js';
import messagesRouter from './routes/messages.js';
import sequencesRouter from './routes/sequences.js';
import attributesRouter from './routes/attributes.js';
import uploadsRouter, { UPLOAD_DIR } from './routes/uploads.js';
import peopleActionsRouter from './routes/peopleActions.js';
import contactListsRouter from './routes/contactLists.js';
import quickRepliesRouter from './routes/quickReplies.js';
import { startBroadcastScheduler } from './services/broadcast.js';
import { initWhatsApp, setSocketIO, getStatus } from './services/whatsapp.js';
import { startSequenceDispatcher } from './services/sequenceDispatcher.js';

const PORT = process.env.PORT || 4000;

// Allow multiple origins: Firebase Hosting URL + local dev
// Set CLIENT_ORIGINS in .env as comma-separated list, e.g.:
//   CLIENT_ORIGINS=https://chatmamba-app.web.app,https://your-custom-domain.com
const rawOrigins = process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: allowedOrigins, credentials: true },
});
setSocketIO(io);

io.on('connection', (socket) => {
  socket.emit('wa:status', getStatus());
});

seedAdminUser().catch((e) => console.error('[auth] seed failed:', e));

// Auto-start WhatsApp on boot — reuses saved session files if they exist (no QR needed)
initWhatsApp().catch(e => console.error('[whatsapp] auto-start failed:', e));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

// All routes below require authentication
app.use('/api/whatsapp', requireAuth, whatsappRouter);
app.use('/api/flows', requireAuth, flowsRouter);
app.use('/api/contacts', requireAuth, contactsRouter);
app.use('/api/broadcasts', requireAuth, broadcastsRouter(io));
app.use('/api/messages', requireAuth, messagesRouter);
app.use('/api/sequences', requireAuth, sequencesRouter);
app.use('/api/attributes', requireAuth, attributesRouter);
app.use('/api/uploads', requireAuth, uploadsRouter);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use('/api/people', requireAuth, peopleActionsRouter);
app.use('/api/lists', requireAuth, contactListsRouter);
app.use('/api/quick-replies', requireAuth, quickRepliesRouter);

startSequenceDispatcher();
startBroadcastScheduler(io);

// In production, serve the built client SPA. Falls back to index.html
// for client-side routes so /login, /flows/:id etc. don't 404 on refresh.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/|\/socket\.io\/|\/uploads\/).*/, (req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  console.log(`[chatmamba] serving built client from ${clientDist}`);
}

server.listen(PORT, () => {
  console.log(`[chatmamba] server listening on http://localhost:${PORT}`);
});
