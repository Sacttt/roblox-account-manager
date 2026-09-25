const { app, BrowserWindow, ipcMain, shell, Menu, session, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const multiRoblox = require('./multiroblox');
const updater = require('./updater');

protocol.registerSchemesAsPrivileged([
  { scheme: 'ramavatar', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const DATA_DIR = app.getPath('userData');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const CACHE_DIR = path.join(DATA_DIR, 'avatar-cache');
const ICON_PATH = path.join(__dirname, 'src', 'icon.ico');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---------- simple JSON persistence ----------
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// Accounts are loaded after app 'ready' (safeStorage needs it) — see loadAccounts().
let accounts = [];
let settings = {
  theme: 'dark',
  animations: true,
  avatarRefreshMinutes: 30,
  notifications: true,
  multiRoblox: true,        // hold Roblox's singleton mutex so several clients can run
  launcher: 'auto',         // 'auto' | 'default' | 'bloxstrap' | 'fishstrap' | 'client'
  launchDelaySec: 6,        // wait between accounts in "Launch Together"
  ...readJSON(SETTINGS_FILE, {})
};
delete settings.launchBehavior; // old setting that no longer did anything
let presets = readJSON(PRESETS_FILE, [
  { id: 'p_brookhaven', name: 'Brookhaven RP', target: '189707' },
  { id: 'p_bloxfruits', name: 'Blox Fruits', target: '2753915549' },
  { id: 'p_ps99', name: 'Pet Simulator 99', target: '8737899170' },
  { id: 'p_dahood', name: 'Da Hood', target: '2788229376' }
]);

// Session cookies are encrypted at rest with Windows DPAPI (via Electron
// safeStorage). Older files with plaintext cookies are upgraded on next save.
function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}
function loadAccounts() {
  const raw = readJSON(ACCOUNTS_FILE, []);
  return (Array.isArray(raw) ? raw : []).map((a) => {
    const acc = { ...a };
    if (acc.roblosecurityEnc) {
      try {
        acc.roblosecurity = safeStorage.decryptString(Buffer.from(acc.roblosecurityEnc, 'base64'));
      } catch (_) {
        acc.roblosecurity = null; // encrypted on another Windows user/PC
      }
    }
    delete acc.roblosecurityEnc;
    return acc;
  });
}
function saveAccounts() {
  const encrypt = canEncrypt();
  const out = accounts.map((a) => {
    const acc = { ...a };
    if (acc.roblosecurity && encrypt) {
      acc.roblosecurityEnc = safeStorage.encryptString(acc.roblosecurity).toString('base64');
      delete acc.roblosecurity;
    }
    return acc;
  });
  writeJSON(ACCOUNTS_FILE, out);
}
// What the UI gets: never the raw cookie, just whether one is saved.
function publicAccount(a) {
  if (!a) return a;
  const { roblosecurity, roblosecurityEnc, ...rest } = a;
  return { ...rest, roblosecurity: roblosecurity ? true : null, hasCookie: !!roblosecurity };
}
function saveSettings() { writeJSON(SETTINGS_FILE, settings); }
function savePresets() { writeJSON(PRESETS_FILE, presets); }

function parseGameTarget(target) {
  const clean = String(target || '').trim();
  if (!clean) return null;

  let placeId = null;
  let linkCode = null;

  const vip = clean.match(/privateServerLinkCode=([A-Za-z0-9_-]+)/i);
  if (vip) linkCode = vip[1];

  const games = clean.match(/roblox\.com\/(?:games|experiences)\/(\d+)/i);
  if (games) placeId = games[1];

  if (/^\d+$/.test(clean)) placeId = clean;

  if (!placeId) {
    const loose = clean.match(/\b(\d{6,})\b/);
    if (loose) placeId = loose[1];
  }

  // Optional specific server (Job ID): "...?gameInstanceId=<guid>" or "<placeId> <guid>"
  let jobId = null;
  const job = clean.match(/(?:gameInstanceId|gameId|jobId)=([0-9a-f-]{36})/i)
    || clean.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (job) jobId = job[1];

  if (!placeId && !linkCode) return null;
  return { placeId, linkCode, jobId };
}

function localAvatarUrl(userId) {
  if (!userId) return null;
  const file = path.join(CACHE_DIR, `${userId}.png`);
  try {
    const st = fs.statSync(file);
    // ?v=<mtime> busts the renderer's image cache when the file is replaced
    // (e.g. the player changed their Roblox outfit), so the new image shows.
    if (st.size > 80) return `ramavatar://${userId}?v=${Math.floor(st.mtimeMs)}`;
  } catch (_) {}
  return null;
}

// Remembers the last thumbnail URL we downloaded per user, so a background
// sync can tell when the public avatar actually changed and skip re-downloads.
const AVATAR_META_FILE = path.join(DATA_DIR, 'avatar-meta.json');
let avatarMeta = readJSON(AVATAR_META_FILE, {});
function saveAvatarMeta() { try { writeJSON(AVATAR_META_FILE, avatarMeta); } catch (_) {} }

// Square, non-circular headshot from Roblox's official thumbnail service.
async function fetchThumbnailUrl(userId) {
  const thumb = await httpsJSON({
    hostname: 'thumbnails.roblox.com',
    path: `/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
    method: 'GET'
  });
  return (thumb.data && thumb.data[0] && thumb.data[0].imageUrl) || null;
}

// Fetch the current public thumbnail; download only if missing, forced, or the
// image changed. Returns { changed, url }. On any failure the cached file (if
// any) is left untouched so the card keeps showing it.
async function syncAvatar(userId, { force = false } = {}) {
  let remote = null;
  try { remote = await fetchThumbnailUrl(userId); } catch (_) {}
  const haveFile = fs.existsSync(path.join(CACHE_DIR, `${userId}.png`));
  const changedRemote = remote && remote !== avatarMeta[userId];
  if (remote && (force || !haveFile || changedRemote)) {
    try {
      const buf = await httpsGetBuffer(remote);
      if (buf && buf.length > 80) {
        fs.writeFileSync(path.join(CACHE_DIR, `${userId}.png`), buf);
        avatarMeta[userId] = remote;
        saveAvatarMeta();
        return { changed: true, url: localAvatarUrl(userId) };
      }
    } catch (_) {}
  }
  return { changed: false, url: localAvatarUrl(userId) };
}

function httpsGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('REDIRECT'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return httpsGetBuffer(next, redirects + 1).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(Buffer.concat(chunks));
        else reject(new Error(`HTTP_${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

async function cacheAvatarOnce(userId, remoteUrl) {
  const existing = localAvatarUrl(userId);
  if (existing) return existing;
  if (!remoteUrl) return null;
  try {
    const buf = await httpsGetBuffer(remoteUrl);
    if (buf && buf.length > 80) {
      fs.writeFileSync(path.join(CACHE_DIR, `${userId}.png`), buf);
      return `ramavatar://${userId}`;
    }
  } catch (_) {}
  return null;
}

function httpsRaw(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const reqHeaders = { ...(options.headers || {}) };
    if (payload) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({ ...options, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', () => reject(new Error('NETWORK_ERROR')));
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getAuthTicket(roblosecurity) {
  const cookie = String(roblosecurity || '').trim();
  if (!cookie) throw new Error('NO_COOKIE');

  const baseHeaders = {
    'User-Agent': 'Roblox/WinInet',
    'Referer': 'https://www.roblox.com/develop',
    'RBX-For-Gameauth': 'true',
    'Content-Type': 'application/json',
    'Cookie': `.ROBLOSECURITY=${cookie}`
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (headers) => httpsRaw({
    hostname: 'auth.roblox.com',
    path: '/v1/authentication-ticket/',
    method: 'POST',
    headers
  }, {});

  // Step 1: Roblox answers the first POST with 403 + a CSRF token.
  let csrf = null;
  for (let attempt = 0; attempt < 4 && !csrf; attempt++) {
    const first = await post(baseHeaders);
    csrf = first.headers['x-csrf-token'] || null;
    if (csrf) break;
    if (first.status === 429) { await sleep(1000 * 2 ** attempt); continue; }
    if (first.status === 401 || first.status === 403) throw new Error('COOKIE_INVALID');
    throw new Error('AUTH_TICKET_FAILED');
  }
  if (!csrf) throw new Error('RATE_LIMITED');

  // Step 2: same POST with the token returns a one-time launch ticket.
  for (let attempt = 0; attempt < 4; attempt++) {
    const second = await post({ ...baseHeaders, 'X-CSRF-TOKEN': csrf });
    if (second.status === 429) { await sleep(1000 * 2 ** attempt); continue; }
    if (second.status === 401 || second.status === 403) throw new Error('COOKIE_INVALID');
    const ticket = second.headers['rbx-authentication-ticket'];
    if (second.status !== 200 || !ticket) throw new Error('AUTH_TICKET_FAILED');
    return ticket;
  }
  throw new Error('RATE_LIMITED');
}

// Same URI roblox.com's Play button hands to the Roblox app, built the way
// evanovar/RobloxAccountManager does it (known-good format). The ticket inside
// is what makes the client sign in as THIS account instead of whoever is
// logged into the Roblox app.
function buildRobloxPlayerUri(ticket, { placeId, linkCode, jobId }) {
  const tracker = String(1000000000000000 + Math.floor(Math.random() * 8000000000000000));
  const launchTime = String(Date.now());
  let launcher = 'https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGameJob' +
    `&browserTrackerId=${tracker}&placeId=${placeId}&isPlayTogetherGame=false`;
  if (linkCode) launcher += `&linkCode=${linkCode}`;
  else if (jobId) launcher += `&gameId=${jobId}`;

  return (
    'roblox-player:1+launchmode:play' +
    `+gameinfo:${ticket}` +
    `+launchtime:${launchTime}` +
    `+placelauncherurl:${launcher}` +
    `+browsertrackerid:${tracker}` +
    '+robloxLocale:en_us+gameLocale:en_us'
  );
}

// ---------- which program opens the Roblox URI ----------
function localAppData(...parts) {
  return path.join(process.env.LOCALAPPDATA || '', ...parts);
}
function findRobloxClientExe() {
  const dirs = [localAppData('Roblox', 'Versions'), path.join(process.env['ProgramFiles(x86)'] || '', 'Roblox', 'Versions')];
  let best = null;
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith('version-')) continue;
        const exe = path.join(dir, name, 'RobloxPlayerBeta.exe');
        if (!fs.existsSync(exe)) continue;
        const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
        if (!best || mtime > best.mtime) best = { exe, mtime };
      }
    } catch (_) {}
  }
  return best ? best.exe : null;
}
function detectLaunchers() {
  const found = { default: true };
  for (const [key, exe] of [['bloxstrap', 'Bloxstrap'], ['fishstrap', 'Fishstrap']]) {
    const p = localAppData(exe, `${exe}.exe`);
    if (fs.existsSync(p)) found[key] = p;
  }
  const client = findRobloxClientExe();
  if (client) found.client = client;
  return found;
}
function runDetached(exe, args) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    } catch (e) { reject(e); }
  });
}
async function openRobloxUri(uri) {
  const launchers = detectLaunchers();
  let choice = settings.launcher || 'auto';
  if (choice === 'auto') choice = launchers.bloxstrap ? 'bloxstrap' : launchers.fishstrap ? 'fishstrap' : 'default';
  if (choice !== 'default' && !launchers[choice]) throw new Error(`LAUNCHER_NOT_FOUND:${choice}`);

  if (choice === 'bloxstrap' || choice === 'fishstrap') return runDetached(launchers[choice], ['-player', uri]);
  if (choice === 'client') return runDetached(launchers.client, [uri]);
  // Windows protocol handler (the official Roblox launcher). No cmd.exe, so
  // the "&" characters in the URI can't be misread as shell commands.
  return shell.openExternal(uri);
}

// ---------- tiny https JSON helper (with proper User-Agent & Content-Length) ----------
function httpsJSON(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      ...(options.headers || {})
    };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({ ...options, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Bad response from Roblox')); }
        } else if (res.statusCode === 429) {
          reject(new Error('RATE_LIMITED'));
        } else {
          reject(new Error(`Roblox request failed (${res.statusCode})`));
        }
      });
    });
    req.on('error', () => reject(new Error('NETWORK_ERROR')));
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function resolveUsername(username) {
  const result = await httpsJSON({
    hostname: 'users.roblox.com',
    path: '/v1/usernames/users',
    method: 'POST'
  }, { usernames: [username], excludeBannedUsers: false });

  if (!result.data || result.data.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }
  return result.data[0]; // { id, name, displayName }
}

async function getUserPresence(userId) {
  try {
    const res = await httpsJSON({
      hostname: 'presence.roblox.com',
      path: '/v1/presence/users',
      method: 'POST'
    }, { userIds: [Number(userId)] });

    if (res.userPresences && res.userPresences[0]) {
      const p = res.userPresences[0];
      // userPresenceType: 0 = Offline, 1 = Online (Website), 2 = InGame, 3 = Studio
      const types = ['Offline', 'Online', 'In Game', 'In Studio'];
      return {
        presenceType: p.userPresenceType ?? 0,
        presenceText: types[p.userPresenceType] || 'Offline',
        lastLocation: p.lastLocation || '',
        placeId: p.placeId || null
      };
    }
  } catch (e) {
    // presence non-blocking fallback
  }
  return { presenceType: 0, presenceText: 'Offline', lastLocation: '', placeId: null };
}

async function getUserProfile(userId) {
  const info = await httpsJSON({
    hostname: 'users.roblox.com',
    path: `/v1/users/${userId}`,
    method: 'GET'
  });

  let avatarUrl = localAvatarUrl(userId);
  if (!avatarUrl) {
    try {
      const thumb = await httpsJSON({
        hostname: 'thumbnails.roblox.com',
        path: `/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
        method: 'GET'
      });
      const remote = (thumb.data && thumb.data[0] && thumb.data[0].imageUrl) || null;
      avatarUrl = await cacheAvatarOnce(userId, remote);
    } catch (e) {
      // keep static fallback in the UI
    }
  }

  const presence = await getUserPresence(userId);

  return {
    userId,
    username: info.name,
    displayName: info.displayName,
    description: info.description || '',
    created: info.created,
    isBanned: !!info.isBanned,
    avatarUrl,
    presence
  };
}

// ---------- cookie authentication ----------
function validateCookie(roblosecurity) {
  const clean = roblosecurity.trim().replace(/^_\|WARNING[^|]*\|_/i, '').trim();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'users.roblox.com',
      path: '/v1/users/authenticated',
      method: 'GET',
      headers: {
        'Cookie': `.ROBLOSECURITY=${clean}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve({ ok: true, userId: parsed.id, username: parsed.name, displayName: parsed.displayName, cookie: clean });
          } catch { reject(new Error('BAD_RESPONSE')); }
        } else if (res.statusCode === 401) {
          reject(new Error('INVALID_COOKIE'));
        } else if (res.statusCode === 429) {
          reject(new Error('RATE_LIMITED'));
        } else {
          reject(new Error('NETWORK_ERROR'));
        }
      });
    });
    req.on('error', () => reject(new Error('NETWORK_ERROR')));
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.end();
  });
}

// ---------- window ----------

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#090a0f',
    title: 'Roblox Account Manager',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  }, 2500);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  accounts = loadAccounts();
  if (accounts.some((a) => a.roblosecurity) && canEncrypt()) saveAccounts(); // upgrade plaintext cookies

  // Grab Roblox's singleton lock early, while no client is open yet.
  if (settings.multiRoblox && process.platform === 'win32') {
    multiRoblox.ensureActive(DATA_DIR).catch(() => { /* retried on first launch */ });
  }

  protocol.registerFileProtocol('ramavatar', (request, callback) => {
    try {
      const raw = request.url.replace(/^ramavatar:\/\//i, '').split('?')[0].replace(/\/$/, '');
      const id = decodeURIComponent(raw);
      const file = path.join(CACHE_DIR, `${id}.png`);
      if (fs.existsSync(file)) callback({ path: file });
      else callback({ error: -6 });
    } catch (_) {
      callback({ error: -2 });
    }
  });
  createWindow();

  // Start the auto-updater once the window exists so it can show notifications.
  try { updater.init(mainWindow); } catch (e) { console.error('Updater init failed:', e); }

  // Cache missing headshots once (never keep the UI in a loading loop)
  setImmediate(async () => {
    let changed = false;
    for (const acc of accounts) {
      if (!acc.userId || localAvatarUrl(acc.userId)) continue;
      try {
        const thumb = await httpsJSON({
          hostname: 'thumbnails.roblox.com',
          path: `/v1/users/avatar-headshot?userIds=${acc.userId}&size=150x150&format=Png&isCircular=false`,
          method: 'GET'
        });
        const remote = (thumb.data && thumb.data[0] && thumb.data[0].imageUrl) || null;
        const url = await cacheAvatarOnce(acc.userId, remote);
        if (url) {
          acc.avatarUrl = url;
          changed = true;
        }
      } catch (_) {}
    }
    if (changed) saveAccounts();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { multiRoblox.stop(); updater.dispose(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---------- IPC: Window Controls ----------
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});
ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// ---------- IPC: accounts ----------
ipcMain.handle('accounts:list', () => {
  for (const acc of accounts) {
    const cached = localAvatarUrl(acc.userId);
    if (cached) acc.avatarUrl = cached;
  }
  return accounts.map(publicAccount);
});

ipcMain.handle('accounts:add', async (_evt, { username, nickname, notes }) => {
  const clean = (username || '').trim();
  if (!clean) throw new Error('EMPTY_USERNAME');
  if (accounts.find(a => a.username.toLowerCase() === clean.toLowerCase())) {
    throw new Error('DUPLICATE');
  }
  let resolved;
  try {
    resolved = await resolveUsername(clean);
  } catch (e) {
    if (e.message === 'USER_NOT_FOUND') throw new Error('USER_NOT_FOUND');
    if (e.message === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    throw new Error('NETWORK_ERROR');
  }
  let profile;
  try {
    profile = await getUserProfile(resolved.id);
  } catch (e) {
    profile = {
      userId: resolved.id,
      username: resolved.name,
      displayName: resolved.displayName,
      avatarUrl: null,
      presence: { presenceType: 0, presenceText: 'Offline', lastLocation: '' }
    };
  }

  const account = {
    id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    nickname: nickname || '',
    notes: notes || '',
    favorite: false,
    pinned: false,
    status: profile.isBanned ? 'banned' : 'active',
    presence: profile.presence || { presenceType: 0, presenceText: 'Offline' },
    lastLaunched: null,
    addedAt: Date.now(),
    updatedAt: Date.now()
  };
  accounts.push(account);
  saveAccounts();
  return publicAccount(account);
});

ipcMain.handle('accounts:update', (_evt, { id, patch }) => {
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('NOT_FOUND');
  const safePatch = { ...(patch || {}) };
  delete safePatch.roblosecurity; delete safePatch.roblosecurityEnc; delete safePatch.hasCookie; delete safePatch.id;
  accounts[idx] = { ...accounts[idx], ...safePatch, updatedAt: Date.now() };
  saveAccounts();
  return publicAccount(accounts[idx]);
});

ipcMain.handle('accounts:remove', (_evt, id) => {
  accounts = accounts.filter(a => a.id !== id);
  saveAccounts();
  return true;
});

ipcMain.handle('accounts:refresh', async (_evt, id) => {
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('NOT_FOUND');
  try {
    const profile = await getUserProfile(accounts[idx].userId);
    accounts[idx] = {
      ...accounts[idx],
      username: profile.username || accounts[idx].username,
      displayName: profile.displayName || accounts[idx].displayName,
      avatarUrl: profile.avatarUrl || accounts[idx].avatarUrl,
      status: profile.isBanned ? 'banned' : 'active',
      presence: profile.presence || accounts[idx].presence || { presenceType: 0, presenceText: 'Offline' },
      updatedAt: Date.now()
    };
    saveAccounts();
    return publicAccount(accounts[idx]);
  } catch (e) {
    throw new Error(e.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'NETWORK_ERROR');
  }
});

ipcMain.handle('accounts:refreshAll', async () => {
  const results = [];
  for (const acc of accounts) {
    try {
      const profile = await getUserProfile(acc.userId);
      acc.username = profile.username || acc.username;
      acc.displayName = profile.displayName || acc.displayName;
      acc.avatarUrl = profile.avatarUrl || acc.avatarUrl;
      acc.status = profile.isBanned ? 'banned' : 'active';
      acc.presence = profile.presence || acc.presence || { presenceType: 0, presenceText: 'Offline' };
      acc.updatedAt = Date.now();
      results.push({ id: acc.id, ok: true });
    } catch (e) {
      results.push({ id: acc.id, ok: false, error: e.message });
    }
    // polite API cadence
    await new Promise(r => setTimeout(r, 200));
  }
  saveAccounts();
  return { accounts: accounts.map(publicAccount), results };
});

ipcMain.handle('accounts:openProfile', async (_evt, userId) => {
  if (!userId) return false;
  await shell.openExternal(`https://www.roblox.com/users/${userId}/profile`);
  return true;
});

// ---------- IPC: avatar thumbnails (public headshots) ----------
// Background/refresh sync of the public Roblox avatar. Downloads only when the
// image is missing or has changed; returns which cards to update. Never touches
// cookies or any other account data.
ipcMain.handle('avatars:sync', async (_evt, { ids, force } = {}) => {
  const targets = (Array.isArray(ids) && ids.length)
    ? accounts.filter(a => ids.includes(a.id))
    : accounts;
  const updates = [];
  let anyChanged = false;
  for (const acc of targets) {
    if (!acc.userId) continue;
    const r = await syncAvatar(acc.userId, { force: !!force });
    if (r.url && r.url !== acc.avatarUrl) { acc.avatarUrl = r.url; anyChanged = true; }
    // Always return the current or cached avatar URL, never null
    const finalUrl = acc.avatarUrl || (r.url ? r.url : localAvatarUrl(acc.userId)) || null;
    if (finalUrl && finalUrl !== acc.avatarUrl) { acc.avatarUrl = finalUrl; anyChanged = true; }
    updates.push({ id: acc.id, avatarUrl: acc.avatarUrl || null, changed: r.changed });
    await new Promise(res => setTimeout(res, 150)); // polite API cadence
  }
  if (anyChanged) saveAccounts();
  return updates;
});

/*
 * Why two accounts didn't open before: the old code opened
 * "roblox://experiences/start?placeId=..." — that has no login in it, so every
 * launch used whichever account was signed into the Roblox app, and Roblox's
 * single-instance lock closed the previous window. Now each launch carries a
 * one-time auth ticket for that specific account, and Multi Roblox holds the
 * single-instance lock so the windows can coexist.
 */
async function launchSingleAccount(accId, targetUrl) {
  const acc = accounts.find(a => a.id === accId);
  if (!acc) throw new Error('NOT_FOUND');

  const parsed = parseGameTarget(targetUrl);
  if (!parsed || !parsed.placeId) throw new Error('GAME_REQUIRED');
  if (!acc.roblosecurity) throw new Error('NO_COOKIE');

  if (settings.multiRoblox && process.platform === 'win32') {
    await multiRoblox.ensureActive(DATA_DIR); // throws ROBLOX_ALREADY_RUNNING if a client is open first
  }

  let ticket;
  try {
    ticket = await getAuthTicket(acc.roblosecurity);
  } catch (e) {
    if (e.message === 'COOKIE_INVALID') {
      acc.cookieExpired = true;
      saveAccounts();
    }
    throw e;
  }
  if (acc.cookieExpired) acc.cookieExpired = false;

  await openRobloxUri(buildRobloxPlayerUri(ticket, parsed));

  acc.lastLaunched = Date.now();
  saveAccounts();
  return { launchedAt: acc.lastLaunched, placeId: parsed.placeId, multiRoblox: multiRoblox.isActive() };
}

// After starting a client, wait until a new RobloxPlayerBeta.exe shows up so
// the next account doesn't race it (tickets + launcher can collide if too fast).
async function waitForNewClient(pidsBefore, timeoutMs) {
  const before = new Set(pidsBefore);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 700));
    const now = await multiRoblox.listRobloxPids();
    if (now.some((p) => !before.has(p))) return true;
  }
  return false;
}

ipcMain.handle('accounts:launch', async (_evt, payload) => {
  const accId = typeof payload === 'string' ? payload : (payload && payload.id ? payload.id : payload);
  const targetUrl = payload && typeof payload === 'object' ? payload.targetUrl : '';
  return await launchSingleAccount(accId, targetUrl);
});

ipcMain.handle('accounts:launchMany', async (_evt, { ids, targetUrl } = {}) => {
  if (!Array.isArray(ids) || ids.length === 0) return { launched: [] };
  const parsed = parseGameTarget(targetUrl);
  if (!parsed || !parsed.placeId) throw new Error('GAME_REQUIRED');
  if (ids.length > 1 && process.platform === 'win32') {
    if (!settings.multiRoblox) throw new Error('MULTI_ROBLOX_OFF');
    await multiRoblox.ensureActive(DATA_DIR); // fail once up front instead of per account
  }

  const delayMs = Math.max(2, Number(settings.launchDelaySec) || 6) * 1000;
  const results = [];
  for (let i = 0; i < ids.length; i++) {
    const accId = ids[i];
    const pidsBefore = await multiRoblox.listRobloxPids();
    try {
      const res = await launchSingleAccount(accId, targetUrl);
      results.push({ id: accId, ok: true, ...res });
      if (i < ids.length - 1) {
        await waitForNewClient(pidsBefore, 25000);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (e) {
      results.push({ id: accId, ok: false, error: e.message });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launch:progress', { done: i + 1, total: ids.length, id: accId, ok: results[i].ok, error: results[i].error });
    }
  }
  return { launched: results };
});

// ---------- IPC: Multi Roblox / client control ----------
ipcMain.handle('multi:status', async () => ({
  ...multiRoblox.status(),
  enabled: !!settings.multiRoblox,
  runningClients: (await multiRoblox.listRobloxPids()).length,
  launchers: Object.keys(detectLaunchers()),
  launcher: settings.launcher || 'auto'
}));
ipcMain.handle('multi:enable', async () => {
  settings.multiRoblox = true;
  saveSettings();
  return multiRoblox.ensureActive(DATA_DIR);
});
ipcMain.handle('multi:disable', () => {
  settings.multiRoblox = false;
  saveSettings();
  multiRoblox.stop();
  return multiRoblox.status();
});
ipcMain.handle('roblox:closeAll', async () => {
  const closed = await multiRoblox.closeAllRoblox();
  if (settings.multiRoblox) {
    try { await multiRoblox.ensureActive(DATA_DIR); } catch (_) {}
  }
  return { closed, ...multiRoblox.status() };
});

// Direct Web Login Modal with Auto Cookie Extraction
ipcMain.handle('accounts:startWebLogin', async () => {
  return new Promise((resolve) => {
    // In-memory partition: the login session is never written to disk, so no
    // stray copies of the cookie pile up in the app's Partitions folder.
    const tempPartition = `temp_login_${Date.now()}`;
    const ses = session.fromPartition(tempPartition);
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    ses.setUserAgent(chromeUA);

    const loginWin = new BrowserWindow({
      width: 980,
      height: 820,
      center: true,
      title: 'Roblox Sign In — Roblox Manager',
      autoHideMenuBar: true,
      backgroundColor: '#111216',
      icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    loginWin.setMenuBarVisibility(false);

    let completed = false;

    async function checkForCookie() {
      if (completed) return;
      try {
        const cookies = await ses.cookies.get({ domain: '.roblox.com', name: '.ROBLOSECURITY' });
        if (cookies && cookies.length > 0 && cookies[0].value) {
          const cookieVal = cookies[0].value;
          const validated = await validateCookie(cookieVal);
          completed = true;

          let existing = accounts.find(a => a.userId === validated.userId);
          if (existing) {
            existing.roblosecurity = validated.cookie;
            existing.updatedAt = Date.now();
            saveAccounts();
            if (!loginWin.isDestroyed()) loginWin.close();
            resolve({ success: true, account: publicAccount(existing), isNew: false });
            return;
          }

          let profile;
          try {
            profile = await getUserProfile(validated.userId);
          } catch (_) {
            profile = {
              userId: validated.userId,
              username: validated.username,
              displayName: validated.displayName,
              avatarUrl: null,
              presence: { presenceType: 0, presenceText: 'Offline' }
            };
          }

          const newAcc = {
            id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userId: profile.userId,
            username: profile.username,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            nickname: '',
            notes: '',
            favorite: false,
            pinned: false,
            status: profile.isBanned ? 'banned' : 'active',
            presence: profile.presence || { presenceType: 0, presenceText: 'Offline' },
            roblosecurity: validated.cookie,
            lastLaunched: null,
            addedAt: Date.now(),
            updatedAt: Date.now()
          };
          accounts.push(newAcc);
          saveAccounts();
          if (!loginWin.isDestroyed()) loginWin.close();
          resolve({ success: true, account: publicAccount(newAcc), isNew: true });
        }
      } catch (e) {
        // Still on login form
      }
    }

    loginWin.webContents.on('did-finish-load', () => {
      loginWin.webContents.insertCSS(`
        script, style, noscript, template { display: none !important; }
        [ng-cloak], .ng-hide, .ng-cloak { display: none !important; }
        header, #header, .rbx-header, #navigation-container, .navigation-container,
        footer, #footer-container, .alert-info, .cookie-banner-wrapper,
        .notification-stream-container { display: none !important; }
        html, body { overflow: auto !important; }
      `).catch(() => {});

      loginWin.webContents.executeJavaScript(`
        (function() {
          document.querySelectorAll('noscript, script, style, template').forEach((el) => {
            el.style && (el.style.display = 'none');
          });
          const junk = document.querySelectorAll('[ng-cloak], .ng-hide');
          junk.forEach((el) => { el.style.display = 'none'; });
          const target = document.querySelector(
            'form, .login-container, .login-base-container, #login-container, .login-form-container, #login-form, [data-testid="login-form"]'
          );
          if (target) {
            target.scrollIntoView({ behavior: 'instant', block: 'center' });
          } else {
            window.scrollTo(0, 0);
          }
        })();
      `).catch(() => {});
    });

    loginWin.webContents.on('did-navigate', checkForCookie);
    loginWin.webContents.on('did-navigate-in-page', checkForCookie);

    const intervalId = setInterval(checkForCookie, 1000);

    loginWin.on('closed', () => {
      clearInterval(intervalId);
      ses.clearStorageData().catch(() => {});
      if (!completed) {
        resolve({ canceled: true });
      }
    });

    loginWin.loadURL('https://www.roblox.com/login', { userAgent: chromeUA });
  });
});

// Game Presets IPC
ipcMain.handle('presets:list', () => presets);
ipcMain.handle('presets:save', (_evt, newPresets) => {
  if (Array.isArray(newPresets)) {
    presets = newPresets;
    savePresets();
  }
  return presets;
});


// Validate & add account using .ROBLOSECURITY cookie — auto-fetches profile
ipcMain.handle('accounts:addWithCookie', async (_evt, { cookie, nickname, notes }) => {
  if (!cookie || !cookie.trim()) throw new Error('EMPTY_COOKIE');
  let validated;
  try {
    validated = await validateCookie(cookie.trim());
  } catch (e) {
    throw new Error(e.message || 'INVALID_COOKIE');
  }

  if (accounts.find(a => a.userId === validated.userId)) {
    throw new Error('DUPLICATE');
  }

  let profile;
  try {
    profile = await getUserProfile(validated.userId);
  } catch (e) {
    profile = {
      userId: validated.userId,
      username: validated.username,
      displayName: validated.displayName,
      avatarUrl: null,
      presence: { presenceType: 0, presenceText: 'Offline', lastLocation: '' }
    };
  }

  const account = {
    id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    nickname: nickname || '',
    notes: notes || '',
    favorite: false,
    pinned: false,
    status: profile.isBanned ? 'banned' : 'active',
    presence: profile.presence || { presenceType: 0, presenceText: 'Offline' },
    roblosecurity: validated.cookie,  // stored locally
    lastLaunched: null,
    addedAt: Date.now(),
    updatedAt: Date.now()
  };
  accounts.push(account);
  saveAccounts();
  return publicAccount(account);
});

// Add/update cookie on existing account
ipcMain.handle('accounts:setCookie', async (_evt, { id, cookie }) => {
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('NOT_FOUND');
  if (!cookie || !cookie.trim()) {
    // Remove cookie
    accounts[idx].roblosecurity = null;
    saveAccounts();
    return { ok: true, removed: true };
  }
  let validated;
  try {
    validated = await validateCookie(cookie.trim());
  } catch (e) {
    throw new Error(e.message || 'INVALID_COOKIE');
  }
  if (validated.userId !== accounts[idx].userId) throw new Error('COOKIE_MISMATCH');
  accounts[idx].roblosecurity = validated.cookie;
  accounts[idx].updatedAt = Date.now();
  saveAccounts();
  return { ok: true };
});

// Validate cookie without saving (used by the add modal to show preview)
ipcMain.handle('accounts:validateCookie', async (_evt, cookie) => {
  if (!cookie || !cookie.trim()) throw new Error('EMPTY_COOKIE');
  return await validateCookie(cookie.trim());
});



// ---------- IPC: Backup export & import ----------
ipcMain.handle('accounts:export', () => {
  // Backups never include login cookies (they would be readable by anyone with the file).
  return JSON.stringify(accounts.map((a) => { const { roblosecurity, roblosecurityEnc, ...rest } = a; return rest; }), null, 2);
});

ipcMain.handle('accounts:import', (_evt, jsonString) => {
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) throw new Error('INVALID_DATA');
    let addedCount = 0;
    for (const item of parsed) {
      if (!item.userId || !item.username) continue;
      const exists = accounts.find(a => a.userId === item.userId || a.username.toLowerCase() === item.username.toLowerCase());
      if (!exists) {
        accounts.push({
          id: item.id || `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId: item.userId,
          username: item.username,
          displayName: item.displayName || item.username,
          avatarUrl: item.avatarUrl || null,
          nickname: item.nickname || '',
          notes: item.notes || '',
          favorite: !!item.favorite,
          pinned: !!item.pinned,
          status: item.status || 'active',
          presence: item.presence || { presenceType: 0, presenceText: 'Offline' },
          lastLaunched: item.lastLaunched || null,
          addedAt: item.addedAt || Date.now(),
          updatedAt: Date.now()
        });
        addedCount++;
      }
    }
    saveAccounts();
    return { success: true, addedCount, total: accounts.length };
  } catch (e) {
    throw new Error('INVALID_JSON');
  }
});

// ---------- IPC: settings ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:update', (_evt, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  return settings;
});

// ---------- IPC: cache management ----------
ipcMain.handle('cache:clear', () => {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (e) {}
      }
    }
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('cache:size', () => {
  let total = 0;
  try {
    if (fs.existsSync(CACHE_DIR)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        try { total += fs.statSync(path.join(CACHE_DIR, f)).size; } catch (e) {}
      }
    }
  } catch (e) {}
  return total;
});

ipcMain.handle('data:openFolder', () => {
  shell.openPath(DATA_DIR);
});
