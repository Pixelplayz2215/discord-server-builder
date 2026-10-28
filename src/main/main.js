const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeImage } = require('electron');
const { DiscordRest } = require('./discord');
const { PresenceConnection } = require('./gateway');
const store = require('./store');
const Appearance = require('../shared/appearance');
const { buildServer, cloneServer, fetchAllMembers, purgeMessages, setChannelLock } = require('./builder');

const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const TITLEBAR_HEIGHT = 40;
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

let win = null;
let settings = null; // appearance settings, loaded once the app is ready
const clients = new Map(); // botId -> DiscordRest
const presences = new Map(); // botId -> PresenceConnection

// A custom logo doubles as the window/taskbar icon when Electron can decode it (PNG/JPEG).
function windowIcon() {
  if (settings.logo) {
    const image = nativeImage.createFromDataURL(settings.logo);
    if (!image.isEmpty()) return image;
  }
  return path.join(ROOT, 'build', 'icon.png');
}

function titleBarOverlay() {
  const pal = Appearance.palette(settings);
  return { color: pal.bg, symbolColor: pal.text, height: Math.round(TITLEBAR_HEIGHT * settings.scale) };
}

function applyWindowAppearance() {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(Appearance.palette(settings).bg);
  win.setTitleBarOverlay(titleBarOverlay());
  win.webContents.setZoomFactor(settings.scale);
  win.setIcon(windowIcon());
}

function restFor(botId) {
  if (!clients.has(botId)) clients.set(botId, new DiscordRest(store.getToken(botId)));
  return clients.get(botId);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function presenceFor(botId) {
  if (!presences.has(botId)) {
    presences.set(
      botId,
      new PresenceConnection(store.getToken(botId), (state, detail) => send('presence:state', { botId, state, detail })),
    );
  }
  return presences.get(botId);
}

const cleanToken = (token) => String(token || '').trim().replace(/^Bot\s+/i, '').replace(/^"|"$/g, '');

// Application flags tell us whether the privileged intents are switched on in the Developer Portal.
const FLAGS = { PRESENCE: 1 << 12, PRESENCE_LIMITED: 1 << 13, MEMBERS: 1 << 14, MEMBERS_LIMITED: 1 << 15, CONTENT: 1 << 18, CONTENT_LIMITED: 1 << 19 };

async function describeBot(rest) {
  const user = await rest.request('GET', '/users/@me');
  if (!user.bot) throw new Error('That token belongs to a user account. Only bot tokens are supported.');
  const application = await rest.request('GET', '/oauth2/applications/@me').catch(() => null);
  const flags = application?.flags || 0;
  return {
    id: user.id,
    username: user.username,
    global_name: user.global_name || null,
    avatar: user.avatar,
    appId: application?.id || user.id,
    appName: application?.name || user.username,
    intents: {
      members: !!(flags & (FLAGS.MEMBERS | FLAGS.MEMBERS_LIMITED)),
      presence: !!(flags & (FLAGS.PRESENCE | FLAGS.PRESENCE_LIMITED)),
      content: !!(flags & (FLAGS.CONTENT | FLAGS.CONTENT_LIMITED)),
    },
    publicBot: application ? !!application.bot_public : null,
    checkedAt: Date.now(),
  };
}

const SAFE_HOSTS = ['discord.com', 'support.discord.com', 'discord.dev', 'pixelplayz.org'];
const isSafeUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SAFE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

const handlers = {
  'bots:list': () => store.listBots(),

  'bots:add': async (rawToken) => {
    const token = cleanToken(rawToken);
    if (token.split('.').length !== 3) throw new Error('That does not look like a bot token (it should have three parts separated by dots).');
    const info = await describeBot(new DiscordRest(token));
    const bot = store.upsertBot(info, token);
    clients.delete(bot.id);
    presences.get(bot.id)?.stop();
    presences.delete(bot.id);
    return bot;
  },

  'bots:refresh': async (botId) => store.updateBot(botId, await describeBot(restFor(botId))),

  'bots:update': (botId, patch) => {
    const allowed = {};
    if ('label' in patch) allowed.label = String(patch.label || '').slice(0, 40);
    if ('presence' in patch) allowed.presence = patch.presence;
    return store.updateBot(botId, allowed);
  },

  'bots:remove': (botId) => {
    presences.get(botId)?.stop();
    presences.delete(botId);
    clients.delete(botId);
    store.removeBot(botId);
  },

  'bots:reorder': (ids) => store.reorderBots(ids),

  'presence:set': (botId, presence) => {
    const bot = store.updateBot(botId, { presence });
    const conn = presenceFor(botId);
    if (presence.enabled) conn.start(presence);
    else conn.stop();
    return bot;
  },

  rest: (botId, method, apiPath, opts = {}) => {
    if (!METHODS.has(method) || typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.includes('..') || apiPath.includes('://')) {
      throw new Error('Blocked request.');
    }
    return restFor(botId).request(method, apiPath, opts);
  },

  'members:all': (botId, guildId, max) => fetchAllMembers(restFor(botId), guildId, max),

  'channel:purge': (botId, channelId, count, reason) => purgeMessages(restFor(botId), channelId, Math.min(Math.max(1, count | 0), 1000), reason),

  'channel:lock': (botId, guildId, channelId, locked, reason) => setChannelLock(restFor(botId), guildId, channelId, locked, reason),

  'builder:run': (botId, guildId, template, opts) =>
    buildServer(restFor(botId), guildId, template, opts, (event) => send('builder:event', { botId, guildId, ...event })),

  'builder:clone': (botId, guildId) => cloneServer(restFor(botId), guildId),

  'templates:list': () => store.listTemplates(),
  'templates:save': (template) => store.saveTemplate(template),
  'templates:delete': (id) => store.deleteTemplate(id),

  'templates:export': async (template) => {
    const safeName = (template.name || 'template').replace(/[^\w\- ]+/g, '').trim() || 'template';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export server template',
      defaultPath: `${safeName}.json`,
      filters: [{ name: 'Server template', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2));
    return filePath;
  },

  'templates:import': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import server template',
      filters: [{ name: 'Server template', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!Array.isArray(data.roles) || !Array.isArray(data.categories)) throw new Error('That file is not a server template.');
    return data;
  },

  'settings:set': (next) => {
    settings = Appearance.normalize(next);
    store.saveSettings(settings);
    applyWindowAppearance();
    return settings;
  },

  'settings:pickLogo': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a logo',
      filters: [{ name: 'Images', extensions: Object.keys(LOGO_TYPES) }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    const type = LOGO_TYPES[path.extname(filePaths[0]).slice(1).toLowerCase()];
    if (!type) throw new Error('Pick a PNG, JPG, GIF, WebP or SVG image.');
    const data = fs.readFileSync(filePaths[0]);
    if (data.length > MAX_LOGO_BYTES) throw new Error('That image is over 2 MB — pick a smaller one.');
    return `data:${type};base64,${data.toString('base64')}`;
  },

  'open:external': (url) => {
    if (!isSafeUrl(url)) throw new Error('Blocked link.');
    return shell.openExternal(url);
  },

  'app:info': () => ({ version: app.getVersion(), dataPath: app.getPath('userData') }),
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: { message: err.message || String(err), code: err.code ?? null, status: err.status ?? null } };
    }
  });
}

ipcMain.on('settings:initial', (event) => {
  event.returnValue = settings;
});

function createWindow() {
  settings = Appearance.normalize(store.getSettings());
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    backgroundColor: Appearance.palette(settings).bg,
    title: settings.appName,
    icon: windowIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      zoomFactor: settings.scale,
    },
  });

  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  // Bring bots that were online last session back online.
  for (const bot of store.listBots()) {
    if (bot.presence?.enabled) {
      try {
        presenceFor(bot.id).start(bot.presence);
      } catch {
        // token could not be decrypted on this machine; the UI will show it offline
      }
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => {
    for (const conn of presences.values()) conn.stop();
    app.quit();
  });
}
