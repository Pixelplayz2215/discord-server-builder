const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const { DiscordRest } = require('./discord');
const { PresenceConnection } = require('./gateway');
const store = require('./store');
const Appearance = require('../shared/appearance');
const { buildServer, cloneServer, fetchAllMembers, purgeMessages, setChannelLock, lockWithNotice } = require('./builder');
const updater = require('./updater');
const portal = require('./portal');
const commands = require('./commands');
const { createCases, caseFromCall, warnMember, privateChannel, publicChannel, avatarUrl, notifyUser, tellBanned, BAN_UNTOLD, unbanMessage, UNBAN_UNTOLD, PUBLIC_CHANNEL_NAME } = require('./cases');
const backups = require('./backup');
const { createServerLogger, intentsFor: logIntents, normalizeConfig: normalizeLogConfig } = require('./logs');
const social = require('./social');
const reactionRoles = require('./reactionroles');
const polls = require('./polls');
const welcome = require('./welcome');
const tickets = require('./tickets');
const stats = require('./stats');
const autoRoles = require('./autoroles');
const verifyLock = require('./verifylock');
const announce = require('./announce');
const giveaways = require('./giveaways');
const always = require('./always');
const WelcomeCard = require('../shared/welcomecard');
const pkg = require('../../package.json');

const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const TITLEBAR_HEIGHT = 40;
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

let win = null;
let tray = null;
let quitting = false; // set once the app is really quitting, so closing the window isn't turned into hiding it
let trayHintShown = false;
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
  updateTray();
}

// The window icon scaled for the tray, with sharper copies for high-DPI screens.
function trayIcon() {
  const source = windowIcon();
  const image = typeof source === 'string' ? nativeImage.createFromPath(source) : source;
  const icon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor);
    icon.addRepresentation({ scaleFactor, buffer: image.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return icon;
}

function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- New versions, noticed while the app runs ---------- */
let newVersion = null; // a newer version GitHub has, once noticed

// Opens the app and its "New version found" screen.
function showUpdate() {
  showWindow();
  send('update:open', {});
}

const releaseWatcher = updater.createReleaseWatcher({
  onNewVersion: (version) => {
    newVersion = version;
    send('update:available', { version });
    updateTray();
    // Hidden in the tray: a Windows notification, which opens the update screen when clicked.
    if (tray && (!win || win.isDestroyed() || !win.isVisible())) {
      tray.displayBalloon({ iconType: 'info', title: `${settings.appName} ${version} is available`, content: "Click to see what's new and update." });
    }
  },
});

const watchReleases = () => (settings.checkUpdates ? releaseWatcher.start() : releaseWatcher.stop());

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(newVersion ? `${settings.appName} (version ${newVersion} is available)` : settings.appName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${settings.appName}`, click: showWindow },
      ...(newVersion ? [{ label: `Update to ${newVersion}…`, click: showUpdate }] : []),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.on('click', showWindow);
  tray.on('balloon-click', () => (newVersion ? showUpdate() : showWindow()));
  updateTray();
}

function restFor(botId) {
  if (!clients.has(botId)) clients.set(botId, new DiscordRest(store.getToken(botId)));
  return clients.get(botId);
}

// Moderators who signed in with Discord go through their mod portal instead of using a bot token.
const isMod = (botId) => store.getBot(botId)?.type === 'mod';
const modCall = (botId, route, body) =>
  portal.call(store.getBot(botId).portalUrl, route, { method: 'POST', token: store.getToken(botId), body });
const ownerOnly = () => {
  throw new Error('Only the server owner can do that. Moderators can moderate members and channels.');
};

// Case log (#mod-cases) for owner bots. Moderators' cases are recorded by their mod portal.
const caseLogs = new Map(); // botId -> case log
const casesFor = (botId) => {
  if (!caseLogs.has(botId)) caseLogs.set(botId, createCases(restFor(botId), { botId: async () => botId }));
  return caseLogs.get(botId);
};
const snowflake = (value, what) => {
  if (!/^\d{15,21}$/.test(String(value))) throw new Error(`Invalid ${what}.`);
  return String(value);
};

/* ---------- Backups (kept in %APPDATA%\<app>\backups) ---------- */
const backupsRoot = () => path.join(app.getPath('userData'), 'backups');
const AUTO_BACKUP_MS = 24 * 3600 * 1000;
let autoBackupRunning = false;

// Takes a backup of every server with automatic backups on whose newest one is a day old. Runs while
// the app is open (including in the tray), shortly after start and then every half hour.
async function runAutoBackups() {
  if (autoBackupRunning) return;
  autoBackupRunning = true;
  try {
    for (const { botId, guildId, config } of store.listGuildConfigs()) {
      if (!config.autoBackup) continue;
      const bot = store.getBot(botId);
      if (!bot || bot.type === 'mod') continue;
      const latest = backups.listBackups(backupsRoot(), guildId).find((b) => b.auto);
      if (latest && Date.now() - Date.parse(latest.takenAt) < AUTO_BACKUP_MS - 10 * 60 * 1000) continue;
      try {
        backups.saveBackup(backupsRoot(), guildId, await backups.snapshotServer(restFor(botId), guildId, { auto: true }));
        for (const file of backups.staleAutoBackups(backupsRoot(), guildId)) fs.rmSync(file, { force: true });
        send('backups:changed', { guildId });
      } catch (err) {
        console.error(`Automatic backup of ${guildId} failed:`, err.message);
      }
    }
  } finally {
    autoBackupRunning = false;
  }
}

/* ---------- Social alerts (YouTube uploads, Twitch going live) ---------- */
// A Twitch Client ID built into this copy (package.json), or one the owner pasted in the app.
const twitchClientId = () => pkg.twitchClientId || store.getSocial().clientId || '';
let twitchClient = null; // { clientId, api }
let twitchLogin = null; // the "Log in with Twitch" in progress
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getTwitch() {
  const clientId = twitchClientId();
  if (!clientId || !store.getTwitchTokens()) return null;
  if (twitchClient?.clientId !== clientId) {
    twitchClient = {
      clientId,
      api: social.createTwitchClient({ clientId, getTokens: () => store.getTwitchTokens(), saveTokens: (tokens) => store.setTwitchTokens(tokens), fetchImpl: fetch }),
    };
  }
  return twitchClient.api;
}

function updateAlert(id, patch) {
  const { alerts } = store.getSocial();
  store.saveSocial({ alerts: alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

async function postAlert(alert, message) {
  const bot = store.getBot(alert.botId);
  if (!bot || bot.type === 'mod') throw new Error('That bot is no longer in the app.');
  await restFor(alert.botId).request('POST', `/channels/${alert.channelId}/messages`, { body: message });
}

// With 24/7 on, the portal checks a bot's YouTube alerts, and its GitHub ones once it's new enough
// to (the app waits until it has heard from the portal).
function appChecksAlert(a) {
  if (a.platform === 'twitch' || !alwaysOn(a.botId)) return true;
  if (a.platform === 'youtube') return false;
  const status = alwaysStatus.get(a.botId)?.status;
  return !!status && !status.features?.includes('github');
}

const socialWatcher = social.createSocialWatcher({
  getAlerts: () => store.getSocial().alerts.filter(appChecksAlert),
  updateState: (id, state) => updateAlert(id, { state }),
  post: postAlert,
  getTwitch,
  fetchImpl: fetch,
  youtubeKey: () => store.getYouTubeKey(),
});

function socialStatus() {
  const data = store.getSocial();
  const key = store.getYouTubeKey();
  return {
    alerts: data.alerts,
    defaults: social.DEFAULT_MESSAGES,
    twitch: { builtInClientId: !!pkg.twitchClientId, clientId: pkg.twitchClientId ? '' : data.clientId, account: data.account, loggedIn: !!store.getTwitchTokens() },
    // Only the end of the key is shown.
    youtube: { hasKey: !!key, keyHint: key ? key.slice(-4) : '' },
  };
}

// A twitch.tv link or a channel name.
const twitchLoginName = (input) => {
  const text = String(input || '').trim();
  const name = (text.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})/i)?.[1] || text).replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,25}$/.test(name)) throw new Error('Enter a Twitch channel name or link, like twitch.tv/name.');
  return name.toLowerCase();
};

async function guildAndRoles(rest, guildId) {
  const [guild, roles] = await Promise.all([rest.request('GET', `/guilds/${guildId}`), rest.request('GET', `/guilds/${guildId}/roles`)]);
  return { guild, roles };
}

// Bans, kicks, timeouts and unbans made in the app are recorded in #mod-cases with the bot as the
// moderator, and bans are posted publicly when that's on. An unbanned user is told in a DM with the
// reason, like /unban does. Runs in the background; a failure is reported to the UI without undoing
// the action.
function recordCall(botId, method, apiPath, { body, reason }) {
  const found = caseFromCall(method, apiPath, body);
  if (!found) return;
  (async () => {
    const rest = restFor(botId);
    const user = await rest.request('GET', `/users/${found.memberId}`).catch(() => null);
    const { guild, roles } = await guildAndRoles(rest, found.guildId);
    if (found.type === 'unban' && !user?.bot && !(await notifyUser(rest, found.memberId, unbanMessage(guild.name, typeof reason === 'string' ? reason.slice(0, 400) : '')))) send('cases:untold', { botId, message: UNBAN_UNTOLD });
    const done = await casesFor(botId).record(guild, roles, {
      type: found.type,
      member: { id: found.memberId, label: user ? user.global_name || user.username : found.memberId, avatar: user ? avatarUrl(user) : null },
      moderator: { id: botId },
      reason: typeof reason === 'string' ? reason.slice(0, 400) : '',
      duration: found.duration,
    });
    if (done.announceError) send('cases:announceError', { botId, message: done.announceError });
  })().catch((err) => send('cases:error', { botId, message: err.message }));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const connectionStates = new Map(); // botId -> { state, detail }

function presenceFor(botId) {
  if (!presences.has(botId)) {
    const onState = (state, detail) => {
      if (alwaysOn(botId)) return; // the portal keeps it online; its state comes from there
      connectionStates.set(botId, { state, detail });
      // Connected only for server logs or reaction roles: the bot stays invisible to members.
      const shown = state === 'online' && !store.getBot(botId)?.presence?.enabled ? 'invisible' : state;
      send('presence:state', { botId, state: shown, detail });
    };
    const onEvent = (type, data) => {
      loggerFor(botId).handle(type, data);
      reactionsFor(botId).handle(type, data)?.catch?.(() => {});
      pollsFor(botId).handle(type, data)?.catch?.(() => {});
      welcomerFor(botId).handle(type, data);
      autoRolesFor(botId).handle(type, data)?.catch?.(() => {});
      statsFor(botId).handle(type, data);
      // Ticket buttons come here only when the bot has no interactions endpoint (no mod portal).
      if (type === 'INTERACTION_CREATE') answerInteraction(botId, data).catch(() => {});
      // Reconnected: hand out roles for reactions made while the bot was away, and redraw polls.
      if (type === 'READY') {
        setTimeout(() => {
          catchUpPanels(botId);
          catchUpPolls(botId);
        }, 5000);
      }
    };
    presences.set(botId, new PresenceConnection(store.getToken(botId), onState, onEvent));
  }
  return presences.get(botId);
}

/* ---------- Reaction roles (handed out while the app runs, including in the tray) ---------- */
// Panels are kept per server in servers.json; this index finds one by its message.
let panelIndex = null; // messageId -> panel (with botId)
const reactionEngines = new Map(); // botId -> reaction roles engine
const panelProblems = new Map(); // panel id -> latest problem

function allPanels() {
  return store.listGuildConfigs().flatMap(({ botId, guildId, config }) => (config.reactionRoles || []).map((p) => ({ ...p, botId, guildId })));
}

function rebuildPanelIndex() {
  panelIndex = new Map(allPanels().filter((p) => p.messageId).map((p) => [p.messageId, p]));
}

const botPanels = (botId) => {
  if (!panelIndex) rebuildPanelIndex();
  return [...panelIndex.values()].filter((p) => p.botId === botId);
};

function reactionsFor(botId) {
  if (!reactionEngines.has(botId)) {
    reactionEngines.set(
      botId,
      reactionRoles.createReactionRoles({
        rest: restFor(botId),
        botId,
        panelFor: (messageId) => {
          if (!panelIndex) rebuildPanelIndex();
          const panel = panelIndex.get(messageId);
          return panel?.botId === botId ? panel : null;
        },
        report: (panel, problem) => {
          if (problem) panelProblems.set(panel.id, problem);
          else panelProblems.delete(panel.id);
        },
      }),
    );
  }
  return reactionEngines.get(botId);
}

let catchingUp = new Set();
async function catchUpPanels(botId) {
  if (catchingUp.has(botId)) return;
  catchingUp.add(botId);
  try {
    for (const panel of botPanels(botId)) await reactionsFor(botId).catchUp(panel);
  } finally {
    catchingUp.delete(botId);
  }
}

/* ---------- Polls (bars redrawn while the app runs, including in the tray) ---------- */
// Polls are kept per server in servers.json with their latest votes, both the ones posted from the
// app and the ones found from /poll. This index finds one by its message.
const MAX_POLLS = 50; // per server: past this the oldest go, ended ones first
let pollIndex = null; // messageId -> poll (with botId)
const pollEngines = new Map(); // botId -> polls engine
const pollProblems = new Map(); // poll id -> latest problem
const emojiColors = new Map(); // server emoji id -> bar colour

function allPolls() {
  return store.listGuildConfigs().flatMap(({ botId, guildId, config }) => (config.polls || []).map((p) => ({ ...p, botId, guildId })));
}

function rebuildPollIndex() {
  pollIndex = new Map(allPolls().filter((p) => p.messageId).map((p) => [p.messageId, p]));
}

const botPolls = (botId) => {
  if (!pollIndex) rebuildPollIndex();
  return [...pollIndex.values()].filter((p) => p.botId === botId);
};

// Changes one stored poll (or drops it when change returns null) and tells the Polls page.
function updatePoll(botId, guildId, id, change) {
  const list = store.getGuildConfig(botId, guildId).polls || [];
  store.setGuildConfig(botId, guildId, { polls: list.flatMap((p) => (p.id === id ? [change(p)].filter(Boolean) : [p])) });
  rebuildPollIndex();
  send('polls:changed');
}

function trimPolls(list) {
  const kept = [...list];
  while (kept.length > MAX_POLLS) {
    const byAge = [...kept].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    kept.splice(kept.indexOf(byAge.find((p) => p.ended) || byAge[0]), 1);
  }
  return kept;
}

// The bar colour matching an answer's emoji: standard emojis from a table, server emojis from their image.
async function emojiBarColor(emoji, index) {
  if (!emoji?.id) return polls.defaultColor(emoji, index);
  if (!emojiColors.has(emoji.id)) {
    try {
      const res = await fetch(`https://cdn.discordapp.com/emojis/${emoji.id}.png?size=32`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
      emojiColors.set(emoji.id, polls.dominantColor(image.toBitmap(), { bgra: true }));
    } catch {
      return polls.defaultColor(emoji, index); // try again next time
    }
  }
  return emojiColors.get(emoji.id) || polls.defaultColor(emoji, index);
}

// Someone posted a poll with /poll: keep it, so its bars fill in and it shows on the Polls page.
async function addFoundPoll(botId, found) {
  const rest = restFor(botId);
  const [channel, guild, options] = await Promise.all([
    rest.request('GET', `/channels/${found.channelId}`).catch(() => null),
    rest.request('GET', `/guilds/${found.guildId}`).catch(() => null),
    Promise.all(found.options.map(async (o, i) => ({ ...o, color: await emojiBarColor(o.emoji, i) }))),
  ]);
  const list = store.getGuildConfig(botId, found.guildId).polls || [];
  if (list.some((p) => p.messageId === found.messageId)) return; // posted from the app, or found already
  const poll = { ...found, options, id: crypto.randomUUID(), source: 'command', guildName: guild?.name || '', channelName: channel?.name || '', counts: options.map(() => 0) };
  store.setGuildConfig(botId, found.guildId, { polls: trimPolls([...list, poll]) });
  rebuildPollIndex();
  send('polls:changed');
}

function pollsFor(botId) {
  if (!pollEngines.has(botId)) {
    pollEngines.set(
      botId,
      polls.createPolls({
        rest: restFor(botId),
        botId,
        pollFor: (messageId) => {
          if (!pollIndex) rebuildPollIndex();
          const poll = pollIndex.get(messageId);
          return poll?.botId === botId ? poll : null;
        },
        discover: (found) => addFoundPoll(botId, found),
        saved: (poll, counts) => {
          const stored = pollIndex?.get(poll.messageId);
          if (stored && !!stored.ended === !!poll.ended && JSON.stringify(stored.counts) === JSON.stringify(counts)) return;
          updatePoll(botId, poll.guildId, poll.id, (p) => ({ ...p, counts, ended: !!poll.ended, endedAt: poll.ended ? p.endedAt || Date.now() : null }));
        },
        forget: (poll) => {
          pollProblems.delete(poll.id);
          updatePoll(botId, poll.guildId, poll.id, () => null);
        },
        report: (poll, problem) => {
          if (problem) pollProblems.set(poll.id, problem);
          else pollProblems.delete(poll.id);
        },
      }),
    );
  }
  return pollEngines.get(botId);
}

const pollsCatchingUp = new Set();
async function catchUpPolls(botId) {
  if (pollsCatchingUp.has(botId)) return;
  pollsCatchingUp.add(botId);
  try {
    await pollsFor(botId).catchUp(botPolls(botId));
  } finally {
    pollsCatchingUp.delete(botId);
  }
}

// Reactions are watched for reaction roles, open polls, and polls anyone may post with /poll.
const watchesReactions = (botId) => botPanels(botId).length > 0 || botPolls(botId).some((p) => !p.ended) || !!store.getBot(botId)?.slashCommands;

/* ---------- Welcome and goodbye cards (posted while the app runs, including in the tray) ---------- */
// Settings are kept per server in servers.json as greetings: { guildName, welcome, goodbye }.
// Cards are drawn in a hidden window with the same code as the app's preview.
const CARD_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_CARD_IMAGE_BYTES = 8 * 1024 * 1024;
const welcomers = new Map(); // botId -> welcomer
const greetingProblems = new Map(); // `${botId}:${guildId}:${kind}` -> latest problem
let cardWindow = null;
let cardWindowTimer = null;
let cardsDrawing = 0;

const cardsDir = () => path.join(app.getPath('userData'), 'cards');

function greetingsOf(botId, guildId) {
  const saved = store.getGuildConfig(botId, guildId).greetings;
  if (!saved) return null;
  return { guildName: saved.guildName || '', welcome: WelcomeCard.normalizeKind(saved.welcome, 'welcome'), goodbye: WelcomeCard.normalizeKind(saved.goodbye, 'goodbye') };
}

const greetingsOn = (botId) =>
  store.listGuildConfigs().some(({ botId: b, config }) => b === botId && (config.greetings?.welcome?.enabled || config.greetings?.goodbye?.enabled));

// A card background picked in the app, as a data URL (null when the file is gone).
function cardBackground(name) {
  const file = path.join(cardsDir(), path.basename(String(name || '')));
  const type = CARD_IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()];
  if (!type || !fs.existsSync(file)) return null;
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function imageDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `data:${res.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

// The hidden window closes after two quiet minutes, and with the app's window.
function closeCardWindow() {
  clearTimeout(cardWindowTimer);
  if (cardsDrawing) {
    cardWindowTimer = setTimeout(closeCardWindow, 30 * 1000);
    return;
  }
  if (cardWindow && !cardWindow.isDestroyed()) cardWindow.destroy();
  cardWindow = null;
}

// Draws a card for a member and resolves to its PNG bytes.
async function renderCardImage(card, vars, user) {
  if (!cardWindow || cardWindow.isDestroyed()) {
    cardWindow = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    cardWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    cardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    cardWindow.ready = cardWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'card.html'));
  }
  const page = cardWindow;
  cardsDrawing++;
  try {
    await page.ready;
    const [avatar, background] = await Promise.all([imageDataUrl(welcome.avatarUrl(user)).catch(() => null), card.background.type === 'image' ? cardBackground(card.background.image) : null]);
    const dataUrl = await page.webContents.executeJavaScript(`renderCard(${JSON.stringify(card)}, ${JSON.stringify(vars)}, ${JSON.stringify(avatar)}, ${JSON.stringify(background)})`);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    cardsDrawing--;
    clearTimeout(cardWindowTimer);
    cardWindowTimer = setTimeout(closeCardWindow, 2 * 60 * 1000);
  }
}

function welcomerFor(botId) {
  if (!welcomers.has(botId)) {
    welcomers.set(
      botId,
      welcome.createWelcomer({
        rest: restFor(botId),
        settingsFor: (guildId) => greetingsOf(botId, guildId),
        render: renderCardImage,
        report: (guildId, kind, problem) => {
          const key = `${botId}:${guildId}:${kind}`;
          if (problem) greetingProblems.set(key, problem);
          else greetingProblems.delete(key);
        },
      }),
    );
  }
  return welcomers.get(botId);
}

/* ---------- Tickets ---------- */
// Panels are kept per server in servers.json as ticketPanels. With slash commands on, the mod portal
// answers the buttons around the clock; without, this app does while it runs.
const ticketEngines = new Map(); // botId -> tickets engine (for answering without a portal)
const userNames = new Map(); // user id -> name, for ticket history

const ticketPanelsOf = (botId) => store.listGuildConfigs().flatMap(({ botId: b, guildId, config }) => (b === botId ? (config.ticketPanels || []).map((p) => ({ ...p, botId, guildId })) : []));
// The app answers ticket and Verify buttons only for bots whose interactions don't go to a portal.
const hasVerifyButton = (botId) => store.listGuildConfigs().some(({ botId: b, config }) => b === botId && config.autoroles?.verify?.enabled);
const answersTickets = (botId) => (ticketPanelsOf(botId).length > 0 || hasVerifyButton(botId)) && !store.getBot(botId)?.slashCommands;

function ticketsFor(botId) {
  if (!ticketEngines.has(botId)) ticketEngines.set(botId, tickets.createTickets({ rest: restFor(botId), botId }));
  return ticketEngines.get(botId);
}
const verifyFor = (botId) => autoRoles.createVerify({ rest: restFor(botId) });

async function answerInteraction(botId, i) {
  const handled = (await ticketsFor(botId).interaction(i)) || (await verifyFor(botId).interaction(i));
  if (!handled) return;
  await restFor(botId).request('POST', `/interactions/${i.id}/${i.token}/callback`, { body: handled.response });
  await handled.after?.();
}

async function userName(rest, id) {
  if (!userNames.has(id)) {
    const u = await rest.request('GET', `/users/${id}`).catch(() => null);
    userNames.set(id, u ? u.global_name || u.username : null);
  }
  return userNames.get(id);
}

// A closed ticket, read back from its log message.
function closedTicket(m) {
  const e = m.embeds?.[0];
  const field = (name) => e.fields?.find((f) => f.name === name)?.value || '';
  const who = (name) => field(name).match(/<@(\d{15,21})>/)?.[1] || null;
  return {
    messageId: m.id,
    channelId: e.footer.text.slice('Ticket '.length),
    channelName: (e.title || '').replace(/^🎫 Ticket closed · #/, ''),
    openedBy: who('Opened by'),
    claimedBy: who('Claimed by'),
    closedBy: who('Closed by'),
    reason: field('Reason') === 'No reason given' ? '' : field('Reason'),
    messages: Number(field('Messages')) || 0,
    closedAt: e.timestamp || m.timestamp,
    transcript: (m.attachments || []).some((a) => /\.html$/i.test(a.filename || '')),
    link: m.components?.[0]?.components?.find((c) => c.url)?.url || null,
  };
}

async function ticketTranscript(botId, logChannelId, messageId) {
  const message = await restFor(botId).request('GET', `/channels/${snowflake(logChannelId, 'channel')}/messages/${snowflake(messageId, 'message')}`);
  const file = (message.attachments || []).find((a) => /\.html$/i.test(a.filename || ''));
  if (!file) throw new Error('That log message has no transcript attached.');
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`Discord's file server returned HTTP ${res.status}.`);
  return { name: file.filename, html: await res.text() };
}

/* ---------- Auto roles (given while the app runs, including in the tray) ---------- */
// Settings are kept per server in servers.json as autoroles.
const autoRoleEngines = new Map(); // botId -> auto roles engine
const autoRoleProblems = new Map(); // `${botId}:${guildId}` -> latest problem

const autoRolesOn = (botId) => store.listGuildConfigs().some(({ botId: b, config }) => b === botId && config.autoroles?.enabled);

// What locking a server behind its Verify button would change, with the names the app shows.
// openChannelIds: channels @everyone keeps seeing besides the Verify one (like #rules). While the
// lock window is open the server is read once and reused, so ticking boxes answers at once; locking
// itself (fresh) reads it again.
const VERIFY_LOCK_READ_MS = 2 * 60 * 1000;
const verifyLockReads = new Map(); // `${botId}:${guildId}` -> { at, roles, channels, me }
async function verifyLockPlan(botId, guildId, { openChannelIds = [], hideVerify = false, fresh = false } = {}) {
  const v = store.getGuildConfig(botId, guildId).autoroles?.verify;
  if (!v?.enabled || !v.channelId || !v.roles?.length) throw new Error('Post a Verify button first: Edit → Post a Verify button, with the roles it gives.');
  const key = `${botId}:${guildId}`;
  let read = verifyLockReads.get(key);
  if (fresh || !read || Date.now() - read.at > VERIFY_LOCK_READ_MS) {
    const rest = restFor(botId);
    const [roles, channels, me] = await Promise.all([rest.request('GET', `/guilds/${guildId}/roles`), rest.request('GET', `/guilds/${guildId}/channels`), rest.request('GET', `/guilds/${guildId}/members/${botId}`)]);
    read = { at: Date.now(), roles, channels, me };
    verifyLockReads.set(key, read);
  }
  const { roles, channels, me } = read;
  const open = (Array.isArray(openChannelIds) ? openChannelIds : []).map(String).filter((id) => /^\d{15,21}$/.test(id) && id !== v.channelId);
  const auto = store.getGuildConfig(botId, guildId).autoroles;
  const plan = verifyLock.planLock({ guildId, roles, channels, botRoleIds: me.roles || [], verifyChannelId: v.channelId, verifiedRoleIds: v.roles, openChannelIds: open, hideVerify: hideVerify === true, joinRoleIds: auto?.enabled ? auto.roles || [] : [] });
  const name = (id) => channels.find((c) => c.id === id)?.name || 'a channel';
  return {
    ...plan,
    verifyChannelId: v.channelId,
    verifyChannelName: name(v.channelId),
    verifiedRoles: v.roles.map((id) => ({ id, name: roles.find((r) => r.id === id)?.name || 'a role' })),
    openChannels: open.map((id) => ({ id, name: name(id), type: channels.find((c) => c.id === id)?.type ?? 0 })),
    // Channels that let everyone in by name now (when updating a lock, the ones kept open before).
    currentlyOpen: channels.filter((c) => c.id !== v.channelId && c.type !== 4 && (c.permission_overwrites || []).some((o) => o.id === guildId && BigInt(o.allow || 0) & (1n << 10n))).map((c) => c.id),
    // Channels that could stay open to everyone too, for the app's list: every kind, in Discord's
    // order (by category, then text-like channels before voice ones).
    openable: (() => {
      const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
      const voiceLike = (c) => (c.type === 2 || c.type === 13 ? 1 : 0);
      const where = (c) => categories.get(c.parent_id)?.position ?? -1;
      return channels
        .filter((c) => [0, 2, 5, 13, 15, 16].includes(c.type) && c.id !== v.channelId)
        .sort((a, b) => where(a) - where(b) || voiceLike(a) - voiceLike(b) || a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, type: c.type, category: categories.get(c.parent_id)?.name || '' }));
    })(),
  };
}

function autoRolesFor(botId) {
  if (!autoRoleEngines.has(botId)) {
    autoRoleEngines.set(
      botId,
      autoRoles.createAutoRoles({
        rest: restFor(botId),
        settingsFor: (guildId) => store.getGuildConfig(botId, guildId).autoroles || null,
        report: (guildId, problem) => {
          if (problem) autoRoleProblems.set(`${botId}:${guildId}`, problem);
          else autoRoleProblems.delete(`${botId}:${guildId}`);
        },
      }),
    );
  }
  return autoRoleEngines.get(botId);
}

/* ---------- Announcements (scheduled ones are sent while the app runs, including in the tray) ---------- */
// Kept per server in servers.json as announcements. Pictures picked from the PC are copied into the
// app's data folder and attached when the message is sent.
const ANNOUNCE_IMAGE_TYPES = CARD_IMAGE_TYPES;
const MAX_ANNOUNCE_IMAGE_BYTES = 8 * 1024 * 1024;
const announceDir = () => path.join(app.getPath('userData'), 'announcements');

function allAnnouncements() {
  return store
    .listGuildConfigs()
    .filter(({ botId }) => store.getBot(botId) && !isMod(botId))
    .flatMap(({ botId, guildId, config }) => (config.announcements || []).map((a) => ({ ...a, botId, guildId })));
}

function updateAnnouncement(botId, guildId, id, patch) {
  const list = store.getGuildConfig(botId, guildId).announcements || [];
  store.setGuildConfig(botId, guildId, { announcements: list.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  send('announce:changed', {});
}

function announceImage(file) {
  if (!file) return null;
  const full = path.join(announceDir(), path.basename(file));
  const type = ANNOUNCE_IMAGE_TYPES[path.extname(full).slice(1).toLowerCase()];
  return type && fs.existsSync(full) ? { name: path.basename(full), data: fs.readFileSync(full), type } : null;
}

// Posts an announcement, or edits the message it posted last (edit: true).
async function postAnnouncement(a, { edit = false } = {}) {
  const { body, files } = announce.buildMessage(a, announceImage(a.embed.imageFile));
  const rest = restFor(a.botId);
  if (edit) {
    if (!a.lastMessageId) throw new Error("This announcement hasn't been sent yet.");
    // Editing replaces the attachments, so the picture is sent again (or removed if it was taken out).
    return rest.request('PATCH', `/channels/${a.lastChannelId || a.channelId}/messages/${a.lastMessageId}`, { body: files ? body : { ...body, attachments: [] }, files });
  }
  return rest.request('POST', `/channels/${a.channelId}/messages`, { body, files });
}

const announcer = announce.createScheduler({
  list: () => allAnnouncements().filter((a) => a.schedule?.on && !alwaysOn(a.botId)),
  send: (a) => postAnnouncement(a),
  update: (a, patch) => updateAnnouncement(a.botId, a.guildId, a.id, patch),
});

/* ---------- Giveaways (posted and drawn while the app runs, including in the tray) ---------- */
// Kept per server in servers.json as giveaways; pictures picked from the PC share the announcements
// folder. With 24/7 on, the bot's portal posts and draws them instead, once it's new enough to.
function allGiveaways() {
  return store
    .listGuildConfigs()
    .filter(({ botId }) => store.getBot(botId) && !isMod(botId))
    .flatMap(({ botId, guildId, config }) => (config.giveaways || []).map((g) => ({ ...g, botId, guildId })));
}

function findGiveaway(botId, guildId, id) {
  const g = allGiveaways().find((x) => x.botId === botId && x.guildId === guildId && x.id === id);
  if (!g) throw new Error("That giveaway isn't in the app any more.");
  return g;
}

// Saves what the app did to a giveaway. rev counts up, so the portal goes by this from now on.
function updateGiveaway(botId, guildId, id, patch) {
  const list = store.getGuildConfig(botId, guildId).giveaways || [];
  store.setGuildConfig(botId, guildId, { giveaways: list.map((g) => (g.id === id ? { ...g, ...patch, rev: (g.rev || 0) + 1 } : g)) });
  send('giveaways:changed', {});
}

// The app posts and draws a bot's giveaways unless its portal does (24/7 on, and a portal new enough
// to), and waits while it hasn't heard from the portal yet.
function appRunsGiveaways(botId) {
  if (!alwaysOn(botId)) return true;
  const status = alwaysStatus.get(botId)?.status;
  return !!status && !status.features?.includes('giveaways');
}

const giveawayEngine = giveaways.createGiveaways({
  restFor: (g) => restFor(g.botId),
  list: () => allGiveaways().filter((g) => always.giveawayOpen(g) && appRunsGiveaways(g.botId)),
  update: (g, patch) => updateGiveaway(g.botId, g.guildId, g.id, patch),
  imageFor: (g) => announceImage(g.imageFile),
});

/* ---------- Server stats (counter channels renamed while the app runs, including in the tray) ---------- */
// Settings are kept per server in servers.json as stats.
const statsEngines = new Map(); // botId -> stats engine
const statsState = new Map(); // `${botId}:${guildId}` -> { counts, updatedAt, problem }

const statsServers = (botId) => store.listGuildConfigs().filter(({ botId: b, config }) => b === botId && config.stats).map(({ guildId, config }) => ({ guildId, settings: config.stats }));
// Bots and Users counters follow members joining and leaving.
const countsMembers = (botId) => statsServers(botId).some(({ settings }) => stats.needsMembers(settings));

function statsFor(botId) {
  if (!statsEngines.has(botId)) {
    statsEngines.set(
      botId,
      stats.createStats({
        rest: restFor(botId),
        settingsFor: () => statsServers(botId),
        report: (guildId, state) => {
          statsState.set(`${botId}:${guildId}`, state);
          send('stats:changed', { botId, guildId });
        },
      }),
    );
  }
  return statsEngines.get(botId);
}

async function tickStats() {
  for (const bot of store.listBots()) {
    if (bot.type !== 'mod' && !alwaysOn(bot.id) && statsServers(bot.id).length) await statsFor(bot.id).tick().catch(() => {});
  }
}

/* ---------- Server logs (posted while the app runs, including in the tray) ---------- */
const logConfigs = new Map(); // `${botId}:${guildId}` -> logs config
const logErrors = new Map(); // `${botId}:${guildId}` -> last posting problem
const loggers = new Map(); // botId -> { logger, content }
let logConfigsLoaded = false;

function loadLogConfigs() {
  if (logConfigsLoaded) return;
  logConfigsLoaded = true;
  for (const { botId, guildId, config } of store.listGuildConfigs()) if (config.logs) logConfigs.set(`${botId}:${guildId}`, normalizeLogConfig(config.logs));
}

const activeLogs = (botId) => {
  loadLogConfigs();
  return [...logConfigs].filter(([key, c]) => key.startsWith(`${botId}:`) && c.enabled && c.channelId).map(([, c]) => c);
};

function loggerFor(botId) {
  if (!loggers.has(botId)) {
    const entry = { content: !!store.getBot(botId)?.intents?.content };
    entry.logger = createServerLogger({
      rest: restFor(botId),
      configFor: (guildId) => {
        const c = logConfigs.get(`${botId}:${guildId}`);
        return c?.enabled && c.channelId ? { ...c, content: entry.content } : null;
      },
      onError: (guildId, err) => logErrors.set(`${botId}:${guildId}`, err.message),
    });
    loggers.set(botId, entry);
  }
  return loggers.get(botId).logger;
}

/* ---------- 24/7 (the mod portal runs the community features around the clock) ---------- */
// With 24/7 on, this app saves each server's settings for the portal in a private #bot-settings
// channel (src/main/always.js) whenever they change, stops running those features itself, and reads
// back what the portal did every minute (votes, announcements sent, videos seen, problems).
// Twitch alerts and automatic backups stay with the app.
const ALWAYS_PULL_MS = 60 * 1000;
const alwaysTimers = new Map(); // botId -> pending save
const alwaysSaves = new Map(); // botId -> the save running now
const alwaysStatus = new Map(); // botId -> { status, error, checkedAt }
const alwaysShown = new Map(); // botId -> the presence last shown for it
const alwaysAway = new Map(); // botId -> { from, to, servers: { guildId: counts } }: what the portal did while the app was closed

function alwaysOn(botId) {
  const bot = store.getBot(botId);
  return !!bot && bot.type !== 'mod' && !!bot.always?.on;
}

// A picture the settings use: a card background or an announcement picture.
function alwaysFile(name) {
  const base = path.basename(String(name || ''));
  const file = [cardsDir(), announceDir()].map((dir) => path.join(dir, base)).find((f) => fs.existsSync(f));
  return file ? fs.readFileSync(file) : null;
}

// Servers with settings in the app, plus ones saved for the portal before (to tell it they're off).
function alwaysServerIds(botId) {
  const ids = new Set(store.listGuildConfigs().filter((c) => c.botId === botId).map((c) => c.guildId));
  for (const a of store.getSocial().alerts) if (a.botId === botId && a.platform !== 'twitch') ids.add(a.guildId);
  for (const id of Object.keys(store.getBot(botId)?.always?.saved || {})) ids.add(id);
  return [...ids].filter((id) => /^\d{15,21}$/.test(id));
}

const alwaysBundle = (botId, guildId, on) =>
  always.makeBundle({ guildId, config: store.getGuildConfig(botId, guildId), alerts: store.getSocial().alerts.filter((a) => a.botId === botId), bot: store.getBot(botId), youtubeKey: store.getYouTubeKey(), on });

// A signed request to the bot's portal.
async function callPortal(botId, route, body = {}) {
  const url = store.getBot(botId)?.always?.portalUrl;
  if (!url) throw new Error('Turn on slash commands first: 24/7 runs on the same mod portal.');
  const text = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url + route, { method: 'POST', headers: always.signedHeaders(store.getToken(botId), text), body: text, signal: AbortSignal.timeout(90000) });
  } catch (err) {
    throw new Error(`Can't reach your mod portal (${err.cause?.code || err.name}). If it was asleep, it can take a minute to wake up.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Your portal doesn't run this bot. On Render, open your portal → Environment and add this bot's token as DISCORD_BOT_TOKEN_2 (or _3, _4… for more bots), wait for the deploy to finish, then try again.");
  if (res.status === 404) throw new Error('Your portal needs updating: on GitHub, open your fork and press Sync fork, then wait for Render to finish deploying.');
  if (!res.ok) throw new Error(data.error || `Your portal answered HTTP ${res.status}.`);
  return data;
}

// Saves the settings of every server whose settings changed since they were last saved.
// on: false tells the portal to stop. force: save them all.
function saveAlways(botId, { on = true, force = false } = {}) {
  const run = (alwaysSaves.get(botId) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const bot = store.getBot(botId);
      if (!bot || bot.type === 'mod') return {};
      const saved = { ...bot.always?.saved };
      const changedIds = [];
      for (const guildId of alwaysServerIds(botId)) {
        const bundle = alwaysBundle(botId, guildId, on);
        if (!bundle.used && !saved[guildId]) continue; // nothing to run there, and nothing saved before
        const hash = always.bundleHash(bundle);
        if (!force && saved[guildId]?.hash === hash) continue;
        try {
          const { channelId } = await always.saveBundle({ rest: restFor(botId), token: store.getToken(botId), guildId, botUserId: botId, bundle, readFile: alwaysFile });
          saved[guildId] = { hash, at: Date.now(), channelId, problem: null };
          changedIds.push(guildId);
        } catch (err) {
          saved[guildId] = { ...saved[guildId], hash: null, problem: err.code === 10004 ? "The bot isn't in this server any more." : err.message };
        }
      }
      if (JSON.stringify(saved) !== JSON.stringify(store.getBot(botId).always?.saved || {})) store.updateBot(botId, { always: { ...store.getBot(botId).always, saved } });
      // Tell the portal to read them now, rather than within 10 minutes.
      if (changedIds.length) await callPortal(botId, '/always/reload', { guildIds: changedIds }).then((s) => noteAlways(botId, s), (err) => noteAlways(botId, null, err));
      send('always:changed', { botId });
      return saved;
    });
  alwaysSaves.set(botId, run);
  return run;
}

function scheduleAlwaysSave(botId, delay = 2000) {
  if (!alwaysOn(botId)) return;
  clearTimeout(alwaysTimers.get(botId));
  alwaysTimers.set(
    botId,
    setTimeout(() => saveAlways(botId).catch((err) => console.error('24/7 save:', err.message)), delay),
  );
}

store.onChange(({ botId, social }) => {
  if (social) for (const bot of store.listBots()) scheduleAlwaysSave(bot.id);
  else if (botId) scheduleAlwaysSave(botId);
});

// Shows the portal's connection as the bot's online status.
function noteAlways(botId, status, err = null) {
  const before = alwaysStatus.get(botId);
  alwaysStatus.set(botId, { status: status || before?.status || null, error: err ? err.message : null, checkedAt: Date.now() });
  if (!alwaysOn(botId)) return;
  const gw = (status || before?.status)?.gateway;
  let shown;
  if (err) shown = { state: 'offline', detail: `24/7: ${err.message}` };
  else if (gw?.state === 'online') shown = { state: store.getBot(botId)?.presence?.enabled ? 'online' : 'invisible', detail: 'Online 24/7 through your mod portal' };
  else shown = { state: gw?.state === 'error' ? 'error' : 'connecting', detail: gw?.detail ? `Mod portal: ${gw.detail}` : 'Your mod portal is connecting the bot' };
  connectionStates.set(botId, shown);
  if (JSON.stringify(alwaysShown.get(botId)) !== JSON.stringify(shown)) {
    alwaysShown.set(botId, shown);
    send('presence:state', { botId, ...shown });
  }
}

// Copies what the portal did into the app, so its pages show it (and the app carries on from there
// if 24/7 is turned off).
function mergeAlways(botId, status) {
  // Pages are told only about what changed, so they don't redraw every minute for nothing.
  const changed = { announcements: false, giveaways: false, panels: false, polls: false, stats: false };
  for (const [guildId, s] of Object.entries(status.servers || {})) {
    if (!s.on) continue;
    const config = store.getGuildConfig(botId, guildId);
    const patch = always.mergeServer(config, s) || {};
    if (patch.polls) patch.polls = trimPolls(patch.polls);
    if (Object.keys(patch).length) store.setGuildConfig(botId, guildId, patch);
    if (patch.announcements) changed.announcements = true;
    if (patch.giveaways) changed.giveaways = true;
    if (patch.reactionRoles) changed.panels = true;
    if (patch.polls) changed.polls = true;

    const problems = s.problems || {};
    const note = (map, key, problem) => (problem ? map.set(key, problem) : map.delete(key));
    note(autoRoleProblems, `${botId}:${guildId}`, problems.autoroles);
    note(greetingProblems, `${botId}:${guildId}:welcome`, problems.welcome);
    note(greetingProblems, `${botId}:${guildId}:goodbye`, problems.goodbye);
    note(logErrors, `${botId}:${guildId}`, problems.logs);
    for (const p of config.reactionRoles || []) note(panelProblems, p.id, problems[`panel:${p.id}`]);
    for (const p of patch.polls || config.polls || []) {
      if ((pollProblems.get(p.id) || null) !== (problems[`poll:${p.id}`] || null)) changed.polls = true; // shown on the Polls page
      note(pollProblems, p.id, problems[`poll:${p.id}`]);
    }
    if (s.stats && JSON.stringify(s.stats) !== JSON.stringify(statsState.get(`${botId}:${guildId}`))) {
      statsState.set(`${botId}:${guildId}`, s.stats);
      changed.stats = true;
    }
  }

  // YouTube alerts: what was seen and posted.
  const { alerts, changed: alertsChanged } = always.mergeAlerts(store.getSocial().alerts, botId, status.servers);
  if (alertsChanged) store.saveSocial({ alerts });

  if (changed.polls) {
    rebuildPollIndex();
    send('polls:changed');
  }
  if (changed.announcements) send('announce:changed', {});
  if (changed.giveaways) send('giveaways:changed', {});
  if (changed.panels) {
    rebuildPanelIndex();
    send('rr:changed', {});
  }
  if (changed.stats) send('stats:changed', { botId });
  if (alertsChanged) send('social:changed', {});
}

// What the portal did while the app was closed: its running totals at the first answer after the
// app starts, against the last ones the app saw (kept in bots.json as always.seen). The time they
// were seen is kept fresh every 10 minutes, so "while the app was closed" starts about when it
// closed, even when it didn't get to say so (a crash, or Windows shutting down).
const SEEN_FRESH_MS = 10 * 60 * 1000;
function noteActivity(botId, status) {
  const seen = store.getBot(botId).always?.seen || null;
  const totals = {};
  for (const [guildId, s] of Object.entries(status.servers || {})) if (s.on && s.state?.activity) totals[guildId] = s.state.activity;
  if (!alwaysAway.has(botId)) {
    const servers = {};
    for (const [guildId, now] of Object.entries(totals)) if (seen?.totals?.[guildId]) servers[guildId] = always.activitySince(seen.totals[guildId], now);
    alwaysAway.set(botId, seen ? { from: seen.at, to: Date.now(), servers } : null);
  }
  const stale = !seen || Date.now() - seen.at > SEEN_FRESH_MS;
  if (stale || JSON.stringify(totals) !== JSON.stringify(seen.totals || {})) store.updateBot(botId, { always: { ...store.getBot(botId).always, seen: { at: Date.now(), totals } } });
}

// The app is closing: it saw the portal's totals until now (the start of "while the app was closed").
function noteClosing() {
  for (const bot of store.listBots()) {
    if (bot.always?.on && bot.always.seen) store.updateBot(bot.id, { always: { ...bot.always, seen: { ...bot.always.seen, at: Date.now() } } });
  }
}

async function pullAlways(botId) {
  try {
    const status = await callPortal(botId, '/always/status');
    noteAlways(botId, status);
    mergeAlways(botId, status);
    noteActivity(botId, status);
    return status;
  } catch (err) {
    noteAlways(botId, null, err);
    return null;
  } finally {
    send('always:changed', { botId });
  }
}

const pullAllAlways = () => Promise.all(store.listBots().filter((b) => alwaysOn(b.id)).map((b) => pullAlways(b.id)));

// The bot's server names, read again every 10 minutes.
const guildNameCache = new Map(); // botId -> { at, names }
async function guildNames(botId) {
  const cached = guildNameCache.get(botId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.names;
  const guilds = await restFor(botId)
    .request('GET', '/users/@me/guilds')
    .catch(() => null);
  if (!guilds) return cached?.names || new Map();
  const names = new Map(guilds.map((g) => [g.id, g.name]));
  guildNameCache.set(botId, { at: Date.now(), names });
  return names;
}

// What the Home page shows about 24/7 for a bot.
async function alwaysReport(botId) {
  const bot = store.getBot(botId);
  const s = alwaysStatus.get(botId);
  const names = await guildNames(botId);
  const portalServers = s?.status?.servers || {};
  const away = alwaysAway.get(botId) || null;
  const servers = Object.entries(bot.always?.saved || {}).map(([guildId, saved]) => {
    const p = portalServers[guildId];
    return {
      guildId,
      name: names.get(guildId) || guildId,
      savedAt: saved.at || null,
      saveProblem: saved.problem || null,
      on: !!p?.on,
      loadedAt: p?.loadedAt || null,
      problem: p?.problem || null,
      problems: Object.values(p?.problems || {}).filter(Boolean),
      away: away?.servers[guildId] || null,
    };
  });
  return {
    on: !!bot.always?.on,
    portalUrl: bot.always?.portalUrl || null,
    since: bot.always?.since || null,
    away: away ? { from: away.from, to: away.to } : null,
    checkedAt: s?.checkedAt || null,
    error: s?.error || null,
    portal: s?.status ? { running: s.status.running, gateway: s.status.gateway, startedAt: s.status.startedAt, loadedAt: s.status.loadedAt, cards: s.status.cards } : null,
    servers,
  };
}

// Whether a bot needs its gateway connection for server logs, reaction roles, polls or welcome cards.
const needsGateway = (botId) => activeLogs(botId).length > 0 || watchesReactions(botId) || greetingsOn(botId) || autoRolesOn(botId) || countsMembers(botId) || answersTickets(botId);

// One gateway connection per bot: it keeps the bot online (when presence is on) and receives the
// events for server logs, reaction roles and polls. With those on but presence off, it connects invisibly.
function syncConnection(botId) {
  const bot = store.getBot(botId);
  if (!bot || bot.type === 'mod') return;
  // 24/7: the portal has the bot's connection and runs these features instead.
  if (alwaysOn(botId)) {
    presences.get(botId)?.stop();
    return;
  }
  const logs = activeLogs(botId);
  const reactions = watchesReactions(botId);
  // Welcome cards, auto roles and the Bots and Users counters all follow members joining.
  const greetings = greetingsOn(botId) || autoRolesOn(botId) || countsMembers(botId);
  const ticketButtons = answersTickets(botId); // button presses arrive whatever the intents
  const conn = presenceFor(botId);
  loggerFor(botId);
  loggers.get(botId).content = !!bot.intents?.content;
  // Joins and leaves need the Server Members Intent, asked for only when the Developer Portal allows it.
  const greetingIntents = greetings ? welcome.WELCOME_INTENTS.GUILDS | (bot.intents?.members ? welcome.WELCOME_INTENTS.GUILD_MEMBERS : 0) : 0;
  conn.setIntents((logs.length ? logIntents(logs, bot.intents) : 0) | (reactions ? reactionRoles.RR_INTENTS : 0) | greetingIntents | (ticketButtons ? welcome.WELCOME_INTENTS.GUILDS : 0));
  if (bot.presence?.enabled) conn.start(bot.presence);
  else if (logs.length || reactions || greetings || ticketButtons) conn.start({ status: 'invisible', text: '' });
  else conn.stop();
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

const SAFE_HOSTS = ['discord.com', 'support.discord.com', 'discord.dev', 'pixelplayz.org', 'github.com', 'render.com', 'twitch.tv', 'youtube.com', 'console.cloud.google.com'];
const isSafeUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SAFE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

// Whether the bot's slash commands go to a mod portal, and how many of the mod commands it has.
async function slashStatus(rest) {
  const application = await rest.request('GET', '/applications/@me');
  const registered = await rest.request('GET', `/applications/${application.id}/commands`);
  return {
    endpoint: application.interactions_endpoint_url || null,
    registered: registered.filter((c) => commands.NAMES.has(c.name)).length,
    total: commands.COMMANDS.length,
    others: registered.filter((c) => !commands.NAMES.has(c.name)).map((c) => c.name),
    poll: registered.some((c) => c.name === 'poll'),
  };
}

// Polls posted with /poll only get their bars while the bot's gateway connection runs, so the app
// remembers which bots have it and connects them.
function noteSlashCommands(botId, status) {
  const on = !!status.endpoint && status.poll;
  if (!!store.getBot(botId)?.slashCommands !== on) {
    store.updateBot(botId, { slashCommands: on });
    syncConnection(botId);
  }
  return status;
}

const handlers = {
  'bots:list': () => store.listBots(),

  'bots:add': async (rawToken) => {
    const token = cleanToken(rawToken);
    if (token.split('.').length !== 3) throw new Error('That does not look like a bot token (it should have three parts separated by dots).');
    const info = await describeBot(new DiscordRest(token));
    const bot = store.upsertBot(info, token);
    clients.delete(bot.id);
    caseLogs.delete(bot.id);
    reactionEngines.delete(bot.id);
    pollEngines.delete(bot.id);
    autoRoleEngines.delete(bot.id);
    welcomers.delete(bot.id);
    ticketEngines.delete(bot.id);
    statsEngines.delete(bot.id);
    loggers.delete(bot.id);
    presences.get(bot.id)?.stop();
    presences.delete(bot.id);
    if (needsGateway(bot.id)) syncConnection(bot.id);
    // A new token means a new key for the 24/7 settings: save them again.
    if (alwaysOn(bot.id)) saveAlways(bot.id, { force: true }).catch(() => {});
    return bot;
  },

  'bots:refresh': async (botId) => {
    const bot = store.getBot(botId);
    if (bot?.type !== 'mod') {
      const updated = store.updateBot(botId, await describeBot(restFor(botId)));
      // Privileged intents may have been switched on or off in the Developer Portal since.
      if (needsGateway(botId)) syncConnection(botId);
      scheduleAlwaysSave(botId, 500);
      return updated;
    }
    const me = await portal.call(bot.portalUrl, '/api/me', { token: store.getToken(botId) });
    return store.updateBot(botId, portal.modProfile(bot.portalUrl, me));
  },

  'mod:signIn': async (portalUrl) => {
    const { portalUrl: url, token, me } = await portal.signIn(portalUrl);
    return store.upsertBot(portal.modProfile(url, me), token);
  },

  'mod:cancelSignIn': () => portal.cancelSignIn(),

  'mod:checkPortal': async (portalUrl) => {
    const url = portal.normalizePortalUrl(portalUrl);
    await portal.call(url, '/health');
    return url;
  },

  'commands:status': async (botId) => {
    if (isMod(botId)) ownerOnly();
    return noteSlashCommands(botId, await slashStatus(restFor(botId)));
  },

  // Points the bot's Interactions Endpoint URL at the portal (Discord checks it answers, signed as
  // this bot, before saving) and adds the mod commands.
  'commands:enable': async (botId, portalUrl) => {
    if (isMod(botId)) ownerOnly();
    const rest = restFor(botId);
    const url = portal.normalizePortalUrl(portalUrl);
    await portal.call(url, '/health'); // wake a sleeping portal so Discord's check doesn't time out
    const application = await rest.request('GET', '/applications/@me');
    try {
      await rest.request('PATCH', '/applications/@me', { body: { interactions_endpoint_url: `${url}/interactions` } });
    } catch (err) {
      if (err.code !== 50035 || !/interactions_endpoint_url/.test(err.message)) throw err;
      throw new Error("Discord couldn't verify your portal. Make sure it runs this bot's token (for a second bot, add it on Render as DISCORD_BOT_TOKEN_2, or _3, _4…) and has the latest code: on GitHub, press Sync fork, then wait for Render to finish deploying.");
    }
    await commands.registerCommands(rest, application.id);
    return noteSlashCommands(botId, await slashStatus(rest));
  },

  // Removes the mod commands, and stops sending interactions to the portal if they go there.
  'commands:disable': async (botId, portalUrl) => {
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) throw new Error('Turn 24/7 off first (below): it runs on the same mod portal.');
    const rest = restFor(botId);
    const application = await rest.request('GET', '/applications/@me');
    let ours = false;
    try {
      ours = application.interactions_endpoint_url === `${portal.normalizePortalUrl(portalUrl)}/interactions`;
    } catch {
      // no usable portal address; leave the endpoint as it is
    }
    if (ours) await rest.request('PATCH', '/applications/@me', { body: { interactions_endpoint_url: null } });
    await commands.removeCommands(rest, application.id);
    return noteSlashCommands(botId, await slashStatus(rest));
  },

  // pull: ask the portal now, else what it said last.
  'always:status': async (botId, { pull = true } = {}) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    if (pull && alwaysOn(botId)) await pullAlways(botId);
    return alwaysReport(botId);
  },

  // Hands the community features to the bot's mod portal: checks it's new enough and runs this bot,
  // saves every server's settings for it, then stops running them here.
  'always:enable': async (botId) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const application = await restFor(botId).request('GET', '/applications/@me');
    const endpoint = application.interactions_endpoint_url || '';
    if (!endpoint.endsWith('/interactions')) throw new Error('Turn on slash commands first (above): 24/7 runs on the same mod portal.');
    const portalUrl = endpoint.slice(0, -'/interactions'.length);
    const health = await portal.call(portalUrl, '/health');
    if (!(health.always >= always.VERSION)) throw new Error('Your mod portal needs updating first. On GitHub, open your fork and press Sync fork, wait for Render to finish deploying (a few minutes), then try again.');
    store.updateBot(botId, { always: { ...store.getBot(botId).always, portalUrl } });
    await callPortal(botId, '/always/status'); // proves the portal runs this bot's token
    store.updateBot(botId, { always: { ...store.getBot(botId).always, on: true, since: Date.now() } });
    alwaysShown.delete(botId);
    alwaysAway.set(botId, null); // the app is open: nothing happened "while it was closed"
    syncConnection(botId);
    await saveAlways(botId, { force: true });
    await pullAlways(botId);
    return alwaysReport(botId);
  },

  // Takes the features back: keeps what the portal did, tells it to stop, and runs them here again.
  'always:disable': async (botId) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) await pullAlways(botId);
    clearTimeout(alwaysTimers.get(botId));
    await saveAlways(botId, { on: false, force: true });
    store.updateBot(botId, { always: { ...store.getBot(botId).always, on: false, since: null } });
    alwaysStatus.delete(botId);
    alwaysShown.delete(botId);
    connectionStates.delete(botId);
    const bot = store.getBot(botId);
    if (bot.presence?.enabled || needsGateway(botId)) syncConnection(botId);
    else send('presence:state', { botId, state: 'offline' });
    return alwaysReport(botId);
  },

  'bots:update': (botId, patch) => {
    const allowed = {};
    if ('label' in patch) allowed.label = String(patch.label || '').slice(0, 40);
    if ('presence' in patch) allowed.presence = patch.presence;
    return store.updateBot(botId, allowed);
  },

  'bots:remove': (botId) => {
    clearTimeout(alwaysTimers.get(botId));
    alwaysStatus.delete(botId);
    presences.get(botId)?.stop();
    presences.delete(botId);
    clients.delete(botId);
    caseLogs.delete(botId);
    reactionEngines.delete(botId);
    pollEngines.delete(botId);
    autoRoleEngines.delete(botId);
    welcomers.delete(botId);
    ticketEngines.delete(botId);
    statsEngines.delete(botId);
    loggers.delete(botId);
    store.removeBot(botId);
  },

  'bots:reorder': (ids) => store.reorderBots(ids),

  'presence:set': (botId, presence) => {
    if (isMod(botId)) ownerOnly();
    const bot = store.updateBot(botId, { presence });
    syncConnection(botId);
    scheduleAlwaysSave(botId, 500);
    return bot;
  },

  'logs:get': (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const key = `${botId}:${snowflake(guildId, 'server')}`;
    loadLogConfigs();
    const bot = store.getBot(botId);
    return {
      config: logConfigs.get(key) || normalizeLogConfig(null),
      intents: bot?.intents || {},
      connection: connectionStates.get(botId) || { state: 'offline' },
      lastError: logErrors.get(key) || null,
    };
  },

  'logs:set': (botId, guildId, input) => {
    if (isMod(botId)) ownerOnly();
    const config = normalizeLogConfig(input);
    if (config.enabled && !config.channelId) throw new Error('Pick the channel to post logs in.');
    const key = `${botId}:${snowflake(guildId, 'server')}`;
    loadLogConfigs();
    store.setGuildConfig(botId, guildId, { logs: config });
    logConfigs.set(key, config);
    logErrors.delete(key);
    syncConnection(botId);
    return handlers['logs:get'](botId, guildId);
  },

  // Public bans: the channel bans are posted in (null for private bans), named in #mod-cases' topic
  // so the mod portal and /ban follow it too. Returns #mod-cases as it is now.
  'cases:publicBans': async (botId, guildId, channelId) => {
    if (isMod(botId)) ownerOnly();
    const rest = restFor(botId);
    const { guild, roles } = await guildAndRoles(rest, snowflake(guildId, 'server'));
    return casesFor(botId).setPublicBans(guild, roles, channelId ? snowflake(channelId, 'channel') : null);
  },

  'cases:createPublicChannel': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const rest = restFor(botId);
    const guild = await rest.request('GET', `/guilds/${snowflake(guildId, 'server')}`);
    return rest.request('POST', `/guilds/${guildId}/channels`, {
      body: publicChannel(PUBLIC_CHANNEL_NAME, 'Bans, posted by the bot for everyone to see.', guild, botId),
      reason: 'Channel for public bans',
    });
  },

  // A private #server-logs channel: hidden from @everyone, readable by mod roles.
  'logs:createChannel': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const rest = restFor(botId);
    const { guild, roles } = await guildAndRoles(rest, snowflake(guildId, 'server'));
    return rest.request('POST', `/guilds/${guildId}/channels`, {
      body: privateChannel('server-logs', 'Joins, leaves, deleted and edited messages and other server events, posted by Discord Server Builder.', guild, roles, botId),
      reason: 'Server logs channel',
    });
  },

  'logs:test': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const config = logConfigs.get(`${botId}:${snowflake(guildId, 'server')}`);
    if (!config?.channelId) throw new Error('Pick the log channel first.');
    await restFor(botId).request('POST', `/channels/${config.channelId}/messages`, {
      body: { embeds: [{ title: 'Server logs are working', description: 'Events will show up here while Discord Server Builder is running (it can stay in the tray).', color: 0x0bbfbc, timestamp: new Date().toISOString() }] },
    });
    logErrors.delete(`${botId}:${guildId}`);
  },

  // opts.noCase: don't record this action in #mod-cases (used by the bulk raid tools).
  rest: async (botId, method, apiPath, opts = {}) => {
    if (!METHODS.has(method) || typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.includes('..') || apiPath.includes('://')) {
      throw new Error('Blocked request.');
    }
    if (isMod(botId)) return modCall(botId, '/api/discord', { method, path: apiPath, query: opts.query, body: opts.body, reason: opts.reason, noCase: !!opts.noCase });
    // A ban DMs them the reason first, like /ban (once they're out the bot can't reach them).
    // Bulk raid bans (noCase) don't.
    const found = opts.noCase ? null : caseFromCall(method, apiPath, opts.body);
    let told = null;
    if (found?.type === 'ban') {
      const rest = restFor(botId);
      const guild = await rest.request('GET', `/guilds/${found.guildId}`).catch(() => null);
      if (guild) told = await tellBanned(rest, guild, found.memberId, typeof opts.reason === 'string' ? opts.reason.slice(0, 400) : '');
    }
    const result = await restFor(botId).request(method, apiPath, opts);
    if (!opts.noCase) recordCall(botId, method, apiPath, opts);
    if (told === false) send('cases:untold', { botId, message: BAN_UNTOLD });
    return result;
  },

  'servers:config': (botId, guildId) => store.getGuildConfig(botId, snowflake(guildId, 'server')),

  // Every reaction-role panel of the owner's bots, with its latest problem (if any).
  'rr:list': () =>
    allPanels()
      .filter((p) => store.getBot(p.botId) && !isMod(p.botId))
      .map((p) => ({ ...p, problem: panelProblems.get(p.id) || null })),

  // Saves a panel and posts (or updates) its message and reactions in Discord.
  'rr:save': async (botId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const panel = reactionRoles.normalizePanel(input);
    const list = store.getGuildConfig(botId, panel.guildId).reactionRoles || [];
    const previous = panel.id ? list.find((p) => p.id === panel.id) || null : null;
    const saved = { ...panel, id: previous?.id || crypto.randomUUID(), createdAt: previous?.createdAt || Date.now() };
    saved.messageId = await reactionRoles.publishPanel(restFor(botId), saved, previous);
    store.setGuildConfig(botId, panel.guildId, { reactionRoles: previous ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved] });
    panelProblems.delete(saved.id);
    rebuildPanelIndex();
    syncConnection(botId);
    return handlers['rr:list']();
  },

  'rr:delete': async (botId, guildId, id, deleteMessage) => {
    if (isMod(botId)) ownerOnly();
    const list = store.getGuildConfig(botId, snowflake(guildId, 'server')).reactionRoles || [];
    const panel = list.find((p) => p.id === id);
    if (panel?.messageId && deleteMessage) await restFor(botId).request('DELETE', `/channels/${panel.channelId}/messages/${panel.messageId}`).catch(() => {});
    store.setGuildConfig(botId, guildId, { reactionRoles: list.filter((p) => p.id !== id) });
    panelProblems.delete(id);
    rebuildPanelIndex();
    syncConnection(botId);
    return handlers['rr:list']();
  },

  // Hands out roles for reactions the bot missed (for example while the app was closed).
  'rr:sync': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const panel = botPanels(botId).find((p) => p.id === id && p.guildId === guildId);
    if (!panel) throw new Error("That panel isn't posted yet.");
    return reactionsFor(botId).catchUp(panel);
  },

  // Every poll of the owner's bots, newest first, with its latest problem (if any).
  'polls:list': () =>
    allPolls()
      .filter((p) => store.getBot(p.botId) && !isMod(p.botId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((p) => ({ ...p, problem: pollProblems.get(p.id) || null })),

  // Posts a poll from the app, or updates one that's still open.
  'polls:save': async (botId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const poll = polls.normalizePoll(input);
    const list = store.getGuildConfig(botId, poll.guildId).polls || [];
    const previous = poll.id ? list.find((p) => p.id === poll.id) || null : null;
    if (previous?.ended) throw new Error("This poll has ended, so it can't be changed.");
    const saved = { ...poll, id: previous?.id || crypto.randomUUID(), source: previous?.source || 'app', by: previous?.by || null, createdAt: previous?.createdAt || Date.now(), ended: false };
    Object.assign(saved, await polls.publishPoll(restFor(botId), saved, previous));
    // The bot's own reactions may have shown the new message to the /poll finder already: keep one.
    const others = (store.getGuildConfig(botId, poll.guildId).polls || []).filter((p) => p.id !== saved.id && p.messageId !== saved.messageId);
    store.setGuildConfig(botId, poll.guildId, { polls: trimPolls([...others, saved]) });
    pollProblems.delete(saved.id);
    rebuildPollIndex();
    syncConnection(botId);
    return handlers['polls:list']();
  },

  // Draws the final results and stops counting votes.
  'polls:end': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const poll = botPolls(botId).find((p) => p.id === id && p.guildId === guildId);
    if (!poll) throw new Error("That poll isn't in the app any more.");
    try {
      await pollsFor(botId).end(poll);
    } catch (err) {
      if (err.code === 10008) throw new Error('Its message was deleted in Discord, so the poll was removed.');
      throw err;
    }
    syncConnection(botId);
    return handlers['polls:list']();
  },

  'polls:delete': async (botId, guildId, id, deleteMessage) => {
    if (isMod(botId)) ownerOnly();
    const list = store.getGuildConfig(botId, snowflake(guildId, 'server')).polls || [];
    const poll = list.find((p) => p.id === id);
    if (poll?.messageId && deleteMessage) await restFor(botId).request('DELETE', `/channels/${poll.channelId}/messages/${poll.messageId}`).catch(() => {});
    store.setGuildConfig(botId, guildId, { polls: list.filter((p) => p.id !== id) });
    pollProblems.delete(id);
    rebuildPollIndex();
    syncConnection(botId);
    return handlers['polls:list']();
  },

  // The bar colour that goes with an emoji, for the poll editor.
  'polls:emojiColor': (emoji, index) => emojiBarColor(reactionRoles.cleanEmoji(emoji), Number(index) || 0),

  // Every server of the owner's bots with welcome or goodbye settings, with any problems.
  'welcome:list': () =>
    store
      .listGuildConfigs()
      .filter(({ botId, config }) => config.greetings && store.getBot(botId) && !isMod(botId))
      .map(({ botId, guildId }) => {
        const g = greetingsOf(botId, guildId);
        const problem = (kind) => greetingProblems.get(`${botId}:${guildId}:${kind}`) || null;
        return { botId, guildId, ...g, problems: { welcome: problem('welcome'), goodbye: problem('goodbye') }, membersIntent: !!store.getBot(botId).intents?.members };
      }),

  'welcome:save': (botId, guildId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    const greetings = { guildName: String(input?.guildName || '').slice(0, 100), welcome: WelcomeCard.normalizeKind(input?.welcome, 'welcome'), goodbye: WelcomeCard.normalizeKind(input?.goodbye, 'goodbye') };
    for (const kind of WelcomeCard.KINDS) {
      if (greetings[kind].enabled && !greetings[kind].channelId) throw new Error(`Pick the channel for ${kind === 'welcome' ? 'welcome' : 'goodbye'} messages.`);
      greetingProblems.delete(`${botId}:${id}:${kind}`);
    }
    store.setGuildConfig(botId, id, { greetings });
    syncConnection(botId);
    return handlers['welcome:list']();
  },

  'welcome:remove': (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    store.setGuildConfig(botId, snowflake(guildId, 'server'), { greetings: null });
    syncConnection(botId);
    return handlers['welcome:list']();
  },

  // Posts a welcome or goodbye for the bot itself, with the settings being edited, without pinging.
  'welcome:test': async (botId, guildId, kind, input) => {
    if (isMod(botId)) ownerOnly();
    if (!WelcomeCard.KINDS.includes(kind)) throw new Error('Unknown message type.');
    const settings = { ...WelcomeCard.normalizeKind(input, kind), ping: false };
    if (!settings.channelId) throw new Error('Pick the channel first.');
    const rest = restFor(botId);
    const me = await rest.request('GET', '/users/@me');
    const guild = await welcomerFor(botId).guildInfo(snowflake(guildId, 'server'));
    const { body, files, problem } = await welcome.greetingMessage(kind, settings, welcome.varsFor(me, guild), me, renderCardImage);
    body.content = `🧪 **Test** (nobody was pinged)\n${body.content}`.slice(0, 2000);
    await rest.request('POST', `/channels/${settings.channelId}/messages`, { body, files });
    if (problem) throw new Error(problem);
  },

  // A background image for a card: copied into the app's data folder, and shown in the preview.
  'welcome:pickBackground': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose a card background', filters: [{ name: 'Images', extensions: Object.keys(CARD_IMAGE_TYPES) }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return null;
    const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
    if (!CARD_IMAGE_TYPES[ext]) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
    if (fs.statSync(filePaths[0]).size > MAX_CARD_IMAGE_BYTES) throw new Error('That image is over 8 MB. Pick a smaller one.');
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(cardsDir(), { recursive: true });
    fs.copyFileSync(filePaths[0], path.join(cardsDir(), name));
    return { image: name, dataUrl: cardBackground(name) };
  },

  'welcome:image': (name) => cardBackground(name),

  // Every server with auto roles, with its latest problem.
  'autoroles:list': () =>
    store
      .listBots()
      .filter((b) => b.type !== 'mod')
      .flatMap((b) =>
        store
          .listGuildConfigs()
          .filter(({ botId, config }) => botId === b.id && config.autoroles)
          .map(({ guildId, config }) => ({ ...config.autoroles, botId: b.id, guildId, problem: autoRoleProblems.get(`${b.id}:${guildId}`) || null, membersIntent: !!b.intents?.members, answeredBy: b.slashCommands ? 'portal' : 'app', lock: config.verifyLock ? { at: config.verifyLock.at, partial: !!config.verifyLock.partial } : null })),
      ),

  // Saves a server's auto roles, and posts, updates or removes the Verify message.
  'autoroles:save': async (botId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const s = autoRoles.normalizeSettings(input);
    if (!s.guildId) throw new Error('Pick the server.');
    const rest = restFor(botId);
    const previous = store.getGuildConfig(botId, s.guildId).autoroles?.verify || null;
    // Locked behind this Verify button: it has to stay where it is, giving the same roles.
    const lock = store.getGuildConfig(botId, s.guildId).verifyLock;
    if (lock && (!s.verify.enabled || s.verify.channelId !== lock.verifyChannelId || String(s.verify.roles) !== String(lock.roleIds))) {
      throw new Error("The server is locked behind this Verify button, so it can't be turned off, moved or give other roles. Unlock the server first (on the Auto roles page).");
    }
    const old = previous?.messageId ? { channelId: previous.channelId, messageId: previous.messageId, emojis: [] } : null;
    if (s.verify.enabled) {
      s.verify.messageId = await reactionRoles.publishMessage(rest, { channelId: s.verify.channelId, body: autoRoles.verifyMessage(s.verify), emojis: [] }, old);
    } else {
      if (old) await rest.request('DELETE', `/channels/${old.channelId}/messages/${old.messageId}`).catch(() => {});
      s.verify.messageId = '';
    }
    store.setGuildConfig(botId, s.guildId, { autoroles: s });
    autoRoleProblems.delete(`${botId}:${s.guildId}`);
    syncConnection(botId);
    return handlers['autoroles:list']();
  },

  'autoroles:remove': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    if (store.getGuildConfig(botId, id).verifyLock) throw new Error("The server is locked behind this Verify button. Unlock it first, or new members couldn't get in.");
    const v = store.getGuildConfig(botId, id).autoroles?.verify;
    if (v?.messageId) await restFor(botId).request('DELETE', `/channels/${v.channelId}/messages/${v.messageId}`).catch(() => {});
    store.setGuildConfig(botId, id, { autoroles: null });
    autoRoleProblems.delete(`${botId}:${id}`);
    syncConnection(botId);
    return handlers['autoroles:list']();
  },

  // Gives the roles to members who don't have them yet, with progress.
  'autoroles:giveExisting': (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    return autoRolesFor(botId).giveExisting(id, (done, total) => send('autoroles:progress', { botId, guildId: id, done, total }));
  },

  // Locking a server behind its Verify button (src/main/verifylock.js): what it would change.
  'verifylock:plan': async (botId, guildId, options = {}) => {
    if (isMod(botId)) ownerOnly();
    return verifyLockPlan(botId, snowflake(guildId, 'server'), options);
  },

  // Backs the server up, gives the verified roles to everyone already here (unless asked not to),
  // then changes the permissions, keeping a record so Unlock can put them back. On a server that's
  // locked already it updates the lock (other channels kept open, new channels covered); the
  // record then holds both, newest first, so Unlock still ends at how it was before the first lock.
  'verifylock:lock': async (botId, guildId, options = {}) => {
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    const earlier = store.getGuildConfig(botId, id).verifyLock || null;
    if (earlier) options = { ...options, giveExisting: false }; // members who haven't verified yet stay out
    const plan = await verifyLockPlan(botId, id, { ...options, fresh: true }); // what the server is like now, not when the window opened
    const rest = restFor(botId);
    const progress = (text) => send('verifylock:progress', { botId, guildId: id, text });
    progress('Making a backup…');
    backups.saveBackup(backupsRoot(), id, await backups.snapshotServer(rest, id, { label: earlier ? 'Before updating the Verify lock' : 'Before locking behind Verify' }));
    const roleIds = plan.verifiedRoles.map((r) => r.id);
    if (options.giveExisting !== false) {
      await verifyLock.giveToMembers(rest, id, roleIds, { reason: 'Already here when the server was locked behind Verify', onProgress: (done, total) => progress(`Giving the role… ${done}/${total}`) });
    }
    progress('Changing permissions…');
    const keep = (record, partial = false) => {
      const merged = earlier
        ? { ...earlier, everyone: earlier.everyone ?? record.everyone, roles: [...earlier.roles, ...record.roles], channels: [...record.channels, ...earlier.channels], updatedAt: record.at }
        : record;
      store.setGuildConfig(botId, id, { verifyLock: { ...merged, partial: partial || !!earlier?.partial, verifyChannelId: plan.verifyChannelId, roleIds } });
    };
    try {
      keep(await verifyLock.applyLock(rest, id, plan, { reason: 'Locked behind the Verify button', onStep: (done, total) => progress(`Changing permissions… ${done}/${total}`) }));
    } catch (err) {
      if (err.record && (err.record.roles.length || err.record.channels.length)) {
        keep(err.record, true);
        throw new Error(`Locking stopped part way: ${err.message} Press Unlock to put back what changed.`);
      }
      throw err;
    }
    return handlers['autoroles:list']();
  },

  'verifylock:unlock': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    const lock = store.getGuildConfig(botId, id).verifyLock;
    if (!lock) throw new Error("This server isn't locked behind Verify.");
    await verifyLock.undoLock(restFor(botId), id, lock, { reason: 'Unlocked from the Verify button' });
    store.setGuildConfig(botId, id, { verifyLock: null });
    return handlers['autoroles:list']();
  },

  // Every announcement of the owner's bots: scheduled first (soonest first), then the newest.
  'announce:list': () =>
    allAnnouncements().sort((a, b) => {
      const soon = (x) => (x.schedule?.on && x.schedule.nextAt ? x.schedule.nextAt : Infinity);
      return soon(a) - soon(b) || (b.lastSentAt || b.createdAt || 0) - (a.lastSentAt || a.createdAt || 0);
    }),

  // Saves an announcement (and its schedule). With send: true it goes out right away as well.
  'announce:save': async (botId, input, { send: sendNow = false } = {}) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const a = announce.normalize(input);
    if (!a.guildId || !a.channelId) throw new Error('Pick the server and channel.');
    const list = store.getGuildConfig(botId, a.guildId).announcements || [];
    const previous = a.id ? list.find((x) => x.id === a.id) : null;
    // Moved to another server (or bot) before it was sent: it's taken out of the one it was in.
    // (Duplicate makes a copy instead.)
    const moved = a.id && !previous ? allAnnouncements().find((x) => x.id === a.id) : null;
    const saved = { ...previous, ...a, id: previous?.id || crypto.randomUUID(), createdAt: previous?.createdAt || moved?.createdAt || Date.now(), missedAt: null, problem: null };
    store.setGuildConfig(botId, a.guildId, { announcements: previous ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved] });
    if (moved) {
      const old = store.getGuildConfig(moved.botId, moved.guildId).announcements || [];
      store.setGuildConfig(moved.botId, moved.guildId, { announcements: old.filter((x) => x.id !== a.id) });
    }
    if (sendNow) {
      const message = await postAnnouncement({ ...saved, botId });
      updateAnnouncement(botId, a.guildId, saved.id, { lastSentAt: Date.now(), lastMessageId: message.id, lastChannelId: saved.channelId });
    }
    return handlers['announce:list']();
  },

  'announce:send': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const a = allAnnouncements().find((x) => x.botId === botId && x.guildId === guildId && x.id === id);
    if (!a) throw new Error("That announcement isn't in the app any more.");
    const message = await postAnnouncement(a);
    const schedule = a.schedule?.on && a.schedule.repeat === 'once' ? { ...a.schedule, on: false, nextAt: null } : a.schedule;
    updateAnnouncement(botId, guildId, id, { lastSentAt: Date.now(), lastMessageId: message.id, lastChannelId: a.channelId, missedAt: null, problem: null, schedule });
    return handlers['announce:list']();
  },

  // Edits the message it posted last to match what's saved now.
  'announce:update': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const a = allAnnouncements().find((x) => x.botId === botId && x.guildId === guildId && x.id === id);
    if (!a) throw new Error("That announcement isn't in the app any more.");
    try {
      await postAnnouncement(a, { edit: true });
    } catch (err) {
      if (err.code === 10008) throw new Error('The message it posted was deleted in Discord. Send it again instead.');
      throw err;
    }
    return handlers['announce:list']();
  },

  'announce:delete': async (botId, guildId, id, deleteMessage) => {
    if (isMod(botId)) ownerOnly();
    const list = store.getGuildConfig(botId, snowflake(guildId, 'server')).announcements || [];
    const a = list.find((x) => x.id === id);
    if (a?.lastMessageId && deleteMessage) await restFor(botId).request('DELETE', `/channels/${a.lastChannelId || a.channelId}/messages/${a.lastMessageId}`).catch(() => {});
    store.setGuildConfig(botId, guildId, { announcements: list.filter((x) => x.id !== id) });
    return handlers['announce:list']();
  },

  'announce:pickImage': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose a picture', filters: [{ name: 'Images', extensions: Object.keys(ANNOUNCE_IMAGE_TYPES) }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return null;
    const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
    if (!ANNOUNCE_IMAGE_TYPES[ext]) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
    if (fs.statSync(filePaths[0]).size > MAX_ANNOUNCE_IMAGE_BYTES) throw new Error('That image is over 8 MB. Pick a smaller one.');
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(announceDir(), { recursive: true });
    fs.copyFileSync(filePaths[0], path.join(announceDir(), name));
    const image = announceImage(name);
    return { file: name, dataUrl: `data:${image.type};base64,${image.data.toString('base64')}` };
  },

  'announce:image': (file) => {
    const image = announceImage(file);
    return image ? `data:${image.type};base64,${image.data.toString('base64')}` : null;
  },

  // Every giveaway of the owner's bots: running and scheduled ones first (soonest first), then drafts
  // and missed ones, then ended ones (newest first).
  'giveaways:list': () => {
    const rank = (g) => (g.endedAt ? 2 : g.messageId || g.start?.on ? 0 : 1);
    const next = (g) => (g.messageId ? g.endsAt : g.start?.at || 0);
    return allGiveaways().sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? next(a) - next(b) : (b.endedAt || b.createdAt || 0) - (a.endedAt || a.createdAt || 0)));
  },

  // Saves a giveaway (and when to post it). With post: true it's posted right away as well. One
  // already posted stays in its channel, and its message is updated to match.
  'giveaways:save': async (botId, input, { post = false } = {}) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) await pullAlways(botId); // so what the portal already did isn't done again
    const before = input?.id ? allGiveaways().find((x) => x.botId === botId && x.id === String(input.id)) : null;
    if (before?.endedAt) throw new Error("This giveaway has ended, so it can't be changed.");
    // Once posted it stays where it is, with the emoji members already reacted with.
    const g = giveaways.normalize(before?.messageId ? { ...input, guildId: before.guildId, channelId: before.channelId, channelName: before.channelName, emoji: before.emoji, start: { on: false } } : input);
    if (!g.guildId || !g.channelId) throw new Error('Pick the server and channel.');
    const list = store.getGuildConfig(botId, g.guildId).giveaways || [];
    const previous = before ? list.find((x) => x.id === before.id) : null;
    const saved = { ...previous, ...g, id: previous?.id || crypto.randomUUID(), createdAt: previous?.createdAt || Date.now(), rev: (previous?.rev || 0) + 1, missedAt: null, problem: null, retryAt: null };
    store.setGuildConfig(botId, g.guildId, { giveaways: previous ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved] });
    send('giveaways:changed', {});
    if (saved.messageId) {
      const { body, files } = giveaways.buildMessage(saved, announceImage(saved.imageFile));
      await restFor(botId)
        .request('PATCH', `/channels/${saved.channelId}/messages/${saved.messageId}`, { body: files ? body : { ...body, attachments: [] }, files })
        .catch((err) => {
          throw err.code === 10008 ? new Error('Saved, but the giveaway message was deleted in Discord.') : err;
        });
    } else if (post) {
      updateGiveaway(botId, g.guildId, saved.id, await giveawayEngine.post({ ...saved, botId }));
    }
    return handlers['giveaways:list']();
  },

  // Posts a draft, scheduled or missed giveaway now.
  'giveaways:post': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) await pullAlways(botId);
    const g = findGiveaway(botId, snowflake(guildId, 'server'), id);
    if (g.messageId) throw new Error('This giveaway has already been posted.');
    if (g.endsAt <= Date.now() + 60 * 1000) throw new Error('Its enter-by time has passed. Edit it to pick a new time first.');
    updateGiveaway(botId, g.guildId, id, await giveawayEngine.post(g));
    return handlers['giveaways:list']();
  },

  // Ends a running giveaway now and picks its winners.
  'giveaways:end': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) await pullAlways(botId);
    const g = findGiveaway(botId, snowflake(guildId, 'server'), id);
    if (!g.messageId) throw new Error("This giveaway hasn't been posted yet.");
    if (g.endedAt) throw new Error('This giveaway has already ended.');
    updateGiveaway(botId, g.guildId, id, await giveawayEngine.draw(g));
    return handlers['giveaways:list']();
  },

  // Picks new winners for the ones given (and for any places left unfilled), from members who haven't won it before.
  'giveaways:reroll': async (botId, guildId, id, replaceIds = []) => {
    if (isMod(botId)) ownerOnly();
    if (alwaysOn(botId)) await pullAlways(botId);
    const g = findGiveaway(botId, snowflake(guildId, 'server'), id);
    if (!g.endedAt || !g.messageId) throw new Error("This giveaway hasn't ended yet.");
    const replace = (Array.isArray(replaceIds) ? replaceIds : []).map(String).filter((x) => (g.winnerList || []).some((w) => w.id === x));
    if (!replace.length && (g.winnerList || []).length >= g.winners) throw new Error('Pick the winners to replace.');
    updateGiveaway(botId, g.guildId, id, await giveawayEngine.draw(g, { replace }));
    return handlers['giveaways:list']();
  },

  'giveaways:delete': async (botId, guildId, id, deleteMessage) => {
    if (isMod(botId)) ownerOnly();
    const gid = snowflake(guildId, 'server');
    const list = store.getGuildConfig(botId, gid).giveaways || [];
    const g = list.find((x) => x.id === id);
    if (g?.messageId && deleteMessage) await restFor(botId).request('DELETE', `/channels/${g.channelId}/messages/${g.messageId}`).catch(() => {});
    store.setGuildConfig(botId, gid, { giveaways: list.filter((x) => x.id !== id) });
    return handlers['giveaways:list']();
  },

  // How many members have entered a running giveaway so far (null when Discord can't say).
  'giveaways:entries': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const g = findGiveaway(botId, snowflake(guildId, 'server'), id);
    return g.messageId ? giveawayEngine.entryCount(g).catch(() => null) : 0;
  },

  // Every server with stats counters, with its latest counts.
  'stats:list': () =>
    store
      .listBots()
      .filter((b) => b.type !== 'mod')
      .flatMap((b) => statsServers(b.id).map(({ guildId, settings: s }) => ({ ...s, botId: b.id, guildId, state: statsState.get(`${b.id}:${guildId}`) || null, membersIntent: !!b.intents?.members }))),

  // Saves a server's counters: makes the category and the channels of counters turned on (named with
  // the counts right away), and deletes the channels of counters turned off.
  'stats:save': async (botId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const s = stats.normalizeSettings(input);
    if (!s.guildId) throw new Error('Pick the server.');
    const rest = restFor(botId);
    const previous = store.getGuildConfig(botId, s.guildId).stats || null;
    const { channels, counts } = await stats.countBasics(rest, s.guildId);
    // Members see the counters but can't join them.
    const locked = [{ id: s.guildId, type: 0, allow: '0', deny: String(stats.CONNECT) }];
    if (input?.createCategory) {
      const cat = await rest.request('POST', `/guilds/${s.guildId}/channels`, { body: { name: '📊 Server Stats', type: 4, position: 0, permission_overwrites: locked }, reason: 'Server stats' });
      Object.assign(s, { categoryId: cat.id, categoryName: cat.name, madeCategory: true });
    } else s.madeCategory = !!(previous?.madeCategory && previous.categoryId === s.categoryId);

    const find = (id) => (id ? channels.find((c) => c.id === id) : null);
    for (const [key] of stats.COUNTERS) {
      const c = s.counters[key];
      const was = find(previous?.counters?.[key]?.channelId);
      if (c.on && was) {
        c.channelId = was.id;
        if ((was.parent_id || '') !== s.categoryId) await rest.request('PATCH', `/channels/${was.id}`, { body: { parent_id: s.categoryId || null }, reason: 'Server stats' });
      } else if (c.on) {
        const made = await rest.request('POST', `/guilds/${s.guildId}/channels`, { body: { name: stats.channelName(c.name, counts[key], s.format), type: 2, parent_id: s.categoryId || undefined, permission_overwrites: locked }, reason: 'Server stats counter' });
        c.channelId = made.id;
      } else {
        if (was) await rest.request('DELETE', `/channels/${was.id}`, { reason: 'Server stats counter turned off' });
        c.channelId = '';
      }
    }
    store.setGuildConfig(botId, s.guildId, { stats: s });
    syncConnection(botId);
    // Fills in bots and users (they need the member list) and any changed names.
    await statsFor(botId).refresh(s.guildId, s, { force: true }).catch(() => {});
    return handlers['stats:list']();
  },

  'stats:remove': async (botId, guildId, deleteChannels) => {
    if (isMod(botId)) ownerOnly();
    const id = snowflake(guildId, 'server');
    const s = store.getGuildConfig(botId, id).stats;
    if (s && deleteChannels) {
      const rest = restFor(botId);
      for (const c of Object.values(s.counters)) if (c.channelId) await rest.request('DELETE', `/channels/${c.channelId}`, { reason: 'Server stats removed' }).catch(() => {});
      if (s.madeCategory && s.categoryId) await rest.request('DELETE', `/channels/${s.categoryId}`, { reason: 'Server stats removed' }).catch(() => {});
    }
    store.setGuildConfig(botId, id, { stats: null });
    statsFor(botId).forget(id);
    statsState.delete(`${botId}:${id}`);
    syncConnection(botId);
    return handlers['stats:list']();
  },

  'stats:refresh': async (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    const s = store.getGuildConfig(botId, snowflake(guildId, 'server')).stats;
    if (!s) throw new Error("This server's stats aren't set up any more.");
    await statsFor(botId).refresh(guildId, s, { force: true });
    return handlers['stats:list']();
  },

  // Every ticket panel of the owner's bots, with who answers its buttons.
  'tickets:list': () =>
    store
      .listBots()
      .filter((b) => b.type !== 'mod')
      .flatMap((b) => ticketPanelsOf(b.id).map((p) => ({ ...p, answeredBy: b.slashCommands ? 'portal' : 'app' }))),

  // Saves a panel: makes the log channel and category if asked, keeps the settings message in the log
  // channel up to date (open tickets point at it), and posts or updates the panel.
  'tickets:save': async (botId, input) => {
    if (!store.getBot(botId)) throw new Error('That bot is no longer in the app.');
    if (isMod(botId)) ownerOnly();
    const s = tickets.normalizeSettings(input);
    if (!s.guildId) throw new Error('Pick the server.');
    if (!s.panel.channelId) throw new Error('Pick the channel for the ticket panel.');
    const rest = restFor(botId);
    const list = store.getGuildConfig(botId, s.guildId).ticketPanels || [];
    const previous = s.id ? list.find((p) => p.id === s.id) || null : null;
    const ow = (id, type, allow, deny = 0n) => ({ id, type, allow: String(allow), deny: String(deny) });
    const { P } = tickets;

    if (input?.createLogChannel) {
      const ch = await rest.request('POST', `/guilds/${s.guildId}/channels`, {
        body: { name: 'ticket-logs', type: 0, topic: 'Closed tickets and their transcripts.', permission_overwrites: [ow(s.guildId, 0, 0n, P.VIEW), ...s.supportRoles.map((r) => ow(r, 0, tickets.LOG_READ)), ow(botId, 1, tickets.MEMBER_ALLOW)] },
        reason: 'Ticket log channel',
      });
      Object.assign(s, { logChannelId: ch.id, logChannelName: ch.name });
    }
    if (!s.logChannelId) throw new Error('Pick the ticket log channel, or let the app make one.');
    if (input?.createCategory) {
      const cat = await rest.request('POST', `/guilds/${s.guildId}/channels`, { body: { name: 'Tickets', type: 4, permission_overwrites: [ow(s.guildId, 0, 0n, P.VIEW), ow(botId, 1, tickets.MEMBER_ALLOW)] }, reason: 'Ticket category' });
      Object.assign(s, { categoryId: cat.id, categoryName: cat.name });
    }

    const files = [{ name: tickets.SETTINGS_FILE, data: tickets.settingsFile(s), type: 'application/json' }];
    let settingsMessageId = previous?.logChannelId === s.logChannelId ? previous.settingsMessageId : null;
    if (settingsMessageId) {
      try {
        await rest.request('PATCH', `/channels/${s.logChannelId}/messages/${settingsMessageId}`, { body: { content: tickets.settingsNote(s), allowed_mentions: { parse: [] } }, files });
      } catch (err) {
        if (err.code !== 10008 && err.status !== 404) throw err;
        settingsMessageId = null; // deleted: post it again
      }
    }
    if (!settingsMessageId) {
      settingsMessageId = (await rest.request('POST', `/channels/${s.logChannelId}/messages`, { body: { content: tickets.settingsNote(s), allowed_mentions: { parse: [] } }, files })).id;
      await rest.request('PUT', `/channels/${s.logChannelId}/pins/${settingsMessageId}`).catch(() => {});
    }

    const ref = { logChannelId: s.logChannelId, settingsId: settingsMessageId };
    const panelMessageId = await reactionRoles.publishMessage(
      rest,
      { channelId: s.panel.channelId, body: tickets.panelMessage(s, ref), emojis: [] },
      previous && { channelId: previous.panel.channelId, messageId: previous.panelMessageId, emojis: [] },
    );
    const saved = { ...s, id: previous?.id || crypto.randomUUID(), settingsMessageId, panelMessageId, createdAt: previous?.createdAt || Date.now() };
    store.setGuildConfig(botId, s.guildId, { ticketPanels: previous ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved] });
    syncConnection(botId);
    return handlers['tickets:list']();
  },

  // Removes a panel. Its settings message stays, so tickets that are still open can be closed.
  'tickets:delete': async (botId, guildId, id, deletePanel) => {
    if (isMod(botId)) ownerOnly();
    const list = store.getGuildConfig(botId, snowflake(guildId, 'server')).ticketPanels || [];
    const panel = list.find((p) => p.id === id);
    if (panel?.panelMessageId && deletePanel) await restFor(botId).request('DELETE', `/channels/${panel.panel.channelId}/messages/${panel.panelMessageId}`).catch(() => {});
    store.setGuildConfig(botId, guildId, { ticketPanels: list.filter((p) => p.id !== id) });
    syncConnection(botId);
    return handlers['tickets:list']();
  },

  // Open tickets (from the server's channels) and closed ones (from the log channel), newest first.
  'tickets:history': async (botId, guildId, id) => {
    if (isMod(botId)) ownerOnly();
    const panel = (store.getGuildConfig(botId, snowflake(guildId, 'server')).ticketPanels || []).find((p) => p.id === id);
    if (!panel) throw new Error("That panel isn't in the app any more.");
    const rest = restFor(botId);
    const channels = await rest.request('GET', `/guilds/${guildId}/channels`);
    const open = channels
      .map((c) => ({ c, info: tickets.parseTopic(c.topic) }))
      .filter(({ info }) => info)
      .map(({ c, info }) => ({ channelId: c.id, name: c.name, userId: info.userId, claimedBy: info.claimedBy, openedAt: Number((BigInt(c.id) >> 22n) + 1420070400000n) }))
      .sort((a, b) => b.openedAt - a.openedAt);
    const logs = [];
    let before;
    for (let page = 0; page < 3; page++) {
      const batch = await rest.request('GET', `/channels/${panel.logChannelId}/messages`, { query: { limit: 100, before } }).catch((err) => {
        if (page === 0) throw new Error(`Couldn't read the log channel: ${err.message}`);
        return [];
      });
      logs.push(...batch);
      if (batch.length < 100) break;
      before = batch[batch.length - 1].id;
    }
    const closed = logs.filter((m) => m.author?.id === botId && /^Ticket \d{15,21}$/.test(m.embeds?.[0]?.footer?.text || '')).map(closedTicket);
    const ids = [...new Set([...open.flatMap((t) => [t.userId, t.claimedBy]), ...closed.flatMap((t) => [t.openedBy, t.claimedBy, t.closedBy])].filter(Boolean))].slice(0, 60);
    const users = Object.fromEntries(await Promise.all(ids.map(async (u) => [u, await userName(rest, u)])));
    return { open, closed, users, logChannelId: panel.logChannelId };
  },

  'tickets:transcript': (botId, logChannelId, messageId) => {
    if (isMod(botId)) ownerOnly();
    return ticketTranscript(botId, logChannelId, messageId).then((t) => t.html);
  },

  'tickets:saveTranscript': async (botId, logChannelId, messageId) => {
    if (isMod(botId)) ownerOnly();
    const { name, html } = await ticketTranscript(botId, logChannelId, messageId);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Save the transcript', defaultPath: name, filters: [{ name: 'Web page', extensions: ['html'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, html);
    return filePath;
  },

  'social:get': () => socialStatus(),

  'social:setClientId': (clientId) => {
    const id = String(clientId || '').trim();
    if (id && !/^[a-z0-9]{10,64}$/i.test(id)) throw new Error("That doesn't look like a Twitch Client ID (letters and numbers only).");
    if (id !== store.getSocial().clientId) {
      store.saveSocial({ clientId: id, account: null });
      store.setTwitchTokens(null); // a login belongs to the Client ID it was made with
      twitchClient = null;
    }
    return socialStatus();
  },

  // A YouTube Data API key, so YouTube alerts don't depend on the public feed. It's tried before it's saved.
  'social:setYouTubeKey': async (key) => {
    const value = String(key || '').trim();
    if (value) {
      if (!/^[\w-]{30,60}$/.test(value)) throw new Error("That doesn't look like a YouTube API key (they start with AIza).");
      await social.checkYouTubeKey(value, fetch);
    }
    store.setYouTubeKey(value);
    // Check the YouTube alerts again now, the new way.
    const { alerts } = store.getSocial();
    store.saveSocial({ alerts: alerts.map((a) => (a.platform === 'youtube' ? { ...a, state: { ...a.state, checkedAt: 0 } } : a)) });
    setTimeout(() => socialWatcher.tick().catch(() => {}), 500);
    return socialStatus();
  },

  // "Log in with Twitch": Twitch shows a code the user confirms in their browser.
  'social:twitchLoginStart': async () => {
    const clientId = twitchClientId();
    if (!clientId) throw new Error('Add your Twitch Client ID first.');
    if (twitchLogin) twitchLogin.cancelled = true;
    const login = await social.twitchStartLogin(clientId, fetch);
    twitchLogin = { clientId, login, cancelled: false };
    return { userCode: login.userCode, verificationUri: login.verificationUri, expiresAt: login.expiresAt };
  },

  'social:twitchLoginWait': async () => {
    const attempt = twitchLogin;
    if (!attempt) throw new Error('Start the Twitch login first.');
    try {
      const tokens = await social.twitchFinishLogin(attempt.clientId, attempt.login, fetch, { sleep, cancelled: () => attempt.cancelled });
      store.setTwitchTokens(tokens);
      twitchClient = null;
      const me = await getTwitch().me();
      store.saveSocial({ account: { id: me.id, login: me.login, name: me.display_name, avatar: me.profile_image_url || null } });
      return socialStatus();
    } finally {
      if (twitchLogin === attempt) twitchLogin = null;
    }
  },

  'social:twitchLoginCancel': () => {
    if (twitchLogin) twitchLogin.cancelled = true;
  },

  'social:twitchLogout': async () => {
    const tokens = store.getTwitchTokens();
    const clientId = twitchClientId();
    // Tell Twitch to forget the token too; the local logout happens either way.
    if (tokens?.access && clientId) await fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, token: tokens.access }).toString() }).catch(() => {});
    store.setTwitchTokens(null);
    store.saveSocial({ account: null });
    twitchClient = null;
    return socialStatus();
  },

  // Turns what the owner typed (a link, @handle or channel name) into the channel to watch.
  'social:resolve': async (platform, input) => {
    if (platform === 'youtube') return social.resolveYouTubeChannel(input, fetch, { apiKey: store.getYouTubeKey() });
    if (platform === 'github') return social.resolveGitHubSource(input, fetch);
    if (platform !== 'twitch') throw new Error('Unknown platform.');
    const twitch = getTwitch();
    if (!twitch) throw new Error('Log in with Twitch first.');
    const [user] = await twitch.users([twitchLoginName(input)]);
    if (!user) throw new Error("There's no Twitch channel with that name.");
    return { id: user.id, login: user.login, name: user.display_name, url: `https://www.twitch.tv/${user.login}`, avatar: user.profile_image_url || null };
  },

  'social:saveAlert': (input) => {
    const a = input || {};
    if (!['youtube', 'twitch', 'github'].includes(a.platform)) throw new Error('Pick YouTube, Twitch or GitHub.');
    const bot = store.getBot(String(a.botId));
    if (!bot || bot.type === 'mod') throw new Error('Pick one of your bots.');
    const id = String(a.source?.id || '');
    const kind = a.source?.kind === 'repo' ? 'repo' : 'user';
    const sourceOk = { youtube: /^UC[\w-]{22}$/, twitch: /^\d{1,20}$/, github: kind === 'repo' ? /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/ : /^[A-Za-z0-9-]{1,39}$/ }[a.platform].test(id);
    if (!sourceOk) throw new Error(a.platform === 'github' ? 'Check the GitHub link first.' : 'Check the channel first.');
    // GitHub: releases, and new repos (an account only).
    const events = a.platform === 'github' ? { releases: a.events?.releases !== false, repos: kind === 'user' && a.events?.repos !== false } : undefined;
    if (events && !events.releases && !events.repos) throw new Error('Pick releases, new repos, or both.');
    const mention = ['none', 'everyone', 'here'].includes(a.mention) || /^\d{15,21}$/.test(String(a.mention)) ? String(a.mention) : 'none';
    const { alerts } = store.getSocial();
    const existing = alerts.find((x) => x.id === a.id);
    const alert = {
      id: existing?.id || crypto.randomUUID(),
      platform: a.platform,
      botId: bot.id,
      guildId: snowflake(a.guildId, 'server'),
      guildName: String(a.guildName || '').slice(0, 100),
      channelId: snowflake(a.channelId, 'channel'),
      channelName: String(a.channelName || '').slice(0, 100),
      source: { id: a.source.id, name: String(a.source.name || a.source.id).slice(0, 100), login: a.source.login || null, url: String(a.source.url || '').slice(0, 200), avatar: a.source.avatar || null, ...(a.platform === 'github' ? { kind } : {}) },
      message: String(a.message || '').slice(0, 1000),
      ...(events ? { events, repoMessage: String(a.repoMessage || '').slice(0, 1000) } : {}),
      mention,
      mentionName: /^\d/.test(mention) ? String(a.mentionName || '').slice(0, 100) : '',
      shorts: a.shorts !== false,
      enabled: a.enabled !== false,
      createdAt: existing?.createdAt || Date.now(),
      // A different channel to watch starts fresh, so its old videos or a stream in progress aren't posted.
      state: existing && existing.source.id === a.source.id && existing.platform === a.platform ? existing.state : {},
    };
    if (!existing || existing.source.id !== alert.source.id) alert.createdAt = Date.now();
    store.saveSocial({ alerts: existing ? alerts.map((x) => (x.id === alert.id ? alert : x)) : [...alerts, alert] });
    setTimeout(() => socialWatcher.tick().catch(() => {}), 2000);
    return socialStatus();
  },

  'social:setEnabled': (id, enabled) => {
    updateAlert(String(id), { enabled: !!enabled });
    return socialStatus();
  },

  'social:removeAlert': (id) => {
    store.saveSocial({ alerts: store.getSocial().alerts.filter((a) => a.id !== id) });
    return socialStatus();
  },

  // Posts what an alert looks like, with the latest video or the stream, without pinging anyone.
  'social:test': async (id) => {
    const alert = store.getSocial().alerts.find((a) => a.id === id);
    if (!alert) throw new Error('That alert no longer exists.');
    let message;
    if (alert.platform === 'youtube') {
      const feed = await social.fetchYouTubeVideos(alert.source.id, { apiKey: store.getYouTubeKey(), fetchImpl: fetch });
      let video = null;
      for (const v of feed.videos.slice(0, 5)) {
        if (alert.shorts !== false || !(v.isShort ?? (await social.isYouTubeShort(v.id, fetch)))) {
          video = v;
          break;
        }
      }
      if (!video) throw new Error(feed.videos.length ? 'Its latest videos are all Shorts, which this alert leaves out.' : 'This channel has no videos to show in a test yet.');
      message = social.youtubeMessage(alert, feed.name || alert.source.name, video);
    } else if (alert.platform === 'github') {
      const wanted = social.githubEventsOf(alert);
      const event = (await social.fetchGitHubEvents(alert.source, fetch)).find((e) => (e.kind === 'repo' ? wanted.repos : wanted.releases));
      if (!event) throw new Error(alert.source.kind === 'repo' ? 'This repo has no releases to show in a test yet.' : 'There are no recent releases or new repos to show in a test yet.');
      message = social.githubMessage(alert, event);
    } else {
      const twitch = getTwitch();
      if (!twitch) throw new Error('Log in with Twitch first.');
      const [stream] = await twitch.streams([alert.source.id]);
      message = social.twitchMessage(alert, stream || { user_login: alert.source.login, user_name: alert.source.name, title: 'Test alert: this is how it looks when they go live', game_name: 'Just Chatting', viewer_count: null, thumbnail_url: null });
    }
    await postAlert(alert, { ...message, content: `🧪 **Test alert** (nobody was pinged)\n${message.content}`.slice(0, 2000), allowed_mentions: { parse: [] } });
  },

  'backups:list': (guildId) => backups.listBackups(backupsRoot(), snowflake(guildId, 'server')),

  'backups:create': async (botId, guildId, label) => {
    if (isMod(botId)) ownerOnly();
    const snap = await backups.snapshotServer(restFor(botId), snowflake(guildId, 'server'), { label });
    backups.saveBackup(backupsRoot(), guildId, snap);
    return backups.listBackups(backupsRoot(), guildId);
  },

  // Moves the file to the Recycle Bin rather than deleting it outright.
  'backups:delete': async (guildId, id) => {
    await shell.trashItem(backups.backupFile(backupsRoot(), guildId, id));
    return backups.listBackups(backupsRoot(), guildId);
  },

  'backups:setAuto': (botId, guildId, enabled) => {
    if (isMod(botId)) ownerOnly();
    const config = store.setGuildConfig(botId, snowflake(guildId, 'server'), { autoBackup: !!enabled });
    if (enabled) setTimeout(runAutoBackups, 1000);
    return config;
  },

  // What a restore would do, without changing anything.
  'backups:plan': async (botId, guildId, id, opts) => {
    if (isMod(botId)) ownerOnly();
    const backup = backups.readBackup(backupsRoot(), guildId, id);
    const { planned } = await backups.restoreBackup(restFor(botId), guildId, backup, { ...opts, dryRun: true });
    return planned;
  },

  'backups:restore': async (botId, guildId, id, opts) => {
    if (isMod(botId)) ownerOnly();
    const rest = restFor(botId);
    const backup = backups.readBackup(backupsRoot(), guildId, id);
    const emit = (event) => send('backup:event', { botId, guildId, ...event });
    const { planned } = await backups.restoreBackup(rest, guildId, backup, { ...opts, dryRun: true });
    emit({ type: 'start', total: planned.length });
    const stats = await backups.restoreBackup(rest, guildId, backup, { ...opts, dryRun: false }, emit);
    emit({ type: 'done', stats });
    return stats;
  },

  'backups:export': async (guildId, id) => {
    const backup = backups.readBackup(backupsRoot(), guildId, id);
    const safeName = `${backup.guild.name.replace(/[^\w\- ]+/g, '').trim() || 'server'} backup ${backup.takenAt.slice(0, 10)}`;
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Export backup', defaultPath: `${safeName}.json`, filters: [{ name: 'Server backup', extensions: ['json'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
    return filePath;
  },

  // A backup file from anywhere (another PC, another server) can be restored into this server.
  'backups:import': async (guildId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Import backup', filters: [{ name: 'Server backup', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return null;
    const backup = backups.validateBackup(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
    backups.saveBackup(backupsRoot(), snowflake(guildId, 'server'), { ...backup, auto: false }, 'imported');
    return backups.listBackups(backupsRoot(), guildId);
  },

  // Channels a lockdown locked, so ending it only unlocks those (null when there's no lockdown).
  'raid:saveLockdown': (botId, guildId, lockdown) => {
    const valid = lockdown && Array.isArray(lockdown.channels) ? { at: Number(lockdown.at) || Date.now(), channels: lockdown.channels.map(String).filter((id) => /^\d{15,21}$/.test(id)) } : null;
    return store.setGuildConfig(botId, snowflake(guildId, 'server'), { lockdown: valid });
  },

  // Bans many members at once. Owners use Discord's bulk ban (200 per request, needs Manage Server)
  // and fall back to one at a time; moderators go one at a time through their portal. Not recorded as
  // cases (a raid would flood #mod-cases); the audit log has them.
  'raid:ban': async (botId, guildId, userIds, deleteSeconds, reason) => {
    snowflake(guildId, 'server');
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter((id) => /^\d{15,21}$/.test(id)).slice(0, 1000);
    const seconds = Math.min(Math.max(0, Number(deleteSeconds) || 0), 604800);
    const why = typeof reason === 'string' ? reason.slice(0, 400) : '';
    const result = { banned: [], failed: [] };
    const progress = () => send('raid:progress', { botId, guildId, done: result.banned.length + result.failed.length, total: ids.length });
    if (!isMod(botId)) {
      try {
        for (let i = 0; i < ids.length; i += 200) {
          const res = await restFor(botId).request('POST', `/guilds/${guildId}/bulk-ban`, { body: { user_ids: ids.slice(i, i + 200), delete_message_seconds: seconds }, reason: why });
          result.banned.push(...(res?.banned_users || []));
          result.failed.push(...(res?.failed_users || []));
          progress();
        }
        return result;
      } catch (err) {
        if (err.status !== 403 || result.banned.length || result.failed.length) throw err;
      }
    }
    for (const id of ids) {
      try {
        const body = { delete_message_seconds: seconds };
        if (isMod(botId)) await modCall(botId, '/api/discord', { method: 'PUT', path: `/guilds/${guildId}/bans/${id}`, body, reason: why, noCase: true });
        else await restFor(botId).request('PUT', `/guilds/${guildId}/bans/${id}`, { body, reason: why });
        result.banned.push(id);
      } catch {
        result.failed.push(id);
      }
      progress();
    }
    return result;
  },

  'cases:list': (botId, guildId, userId) => {
    if (isMod(botId)) return modCall(botId, '/api/cases', { guildId, userId });
    return casesFor(botId).list({ id: snowflake(guildId, 'server') }, snowflake(userId, 'user'));
  },

  'cases:warn': async (botId, guildId, userId, reason) => {
    if (isMod(botId)) return modCall(botId, '/api/warn', { guildId, userId, reason });
    const text = String(reason || '').trim().slice(0, 400);
    if (!text) throw new Error('Give a reason for the warning.');
    const rest = restFor(botId);
    const [{ guild, roles }, member] = await Promise.all([guildAndRoles(rest, snowflake(guildId, 'server')), rest.request('GET', `/guilds/${guildId}/members/${snowflake(userId, 'user')}`)]);
    if (member.user.bot) throw new Error("Bots can't be warned.");
    return warnMember(rest, casesFor(botId), {
      guild,
      roles,
      member: { id: member.user.id, label: member.nick || member.user.global_name || member.user.username },
      moderator: { id: botId },
      reason: text,
    });
  },

  'members:all': (botId, guildId, max) =>
    isMod(botId) ? modCall(botId, '/api/members-all', { guildId, max }) : fetchAllMembers(restFor(botId), guildId, max),

  'channel:purge': (botId, channelId, count, reason) => {
    const n = Math.min(Math.max(1, count | 0), 1000);
    return isMod(botId) ? modCall(botId, '/api/purge', { channelId, count: n, reason }) : purgeMessages(restFor(botId), channelId, n, reason);
  },

  // notice: also tell members in the channel why (a single lock from the Channels tab, not a lockdown).
  'channel:lock': async (botId, guildId, channelId, locked, reason, notice = false) => {
    if (isMod(botId)) return modCall(botId, '/api/lock', { guildId, channelId, locked, reason, notice });
    if (notice) return (await lockWithNotice(restFor(botId), guildId, channelId, locked, reason, reason)).channel;
    return setChannelLock(restFor(botId), guildId, channelId, locked, reason);
  },

  'builder:run': (botId, guildId, template, opts) => {
    if (isMod(botId)) ownerOnly();
    return buildServer(restFor(botId), guildId, template, opts, (event) => send('builder:event', { botId, guildId, ...event }));
  },

  'builder:clone': (botId, guildId) => {
    if (isMod(botId)) ownerOnly();
    return cloneServer(restFor(botId), guildId);
  },

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
    watchReleases();
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

  'update:check': () => updater.checkForUpdate(),

  'update:install': async () => {
    const file = await updater.installUpdate((received, total) => send('update:progress', { received, total }), {
      onRetry: (retrying) => send('update:progress', { retrying }),
    });
    // Give the UI a moment to show "Restarting…" before this window closes.
    setTimeout(() => updater.restartInto(file), 400);
    return { file };
  },

  'open:external': (url) => {
    if (!isSafeUrl(url)) throw new Error('Blocked link.');
    return shell.openExternal(url);
  },

  'app:info': () => ({
    version: app.getVersion(),
    dataPath: app.getPath('userData'),
    releasesUrl: updater.RELEASES_PAGE,
    modPortalUrl: pkg.modPortalUrl || '',
  }),
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
  updater.repairShortcuts();
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

  // The close button hides the window to the tray so bots stay online; Quit is in the tray menu.
  createTray();
  win.on('closed', closeCardWindow); // or the hidden card window would keep the app running
  win.on('session-end', noteClosing); // Windows shutting down or signing out skips before-quit
  win.on('close', (event) => {
    if (quitting || !settings.closeToTray) return;
    event.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: `${settings.appName} is still running`,
        content: 'Your bots stay online. Click the tray icon to open it again, or right-click it and choose Quit.',
      });
    }
  });

  // Bring bots that were online last session back online, and start their server logs.
  for (const bot of store.listBots()) {
    if (bot.type !== 'mod' && (bot.presence?.enabled || needsGateway(bot.id))) {
      try {
        syncConnection(bot.id);
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
    if (win) showWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
    noteClosing();
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    createWindow();
    watchReleases();
    // Server stats: each server is refreshed every 5 minutes (the engine paces itself).
    setTimeout(tickStats, 30 * 1000);
    setInterval(tickStats, 60 * 1000);
    // Scheduled announcements and giveaways go out, and giveaways are drawn, within a few seconds of their time.
    setTimeout(() => announcer.tick().catch(() => {}), 10 * 1000);
    setInterval(() => announcer.tick().catch(() => {}), 5 * 1000);
    setTimeout(() => giveawayEngine.tick().catch(() => {}), 10 * 1000);
    setInterval(() => giveawayEngine.tick().catch(() => {}), 5 * 1000);
    setTimeout(runAutoBackups, 60 * 1000);
    setInterval(runAutoBackups, 30 * 60 * 1000);
    // Social alerts: YouTube channels are checked every 5 minutes and Twitch every minute (the watcher paces itself).
    // The Social alerts page is told only when a check changed something.
    const checkSocial = () => {
      const before = JSON.stringify(store.getSocial());
      return socialWatcher.tick().then(
        () => JSON.stringify(store.getSocial()) !== before && send('social:changed', {}),
        (err) => console.error('Social alerts:', err.message),
      );
    };
    setTimeout(checkSocial, 15 * 1000);
    setInterval(checkSocial, 60 * 1000);
    // 24/7: save anything that didn't reach the portal last time, then read back what it did.
    setTimeout(() => {
      for (const bot of store.listBots()) if (alwaysOn(bot.id)) saveAlways(bot.id).catch(() => {});
      pullAllAlways();
    }, 8 * 1000);
    setInterval(pullAllAlways, ALWAYS_PULL_MS);
  });
  app.on('window-all-closed', () => {
    for (const conn of presences.values()) conn.stop();
    app.quit();
  });
}
