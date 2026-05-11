# Deploying ChatMamba to `blast.ayadvisorysolution.com`

This guide assumes a Linux VPS (Ubuntu/Debian) that already has
**nginx + PM2 + certbot** installed from your other apps. We use port `4011`
for this app's Node process — adjust if it clashes with something else.

The app runs as a **single Node process** that serves both the API and the
built React UI. nginx only handles TLS + reverse proxy.

---

## 0. DNS

Point an A record `blast.ayadvisorysolution.com` at your VPS public IP.
Wait for it to resolve before running certbot.

```
dig +short blast.ayadvisorysolution.com
```

---

## 1. Upload the project via WinSCP

Drop the whole repo at `/var/www/blast` (or any path you prefer — just match
it everywhere below).

**Do NOT upload** these (let the VPS rebuild them):

- `node_modules/` (in all three: root, `server/`, `client/`)
- `client/dist/`
- `server/data/` if you want a clean DB on the server
- `.git/` (optional, but reduces upload size)
- `logs/`

You also want to **omit `server/.env`** — we'll create a fresh one on the
VPS so credentials don't ride in your upload.

---

## 2. Install Node & system deps (Putty)

`whatsapp-web.js` drives Chromium, which on a fresh VPS needs system libs.
Skip the ones you already have:

```bash
# Node 22.x (required for node:sqlite)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Headless Chromium dependencies for whatsapp-web.js / Puppeteer
sudo apt install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 libxshmfence1 fonts-liberation
```

Verify:

```bash
node -v   # expect v22.x or higher
pm2 -v
nginx -v
```

---

## 3. Install app dependencies & build the client

```bash
cd /var/www/blast
npm run install:all
npm run build           # builds client/dist
mkdir -p logs server/data
```

---

## 4. Create `server/.env`

```bash
nano /var/www/blast/server/.env
```

Paste:

```
PORT=4011
NODE_ENV=production
CLIENT_ORIGIN=https://blast.ayadvisorysolution.com
APP_ORIGIN=https://blast.ayadvisorysolution.com
DB_PATH=./data/chatmamba.db
SESSION_NAME=blast-chatmamba

# First-run admin seed. Only takes effect when the users table is empty.
# After first boot, change password via /forgot — editing this is ignored.
ADMIN_EMAIL=luffyheng@gmail.com
ADMIN_PASSWORD=Testing123
```

---

## 5. Start with PM2

```bash
cd /var/www/blast
pm2 start ecosystem.config.cjs --env production
pm2 logs blast-chatmamba       # confirm it booted clean, ctrl+C to exit
pm2 save                        # persist so it auto-starts on reboot
```

Useful PM2 commands later:

```bash
pm2 status                      # see all your apps
pm2 reload blast-chatmamba      # zero-downtime restart after code update
pm2 stop blast-chatmamba
pm2 delete blast-chatmamba
pm2 logs blast-chatmamba --lines 200
```

At this point the app is reachable on `http://127.0.0.1:4011` from the VPS
itself but **not from outside** — nginx wires up the public face next.

---

## 6. nginx site

```bash
sudo cp /var/www/blast/deploy/nginx-blast.conf \
        /etc/nginx/sites-available/blast.ayadvisorysolution.com
sudo ln -s /etc/nginx/sites-available/blast.ayadvisorysolution.com \
           /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Open `http://blast.ayadvisorysolution.com` — you should see the login page
over HTTP. If yes, lock it down with TLS:

---

## 7. TLS via certbot

```bash
sudo certbot --nginx -d blast.ayadvisorysolution.com
```

Pick "redirect HTTP → HTTPS" when prompted. certbot edits the nginx site
file in-place. Auto-renewal is already wired up if certbot was previously
installed.

Reload once more to make sure everything's clean:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

You should now reach the app over **https://blast.ayadvisorysolution.com**.

---

## 8. Log in

- URL: `https://blast.ayadvisorysolution.com/login`
- Email: `luffyheng@gmail.com`
- Password: `Testing123`

**Change the password immediately** via `/forgot` — the reset link is logged
to PM2's stdout (`pm2 logs blast-chatmamba`) because email isn't configured
yet. Open the printed URL, set a new password.

---

## 9. Connect WhatsApp

Once logged in, go to **Connect → Start session**, scan the QR with your
phone. The session is persisted at `server/data/wa-session/` and survives
PM2 restarts.

If Chromium fails to launch, check `pm2 logs blast-chatmamba` — usually a
missing system library. Add it via apt and `pm2 reload blast-chatmamba`.

---

## Updating the app later

```bash
cd /var/www/blast
# upload new files via WinSCP (skip node_modules, .env, data/)
npm run install:all      # only if package.json changed
npm run build             # rebuild client/dist
pm2 reload blast-chatmamba
```

Database and WhatsApp session files at `server/data/` persist across
reloads — back them up periodically.

---

## What lives where on the VPS

| Path                                                 | What it is                       |
|------------------------------------------------------|----------------------------------|
| `/var/www/blast/`                                    | App code                         |
| `/var/www/blast/client/dist/`                        | Built React UI (served by Node)  |
| `/var/www/blast/server/data/chatmamba.db`            | SQLite database — **back up**    |
| `/var/www/blast/server/data/wa-session/`             | WhatsApp linked-device session   |
| `/var/www/blast/server/data/uploads/`                | User-uploaded media              |
| `/var/www/blast/logs/`                               | PM2 logs                         |
| `/etc/nginx/sites-available/blast.ayadvisorysolution.com` | nginx site config         |
| `~/.pm2/`                                            | PM2 state (do not touch)         |

---

## Common gotchas

- **DNS not propagated yet** → `dig` returns nothing → certbot will fail.
  Wait for DNS, then run certbot.
- **Port 4011 already taken** → `pm2 logs blast-chatmamba` shows `EADDRINUSE`.
  Edit `PORT` in `server/.env` AND in `ecosystem.config.cjs` AND in
  `deploy/nginx-blast.conf` (the `upstream` block), then reload all three.
- **WhatsApp QR never appears / session crashes** → missing Chromium libs.
  Install the apt package list in step 2.
- **Other vhost on same box also matches** → make sure no other nginx site
  is configured with `default_server` for port 80 that captures unknown
  hostnames; check with `sudo nginx -T | grep server_name`.
