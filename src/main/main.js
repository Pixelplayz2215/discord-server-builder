const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const { DiscordRest } = require('./discord');
const { PresenceConnection } = require('./gateway');
const store = require('./store');
const Appearance = require('../shared/appearance');
const { buildServer, cloneServer, fetchAllMembers, purgeMessages, setChannelLock } = require('./builder');
const updater = require('./updater');
const portal = require('./portal');
const commands = require('./commands');
const { createCases, caseFromCall, warnMember, privateChannel } = require('./cases');
const backups = require('./backup');
const { createServerLogger, intentsFor: logIntents, normalizeConfig: normalizeLogConfig } = require('./logs');
const social = require('./social');
const reactionRoles = require('./reactionroles');
const polls = require('./polls');
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

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(settings.appName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${settings.appName}`, click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.on('click', showWindow);
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

const socialWatcher = social.createSocialWatcher({
  getAlerts: () => store.getSocial().alerts,
  updateState: (id, state) => updateAlert(id, { state }),
  post: postAlert,
  getTwitch,
  fetchImpl: fetch,
});

function socialStatus() {
  const data = store.getSocial();
  return {
    alerts: data.alerts,
    defaults: social.DEFAULT_MESSAGES,
    twitch: { builtInClientId: !!pkg.twitchClientId, clientId: pkg.twitchClientId ? '' : data.clientId, account: data.account, loggedIn: !!store.getTwitchTokens() },
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
// moderator. Runs in the background; a failure is reported to the UI without undoing the action.
function recordCall(botId, method, apiPath, { body, reason }) {
  const found = caseFromCall(method, apiPath, body);
  if (!found) return;
  (async () => {
    const rest = restFor(botId);
    const user = await rest.request('GET', `/users/${found.memberId}`).catch(() => null);
    const { guild, roles } = await guildAndRoles(rest, found.guildId);
    await casesFor(botId).record(guild, roles, {
      type: found.type,
      member: { id: found.memberId, label: user ? user.global_name || user.username : found.memberId },
      moderator: { id: botId },
      reason: typeof reason === 'string' ? reason.slice(0, 400) : '',
      duration: found.duration,
    });
  })().catch((err) => send('cases:error', { botId, message: err.message }));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const connectionStates = new Map(); // botId -> { state, detail }

function presenceFor(botId) {
  if (!presences.has(botId)) {
    const onState = (state, detail) => {
      connectionStates.set(botId, { state, detail });
      // Connected only for server logs or reaction roles: the bot stays invisible to members.
      const shown = state === 'online' && !store.getBot(botId)?.presence?.enabled ? 'invisible' : state;
      send('presence:state', { botId, state: shown, detail });
    };
    const onEvent = (type, data) => {
      loggerFor(botId).handle(type, data);
      reactionsFor(botId).handle(type, data)?.catch?.(() => {});
      pollsFor(botId).handle(type, data)?.catch?.(() => {});
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

// Whether a bot needs its gateway connection for server logs, reaction roles or polls.
const needsGateway = (botId) => activeLogs(botId).length > 0 || watchesReactions(botId);

// One gateway connection per bot: it keeps the bot online (when presence is on) and receives the
// events for server logs, reaction roles and polls. With those on but presence off, it connects invisibly.
function syncConnection(botId) {
  const bot = store.getBot(botId);
  if (!bot || bot.type === 'mod') return;
  const logs = activeLogs(botId);
  const reactions = watchesReactions(botId);
  const conn = presenceFor(botId);
  loggerFor(botId);
  loggers.get(botId).content = !!bot.intents?.content;
  conn.setIntents((logs.length ? logIntents(logs, bot.intents) : 0) | (reactions ? reactionRoles.RR_INTENTS : 0));
  if (bot.presence?.enabled) conn.start(bot.presence);
  else if (logs.length || reactions) conn.start({ status: 'invisible', text: '' });
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

const SAFE_HOSTS = ['discord.com', 'support.discord.com', 'discord.dev', 'pixelplayz.org', 'github.com', 'render.com', 'twitch.tv', 'youtube.com'];
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
    loggers.delete(bot.id);
    presences.get(bot.id)?.stop();
    presences.delete(bot.id);
    if (needsGateway(bot.id)) syncConnection(bot.id);
    return bot;
  },

  'bots:refresh': async (botId) => {
    const bot = store.getBot(botId);
    if (bot?.type !== 'mod') {
      const updated = store.updateBot(botId, await describeBot(restFor(botId)));
      // Privileged intents may have been switched on or off in the Developer Portal since.
      if (needsGateway(botId)) syncConnection(botId);
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
      throw new Error("Discord couldn't verify your portal. Make sure it runs this bot's token and has the latest code: on GitHub, press Sync fork, then wait for Render to finish deploying.");
    }
    await commands.registerCommands(rest, application.id);
    return noteSlashCommands(botId, await slashStatus(rest));
  },

  // Removes the mod commands, and stops sending interactions to the portal if they go there.
  'commands:disable': async (botId, portalUrl) => {
    if (isMod(botId)) ownerOnly();
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
    caseLogs.delete(botId);
    reactionEngines.delete(botId);
    pollEngines.delete(botId);
    loggers.delete(botId);
    store.removeBot(botId);
  },

  'bots:reorder': (ids) => store.reorderBots(ids),

  'presence:set': (botId, presence) => {
    if (isMod(botId)) ownerOnly();
    const bot = store.updateBot(botId, { presence });
    syncConnection(botId);
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
    const result = await restFor(botId).request(method, apiPath, opts);
    if (!opts.noCase) recordCall(botId, method, apiPath, opts);
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
    if (platform === 'youtube') return social.resolveYouTubeChannel(input, fetch);
    if (platform !== 'twitch') throw new Error('Unknown platform.');
    const twitch = getTwitch();
    if (!twitch) throw new Error('Log in with Twitch first.');
    const [user] = await twitch.users([twitchLoginName(input)]);
    if (!user) throw new Error("There's no Twitch channel with that name.");
    return { id: user.id, login: user.login, name: user.display_name, url: `https://www.twitch.tv/${user.login}`, avatar: user.profile_image_url || null };
  },

  'social:saveAlert': (input) => {
    const a = input || {};
    if (!['youtube', 'twitch'].includes(a.platform)) throw new Error('Pick YouTube or Twitch.');
    const bot = store.getBot(String(a.botId));
    if (!bot || bot.type === 'mod') throw new Error('Pick one of your bots.');
    const sourceOk = a.platform === 'youtube' ? /^UC[\w-]{22}$/.test(a.source?.id || '') : /^\d{1,20}$/.test(a.source?.id || '');
    if (!sourceOk) throw new Error('Check the channel first.');
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
      source: { id: a.source.id, name: String(a.source.name || a.source.id).slice(0, 100), login: a.source.login || null, url: String(a.source.url || '').slice(0, 200), avatar: a.source.avatar || null },
      message: String(a.message || '').slice(0, 1000),
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
      const feed = await social.fetchYouTubeFeed(alert.source.id, fetch);
      const video = feed.videos.find((v) => alert.shorts !== false || !v.isShort);
      if (!video) throw new Error('This channel has no videos to show in a test yet.');
      message = social.youtubeMessage(alert, feed.name || alert.source.name, video);
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

  'channel:lock': (botId, guildId, channelId, locked, reason) =>
    isMod(botId)
      ? modCall(botId, '/api/lock', { guildId, channelId, locked, reason })
      : setChannelLock(restFor(botId), guildId, channelId, locked, reason),

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
    const file = await updater.installUpdate((received, total) => send('update:progress', { received, total }));
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
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    createWindow();
    setTimeout(runAutoBackups, 60 * 1000);
    setInterval(runAutoBackups, 30 * 60 * 1000);
    // Social alerts: YouTube channels are checked every 5 minutes and Twitch every minute (the watcher paces itself).
    const checkSocial = () => socialWatcher.tick().then(() => send('social:changed', {}), (err) => console.error('Social alerts:', err.message));
    setTimeout(checkSocial, 15 * 1000);
    setInterval(checkSocial, 60 * 1000);
  });
  app.on('window-all-closed', () => {
    for (const conn of presences.values()) conn.stop();
    app.quit();
  });
}
