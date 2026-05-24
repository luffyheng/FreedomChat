const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.handle('list-partitions', () => {
  const dir = path.join(app.getPath('userData'), 'Partitions');
  try {
    return fs.readdirSync(dir).filter(n => n.startsWith('acc_'));
  } catch {
    return [];
  }
});

// Persist account list as JSON in userData — stable across dev/packaged
// builds and folder renames, unlike file:// localStorage.
function accountsFile() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

ipcMain.handle('load-accounts', () => {
  try {
    const raw = fs.readFileSync(accountsFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { accounts: [], activeId: null };
  }
});

ipcMain.handle('save-accounts', (_e, data) => {
  try {
    fs.writeFileSync(accountsFile(), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Luffy's Kingdom",
    backgroundColor: '#1f2329',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

// Belt-and-braces: also enforce a modern Chrome UA at the session level,
// in case the webview tag's `useragent` attribute is bypassed for any
// sub-resource request (some WhatsApp probes hit /check-update etc.).
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_UA);
    contents.session.setUserAgent(CHROME_UA);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
