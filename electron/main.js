const { app, BrowserWindow, BrowserView, Menu, shell, ipcMain } = require('electron');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────
const CHATMAMBA_URL  = 'https://blast.ayadvisorysolution.com';
const CM_PANEL_WIDTH = 400; // px — ChatMamba panel on the right

// Real Chrome UA so WhatsApp Web doesn't complain
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';
// ─────────────────────────────────────────────────────────────────────────

// Prevent WhatsApp Web from detecting Electron/automation
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

let mainWindow;
let waView;
let cmView;
let cmVisible = true;

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  const panelW = cmVisible ? CM_PANEL_WIDTH : 0;
  const waW    = w - panelW;
  waView.setBounds({ x: 0,   y: 0, width: waW,    height: h });
  cmView.setBounds({ x: waW, y: 0, width: panelW,  height: h });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:    1520,
    height:   900,
    minWidth: 900,
    minHeight: 600,
    title: 'ChatMamba',
    backgroundColor: '#111b21', // WA dark bg while loading
    // icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // ── WhatsApp Web ────────────────────────────────────────────────────────
  waView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:whatsapp',  // session saved → stays logged in
    },
  });
  mainWindow.addBrowserView(waView);

  // Hide navigator.webdriver so WA doesn't flag it as automation
  waView.webContents.on('dom-ready', () => {
    waView.webContents.executeJavaScript(
      `Object.defineProperty(navigator,'webdriver',{get:()=>false});`
    ).catch(() => {});
  });

  // Open WA links that spawn new windows in the system browser
  waView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  waView.webContents.loadURL('https://web.whatsapp.com', { userAgent: CHROME_UA });

  // ── ChatMamba panel ─────────────────────────────────────────────────────
  cmView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:chatmamba', // session saved → stays logged in
    },
  });
  mainWindow.addBrowserView(cmView);
  cmView.webContents.loadURL(`${CHATMAMBA_URL}/quick-replies`);

  cmView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Layout ──────────────────────────────────────────────────────────────
  layoutViews();
  mainWindow.on('resize', layoutViews);

  // ── Menu ────────────────────────────────────────────────────────────────
  const menu = Menu.buildFromTemplate([
    {
      label: 'ChatMamba',
      submenu: [
        {
          label: 'Toggle ChatMamba panel',
          accelerator: 'CmdOrCtrl+\\',
          click() {
            cmVisible = !cmVisible;
            layoutViews();
          },
        },
        { type: 'separator' },
        {
          label: 'Reload WhatsApp',
          accelerator: 'CmdOrCtrl+R',
          click: () => waView.webContents.reload(),
        },
        {
          label: 'Reload ChatMamba panel',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => cmView.webContents.reload(),
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Panel',
      submenu: [
        {
          label: 'Quick Replies',
          accelerator: 'CmdOrCtrl+1',
          click: () => cmView.webContents.loadURL(`${CHATMAMBA_URL}/quick-replies`),
        },
        {
          label: 'Inbox',
          accelerator: 'CmdOrCtrl+2',
          click: () => cmView.webContents.loadURL(`${CHATMAMBA_URL}/inbox`),
        },
        {
          label: 'Broadcasts',
          accelerator: 'CmdOrCtrl+3',
          click: () => cmView.webContents.loadURL(`${CHATMAMBA_URL}/broadcast`),
        },
        {
          label: 'Contacts',
          accelerator: 'CmdOrCtrl+4',
          click: () => cmView.webContents.loadURL(`${CHATMAMBA_URL}/contacts`),
        },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+5',
          click: () => cmView.webContents.loadURL(`${CHATMAMBA_URL}`),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'DevTools — WhatsApp',
          accelerator: 'F11',
          click: () => waView.webContents.toggleDevTools(),
        },
        {
          label: 'DevTools — ChatMamba panel',
          accelerator: 'F12',
          click: () => cmView.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
