# ChatMamba Clone — WhatsApp Automation

A self-hosted WhatsApp automation platform inspired by ChatMamba. Pair your
personal WhatsApp by QR scan (same as ChatMamba / WhatsApp Web), build
drag-and-drop automation flows, import contacts, and run broadcasts.

## Features

- **QR-scan pairing** via `whatsapp-web.js` (no Cloud API / Meta approval needed)
- **Drag-and-drop flow builder** (React Flow) with node types:
  - Trigger (keyword / any message)
  - Send Text (supports `{{phone}}`, `{{lastMessage}}` variables)
  - Send Media (URL → image / video / document)
  - Delay
  - Condition (yes/no branches)
  - End
- **Triggers**: keyword (contains / exact / starts-with) or catch-all
- **Contacts**: add manually or import CSV (`name,phone,tags`)
- **Broadcasts**: select contacts + extra phones, configurable delay, live progress, pause/resume
- **Live Inbox**: see incoming messages in real-time (Socket.io) and send replies
- **Test run**: dispatch a flow to any number from the builder to QA it

## Stack

- **Backend**: Node.js, Express, Socket.io, better-sqlite3, whatsapp-web.js
- **Frontend**: Vite + React, Tailwind, React Flow (`@xyflow/react`), Zustand, react-router
- **Persistence**: SQLite file at `server/data/chatmamba.db` (auto-created), WhatsApp session at `server/data/wa-session/`

## Project layout

```
CHATMAMBA/
├── package.json          # root scripts (concurrently run both)
├── server/               # Node/Express API + WhatsApp engine
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js
│   │   ├── routes/       # whatsapp, flows, contacts, broadcasts, messages
│   │   └── services/     # whatsapp.js, flowEngine.js, broadcast.js
│   └── data/             # SQLite + WA session (gitignored)
└── client/               # Vite + React UI
    └── src/
        ├── App.jsx
        ├── pages/        # Dashboard, Connect, Flows, FlowBuilder, Contacts, Broadcast, Inbox
        ├── components/
        │   └── nodes/    # React Flow custom node renderers
        └── lib/          # api.js, socket.js
```

## Setup

Requirements: **Node 18+** and Chromium will be auto-downloaded by `whatsapp-web.js`'s Puppeteer dep.

```bash
# from the repo root
npm run install:all
cp server/.env.example server/.env   # optional, edit if needed
npm run dev
```

- API:  http://localhost:4000
- UI:   http://localhost:5173

## First-time flow

1. Open the UI → **Connect** → click **Start session**.
2. On your phone: WhatsApp → Settings → **Linked Devices** → **Link a Device** → scan the QR.
3. Status pill turns green ("Connected").
4. Go to **Flows** → **New flow**. Drag nodes from the left palette, wire handles, click **Save**.
5. In the flow builder left panel, click **add** under Triggers to bind a keyword like `hi`.
6. Message your connected WhatsApp account from another phone — the flow executes.

## CSV format for contact import

```
name,phone,tags
Alice,919000000001,vip
Bob,919000000002,
```

Phone numbers are normalized to digits only; country code must be included (no `+`).

## Broadcast notes

- Add a random delay (default 2s) between messages — go slow to avoid bans.
- Broadcasts are resumable: pause writes `status=paused`, start re-runs only pending targets.
- Media URL must be publicly reachable (the server downloads and forwards it).

## How the flow engine works

On every incoming message, the server fetches enabled triggers across all enabled flows. Any matching trigger dispatches `runFlowGraph` which walks the graph from the trigger node following edges; supports sequential steps (text/media/delay), conditional branching via `yes`/`no` source handles, and loop protection (visited set + 100-step guard).

Template variables available in text nodes:
- `{{phone}}` – contact's phone
- `{{lastMessage}}` – the message body that fired the trigger

## Important caveats

- **`whatsapp-web.js` is unofficial**: it automates WhatsApp Web. Heavy or spammy usage may get your number banned. For production SaaS, use the official Cloud API instead.
- **Single session per server process** (one linked WhatsApp number). Multi-tenant requires refactoring `SESSION_NAME` per tenant.
- No auth on the admin UI — add one before exposing it to the internet.

## Extending

- New node types → add to `client/src/components/nodes/nodes.jsx`, `FlowBuilder.jsx` palette, and `server/src/services/flowEngine.js` switch.
- Webhook triggers → add a route that calls `runFlowGraph` directly.
- Replace `whatsapp-web.js` with Baileys or Cloud API by swapping `server/src/services/whatsapp.js`.
