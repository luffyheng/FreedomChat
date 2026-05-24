const accountListEl = document.getElementById('account-list');
const webviewContainer = document.getElementById('webview-container');
const emptyState = document.getElementById('empty-state');
const addBtn = document.getElementById('add-account');
const importBtn = document.getElementById('import-account');
const renameBtn = document.getElementById('rename-account');
const photoBtn = document.getElementById('change-photo');
const muteBtn = document.getElementById('toggle-mute');
const removeBtn = document.getElementById('remove-account');

// Unread tracking:
//   baseline = the lowest unread count we've seen for this account.
//   badge = current - baseline. Auto-resets when user reads messages.
const baselineMap = new Map(); // acc.id -> number
const unreadMap = new Map();   // acc.id -> number

// Modal elements (Electron has no window.prompt/confirm)
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalInput = document.getElementById('modal-input');
const modalOk = document.getElementById('modal-ok');
const modalCancel = document.getElementById('modal-cancel');

function showModal({ title, message = '', defaultValue = '', showInput = true, okText = 'OK' }) {
  return new Promise(resolve => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalInput.value = defaultValue;
    modalInput.classList.toggle('hidden', !showInput);
    modalOk.textContent = okText;
    modalOverlay.classList.remove('hidden');
    if (showInput) setTimeout(() => modalInput.focus(), 0);

    const cleanup = () => {
      modalOverlay.classList.add('hidden');
      modalOk.removeEventListener('click', onOk);
      modalCancel.removeEventListener('click', onCancel);
      modalInput.removeEventListener('keydown', onKey);
    };
    const onOk = () => { const v = modalInput.value.trim(); cleanup(); resolve(showInput ? (v || null) : true); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      if (e.key === 'Enter') onOk();
      else if (e.key === 'Escape') onCancel();
    };

    modalOk.addEventListener('click', onOk);
    modalCancel.addEventListener('click', onCancel);
    modalInput.addEventListener('keydown', onKey);
  });
}

/** @type {{id: string, name: string}[]} */
let accounts = [];
let activeId = null;
const webviewMap = new Map(); // id -> <webview>

async function loadState() {
  const data = await window.api.loadAccounts();
  accounts = Array.isArray(data.accounts) ? data.accounts : [];
  activeId = data.activeId || null;
}

function saveState() {
  // Fire-and-forget; main process writes synchronously.
  window.api.saveAccounts({ accounts, activeId });
}

function uid() {
  return 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function renderSidebar() {
  accountListEl.innerHTML = '';
  for (const acc of accounts) {
    const el = document.createElement('div');
    el.className = 'account-item' + (acc.id === activeId ? ' active' : '');
    el.dataset.id = acc.id;

    const avatar = document.createElement('div');
    avatar.className = 'account-avatar';
    if (acc.avatar) {
      avatar.classList.add('has-image');
      avatar.style.backgroundImage = `url("${acc.avatar}")`;
    } else {
      avatar.textContent = acc.name.charAt(0).toUpperCase();
    }

    const name = document.createElement('div');
    name.className = 'account-name';
    name.textContent = acc.name;

    const badge = document.createElement('div');
    badge.className = 'unread-badge';
    badge.dataset.id = acc.id;
    const unread = unreadMap.get(acc.id) || 0;
    if (unread > 0) {
      badge.classList.add('visible');
      badge.textContent = unread > 99 ? '99+' : String(unread);
    }

    const mute = document.createElement('div');
    mute.className = 'mute-indicator' + (acc.muted ? ' visible' : '');
    mute.textContent = '\u{1F507}'; // speaker-with-cancellation-stroke
    mute.title = 'Muted';

    el.appendChild(avatar);
    el.appendChild(name);
    el.appendChild(badge);
    el.appendChild(mute);
    el.addEventListener('click', () => setActive(acc.id));
    accountListEl.appendChild(el);
  }
  refreshMuteButtonLabel();
}

function refreshMuteButtonLabel() {
  const acc = accounts.find(a => a.id === activeId);
  muteBtn.textContent = acc && acc.muted ? 'Unmute Notifications' : 'Mute Notifications';
}

function updateBadge(accId) {
  const badge = accountListEl.querySelector(`.unread-badge[data-id="${accId}"]`);
  if (!badge) return;
  const n = unreadMap.get(accId) || 0;
  if (n > 0) {
    badge.classList.add('visible');
    badge.textContent = n > 99 ? '99+' : String(n);
  } else {
    badge.classList.remove('visible');
  }
}

function attachUnreadTracking(wv, accId) {
  wv.addEventListener('page-title-updated', (e) => {
    const m = (e.title || '').match(/^\((\d+)\)/);
    const count = m ? parseInt(m[1], 10) : 0;
    const prev = baselineMap.get(accId);
    const base = prev === undefined ? count : Math.min(prev, count);
    baselineMap.set(accId, base);
    unreadMap.set(accId, Math.max(0, count - base));
    updateBadge(accId);
  });
}

// Pretend to be regular desktop Chrome so WhatsApp Web doesn't show the
// "update your browser" wall. Must be set BEFORE the webview loads.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function ensureWebview(acc) {
  if (webviewMap.has(acc.id)) return webviewMap.get(acc.id);

  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:${acc.id}`);
  wv.setAttribute('useragent', CHROME_UA);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', 'https://web.whatsapp.com/');
  wv.dataset.id = acc.id;
  webviewContainer.appendChild(wv);
  webviewMap.set(acc.id, wv);
  attachUnreadTracking(wv, acc.id);

  // Inject a small script that blocks ONLY notification-style audio while
  // leaving voice notes and videos intact. Rule: if the mute flag is on
  // AND there's no active user gesture, suppress the play() call.
  // (Voice-note / video playback happens via a user click, so userActivation
  //  is "active"; notifications fire from websocket handlers with no gesture.)
  wv.addEventListener('dom-ready', () => {
    const initialMute = !!acc.muted;
    wv.executeJavaScript(`
      (function() {
        if (window.__notifMutePatched) {
          window.__muteNotif = ${initialMute};
          return;
        }
        window.__notifMutePatched = true;
        window.__muteNotif = ${initialMute};

        function isUserActive() {
          try { return !!(navigator.userActivation && navigator.userActivation.isActive); }
          catch (e) { return false; }
        }

        // HTMLAudioElement path (most WhatsApp notification tones)
        const origAudioPlay = HTMLAudioElement.prototype.play;
        HTMLAudioElement.prototype.play = function() {
          if (window.__muteNotif && !isUserActive()) {
            return Promise.resolve();
          }
          return origAudioPlay.apply(this, arguments);
        };

        // AudioBufferSourceNode path (fallback for WebAudio-based tones)
        if (window.AudioBufferSourceNode) {
          const origStart = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function() {
            if (window.__muteNotif && !isUserActive()) return;
            return origStart.apply(this, arguments);
          };
        }
      })();
    `).catch(() => {});

    // Make sure whole-webview mute is OFF (we removed that behavior).
    try { wv.setAudioMuted(false); } catch {}
  });
  return wv;
}

function pushMuteToWebview(acc) {
  const wv = webviewMap.get(acc.id);
  if (!wv) return;
  wv.executeJavaScript(`window.__muteNotif = ${!!acc.muted};`).catch(() => {});
}

function toggleActiveMute() {
  const acc = accounts.find(a => a.id === activeId);
  if (!acc) return;
  acc.muted = !acc.muted;
  pushMuteToWebview(acc);
  saveState();
  renderSidebar();
}

// ---- Avatar upload ----

function pickAndSetAvatar(acc) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/jpg,image/webp,image/gif';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale to 128x128 with cover-fit, then re-encode as JPEG.
        const SIZE = 128;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        acc.avatar = canvas.toDataURL('image/jpeg', 0.85);
        saveState();
        renderSidebar();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function changeActivePhoto() {
  const acc = accounts.find(a => a.id === activeId);
  if (!acc) return;
  pickAndSetAvatar(acc);
}

function setActive(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  activeId = id;
  saveState();

  // Make sure the webview exists
  ensureWebview(acc);

  // Toggle visibility
  for (const [wid, wv] of webviewMap) {
    wv.classList.toggle('active', wid === id);
  }

  emptyState.classList.add('hidden');
  renderSidebar();
}

async function addAccount() {
  const name = await showModal({
    title: 'New Account',
    message: 'Give this WhatsApp session a label (e.g. PERSONAL, WORK, LPPSA).',
    defaultValue: '',
    okText: 'Create',
  });
  if (!name) return;
  const acc = { id: uid(), name };
  accounts.push(acc);
  saveState();
  renderSidebar();
  setActive(acc.id);
}

async function renameActive() {
  const acc = accounts.find(a => a.id === activeId);
  if (!acc) return;
  const name = await showModal({
    title: 'Rename Account',
    defaultValue: acc.name,
    okText: 'Save',
  });
  if (!name) return;
  acc.name = name;
  saveState();
  renderSidebar();
}

async function removeActive() {
  const acc = accounts.find(a => a.id === activeId);
  if (!acc) return;
  const ok = await showModal({
    title: 'Remove Account',
    message: `Remove "${acc.name}"? This logs the session out and deletes its local data.`,
    showInput: false,
    okText: 'Remove',
  });
  if (!ok) return;

  // Remove webview
  const wv = webviewMap.get(acc.id);
  if (wv) {
    wv.remove();
    webviewMap.delete(acc.id);
  }

  // Clear persisted partition data
  // (Electron auto-cleans on next launch if no webview uses it; we just drop the reference here.)

  accounts = accounts.filter(a => a.id !== acc.id);
  activeId = accounts[0]?.id || null;
  saveState();
  renderSidebar();

  if (activeId) {
    setActive(activeId);
  } else {
    emptyState.classList.remove('hidden');
  }
}

async function importExisting() {
  const allPartitions = await window.api.listPartitions();
  const existingIds = new Set(accounts.map(a => a.id));
  const orphans = allPartitions.filter(id => !existingIds.has(id));
  if (orphans.length === 0) {
    await showModal({ title: 'Nothing to import', message: 'No orphaned WhatsApp sessions were found on disk.', showInput: false, okText: 'OK' });
    return;
  }
  for (const id of orphans) {
    const name = await showModal({
      title: 'Import session',
      message: `Found existing session "${id}". Give it a label, or cancel to skip.`,
      defaultValue: 'PERSONAL',
      okText: 'Import',
    });
    if (!name) continue;
    accounts.push({ id, name });
  }
  saveState();
  renderSidebar();
  if (accounts[0]) setActive(accounts[0].id);
}

addBtn.addEventListener('click', addAccount);
importBtn.addEventListener('click', importExisting);
renameBtn.addEventListener('click', renameActive);
photoBtn.addEventListener('click', changeActivePhoto);
muteBtn.addEventListener('click', toggleActiveMute);
removeBtn.addEventListener('click', removeActive);

// Bootstrap
(async () => {
  await loadState();

  // First-run convenience: if accounts.json is empty but partitions exist
  // on disk (e.g. migrated from a previous build), auto-import them with
  // generic labels so the user isn't stuck with a blank app.
  if (accounts.length === 0) {
    const orphans = await window.api.listPartitions();
    if (orphans.length > 0) {
      orphans.forEach((id, i) => {
        accounts.push({ id, name: i === 0 ? 'PERSONAL' : `ACCOUNT ${i + 1}` });
      });
      activeId = accounts[0].id;
      saveState();
    }
  }

  renderSidebar();

  if (accounts.length > 0) {
    for (const acc of accounts) ensureWebview(acc);
    if (activeId && accounts.find(a => a.id === activeId)) setActive(activeId);
    else setActive(accounts[0].id);
  } else {
    emptyState.classList.remove('hidden');
  }
})();
