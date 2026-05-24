const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

// ── Change this to your ChatMamba server URL ──────────────────────────────
const CHATMAMBA_URL = 'https://blast.ayadvisorysolution.com';
// ─────────────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'ChatMamba',
    // icon: path.join(__dirname, 'icon.ico'), // add your icon here
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow credentials / cookies to work
      webSecurity: true,
    },
    backgroundColor: '#09090b',
  });

  mainWindow.loadURL(CHATMAMBA_URL);

  // Open links that try to open a new window in the system browser instead
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(CHATMAMBA_URL)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Simple menu: just the reload / back / forward shortcuts
  const menu = Menu.buildFromTemplate([
    {
      label: 'ChatMamba',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.reload() },
        { label: 'Back',   accelerator: 'Alt+Left',    click: () => mainWindow.webContents.goBack() },
        { label: 'Forward',accelerator: 'Alt+Right',   click: () => mainWindow.webContents.goForward() },
        { type: 'separator' },
        { label: 'Quit',   accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
