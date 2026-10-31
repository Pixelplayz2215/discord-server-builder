// 24/7: the mod portal runs a bot's community features around the clock (welcome cards, auto roles,
// reaction roles, polls, server logs, server stats, scheduled announcements and YouTube alerts), so
// they keep going when the PC is off. The app keeps each server's settings in a private #bot-settings
// channel in that server, encrypted with a key made from the bot token, so only the app and the
// portal (which both hold the token) can read them. The portal keeps what it did there too (votes,
// announcements sent, videos seen), so a restart picks up where it left off. The app asks the portal
// for its status with requests signed with the token, so nobody else can. No Electron here: used by
// the app (src/main/main.js) and the portal (server/always.js).
const crypto = require('crypto');

const VERSION = 1; // the portal's /health says { always: VERSION } once it can run 24/7
const CHANNEL_NAME = 'bot-settings';
const MARKER = '[dsb-247]';
const TOPIC = `Discord Server Builder keeps this server's 24/7 settings here, encrypted, for your bot's mod portal. Only the bot can see this channel. Please don't delete it. ${MARKER}`;
const SETTINGS_FILE = 'settings.dsb';
const STATE_FILE = 'state.dsb';
const FILE_PREFIX = 'f-';
const SILENT = 1 << 12; // posted without notifying anyone
const MAX_SKEW_MS = 5 * 60 * 1000;
const BIT = { VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n, ATTACH_FILES: 1n << 15n, READ_MESSAGE_HISTORY: 1n << 16n };
const FILE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/* ---------- Encryption and signed requests ---------- */
const keyFor = (token, purpose) => crypto.createHmac('sha256', String(token)).update(`dsb-247-${purpose}`).digest();

function seal(token, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(token, 'seal'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('DSB1'), iv, cipher.getAuthTag(), body]);
}

function open(token, raw) {
  const b = Buffer.from(raw);
  if (b.length < 32 || b.subarray(0, 4).toString() !== 'DSB1') throw new Error('That is not a 24/7 settings file.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(token, 'seal'), b.subarray(4, 16));
    decipher.setAuthTag(b.subarray(16, 32));
    return JSON.parse(Buffer.concat([decipher.update(b.subarray(32)), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('These 24/7 settings were saved with a different bot token. Open the app and turn 24/7 on again.');
  }
}

const signature = (token, body, time) => crypto.createHmac('sha256', keyFor(token, 'sign')).update(`${time}.${body}`).digest('hex');

// Headers for a request from the app to its portal; body is the exact string sent.
function signedHeaders(token, body, now = Date.now()) {
  return { 'Content-Type': 'application/json', 'X-DSB-Time': String(now), 'X-DSB-Signature': signature(token, body, now) };
}

function checkSigned(token, body, headers, now = Date.now()) {
  const time = Number(headers['x-dsb-time']);
  const given = String(headers['x-dsb-signature'] || '');
  if (!Number.isFinite(time) || Math.abs(now - time) > MAX_SKEW_MS || !/^[0-9a-f]{64}$/.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(signature(token, body, time), 'hex'));
}

/* ---------- What the portal gets for a server ---------- */
const hasAny = (b) =>
  !!(b.autoroles?.enabled || b.greetings?.welcome?.enabled || b.greetings?.goodbye?.enabled || b.reactionRoles?.length || b.polls?.some((p) => !p.ended) || b.stats || b.logs?.enabled || b.announcements?.some((a) => a.schedule?.on) || b.alerts?.length);

// One server's settings from the app's saved config. alerts: this server's YouTube alerts.
function makeBundle({ guildId, config = {}, alerts = [], bot = {}, youtubeKey = '', on = true, now = Date.now() }) {
  const bundle = {
    v: VERSION,
    on,
    savedAt: now,
    guildId: String(guildId),
    bot: { intents: bot.intents || {}, presence: bot.presence || null, slashCommands: !!bot.slashCommands },
    autoroles: config.autoroles || null,
    greetings: config.greetings || null,
    reactionRoles: config.reactionRoles || [],
    polls: config.polls || [],
    stats: config.stats || null,
    logs: config.logs || null,
    announcements: config.announcements || [],
    alerts: alerts.filter((a) => a.platform === 'youtube' && a.guildId === String(guildId)),
    youtubeKey: '',
  };
  if (bundle.alerts.length) bundle.youtubeKey = youtubeKey || '';
  bundle.used = on && hasAny(bundle);
  return bundle;
}

// The bundle without what the portal itself keeps up to date (votes, last sent, videos seen), so
// saving those back in the app doesn't upload the settings again.
function bundleHash(bundle) {
  const { savedAt, files, ...rest } = bundle;
  const steady = {
    ...rest,
    polls: rest.polls.map(({ counts, endedAt, ...p }) => p),
    announcements: rest.announcements.map(({ lastSentAt, lastMessageId, lastChannelId, missedAt, problem, ...a }) => ({ ...a, schedule: a.schedule && { ...a.schedule, nextAt: null } })),
    alerts: rest.alerts.map(({ state, ...a }) => a),
  };
  return crypto.createHash('sha256').update(JSON.stringify(steady)).digest('hex');
}

// Pictures the settings use, by their name in the app's data folder.
function bundleFiles(bundle) {
  const names = new Set();
  for (const kind of ['welcome', 'goodbye']) {
    const bg = bundle.greetings?.[kind]?.card?.background;
    if (bundle.greetings?.[kind]?.enabled && bg?.type === 'image' && bg.image) names.add(bg.image);
  }
  for (const a of bundle.announcements) if (a.schedule?.on && a.embed?.imageFile) names.add(a.embed.imageFile);
  return [...names];
}

// A scheduled announcement's schedule as the app saved it. The portal's record of what it sent only
// counts while this is unchanged; a new time or a manual send in the app starts over.
const announceKey = (a) => `${!!a.schedule?.on}|${a.schedule?.at || ''}|${a.schedule?.repeat || ''}`;

/* ---------- What the portal did, back in the app ---------- */
// Changes to one server's saved config from the portal's status for it (null when nothing changed):
// announcements sent, polls found with /poll or deleted, and votes.
function mergeServer(config, server) {
  const st = server?.state || {};
  const patch = {};

  let announcementsChanged = false;
  const announcements = (config.announcements || []).map((a) => {
    const saved = st.announcements?.[a.id];
    if (!saved || saved.key !== announceKey(a)) return a;
    const next = { ...a, ...saved.patch };
    if (JSON.stringify(next) === JSON.stringify(a)) return a;
    announcementsChanged = true;
    return next;
  });
  if (announcementsChanged) patch.announcements = announcements;

  const pollState = st.polls || {};
  const forgotten = new Set(pollState.forgotten || []);
  let list = (config.polls || []).filter((p) => !forgotten.has(p.id));
  let pollsChanged = list.length !== (config.polls || []).length;
  for (const found of pollState.found || []) {
    if (list.some((p) => p.messageId === found.messageId)) continue;
    list.push(found);
    pollsChanged = true;
  }
  list = list.map((p) => {
    const c = pollState.counts?.[p.id];
    if (!c || JSON.stringify(c.counts) === JSON.stringify(p.counts)) return p;
    pollsChanged = true;
    return { ...p, counts: c.counts };
  });
  if (pollsChanged) patch.polls = list;
  return Object.keys(patch).length ? patch : null;
}

// The bot's YouTube alerts with what the portal saw (changed: whether any differ).
function mergeAlerts(alerts, botId, servers = {}) {
  let changed = false;
  const next = alerts.map((a) => {
    const st = a.botId === botId && a.platform === 'youtube' && servers[a.guildId]?.on ? servers[a.guildId].state?.alerts?.[a.id] : null;
    if (!st || JSON.stringify(st) === JSON.stringify(a.state)) return a;
    changed = true;
    return { ...a, state: st };
  });
  return { alerts: next, changed };
}

/* ---------- The #bot-settings channel ---------- */
async function findChannel(rest, guildId) {
  const list = await rest.request('GET', `/guilds/${guildId}/channels`);
  return list.find((c) => c.type === 0 && String(c.topic || '').includes(MARKER)) || null;
}

async function ensureChannel(rest, guildId, botUserId) {
  const found = await findChannel(rest, guildId);
  if (found) return found;
  const bot = BIT.VIEW_CHANNEL | BIT.SEND_MESSAGES | BIT.ATTACH_FILES | BIT.READ_MESSAGE_HISTORY;
  try {
    return await rest.request('POST', `/guilds/${guildId}/channels`, {
      body: {
        name: CHANNEL_NAME,
        type: 0,
        topic: TOPIC,
        position: 999,
        permission_overwrites: [
          { id: String(guildId), type: 0, allow: '0', deny: String(BIT.VIEW_CHANNEL) },
          { id: String(botUserId), type: 1, allow: String(bot), deny: '0' },
        ],
      },
      reason: '24/7 settings for the mod portal',
    });
  } catch (err) {
    if (err.code === 50013 || err.code === 50001) throw Object.assign(new Error('The bot needs Manage Channels in this server to keep its 24/7 settings.'), { code: err.code });
    throw err;
  }
}

// The bot's settings, state and picture messages in the channel (newest first).
async function readChannel(rest, channelId, botUserId) {
  const messages = await rest.request('GET', `/channels/${channelId}/messages`, { query: { limit: 100 } });
  const found = { settings: null, state: null, files: new Map() };
  for (const m of messages) {
    if (m.author?.id !== String(botUserId)) continue;
    for (const a of m.attachments || []) {
      const entry = { messageId: m.id, url: a.url, name: a.filename, size: a.size };
      if (a.filename === SETTINGS_FILE) found.settings ||= entry;
      else if (a.filename === STATE_FILE) found.state ||= entry;
      else if (a.filename.startsWith(FILE_PREFIX) && !found.files.has(a.filename)) found.files.set(a.filename, entry);
    }
  }
  return found;
}

async function download(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Discord's file server returned HTTP ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

// Posts a file, or swaps the file on the message that has it.
async function putFile(rest, channelId, existing, name, data, content) {
  const files = [{ name, data, type: 'application/octet-stream' }];
  if (existing) {
    try {
      return await rest.request('PATCH', `/channels/${channelId}/messages/${existing.messageId}`, { body: { content }, files });
    } catch (err) {
      if (err.code !== 10008) throw err; // deleted meanwhile: post it again
    }
  }
  return rest.request('POST', `/channels/${channelId}/messages`, { body: { content, flags: SILENT, allowed_mentions: { parse: [] } }, files });
}

const fileName = (data, local) => `${FILE_PREFIX}${crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)}.${String(local).split('.').pop().toLowerCase()}`;

// Saves one server's settings for the portal (app side). readFile(name) gives a picture's bytes, or null.
async function saveBundle({ rest, token, guildId, botUserId, bundle, readFile }) {
  const channel = await ensureChannel(rest, guildId, botUserId);
  const found = await readChannel(rest, channel.id, botUserId);
  const files = {};
  for (const local of bundleFiles(bundle)) {
    const data = readFile(local);
    if (!data) continue;
    const name = fileName(data, local);
    if (!found.files.has(name)) {
      await rest.request('POST', `/channels/${channel.id}/messages`, {
        body: { content: '🖼️ A picture your 24/7 settings use.', flags: SILENT, allowed_mentions: { parse: [] } },
        files: [{ name, data, type: FILE_TYPES[name.split('.').pop()] || 'application/octet-stream' }],
      });
    }
    files[local] = name;
  }
  const when = Math.floor(bundle.savedAt / 1000);
  await putFile(rest, channel.id, found.settings, SETTINGS_FILE, seal(token, { ...bundle, files }), `⚙️ 24/7 settings for this server, saved by Discord Server Builder <t:${when}:R>. They're encrypted: only your bot can read them.`);
  // Pictures no longer used.
  const used = new Set(Object.values(files));
  for (const [name, f] of found.files) if (!used.has(name)) await rest.request('DELETE', `/channels/${channel.id}/messages/${f.messageId}`).catch(() => {});
  return { channelId: channel.id };
}

// Reads one server's settings and the portal's state (portal side). Null when it has none.
async function loadBundle({ rest, token, guildId, botUserId, fetchImpl = fetch }) {
  const channel = await findChannel(rest, guildId);
  if (!channel) return null;
  const found = await readChannel(rest, channel.id, botUserId);
  if (!found.settings) return null;
  const bundle = open(token, await download(found.settings.url, fetchImpl));
  let state = null;
  if (found.state) state = await download(found.state.url, fetchImpl).then((raw) => open(token, raw), () => null);
  return { channelId: channel.id, bundle, state, stateMessage: found.state, files: found.files };
}

async function saveState({ rest, token, channelId, existing, state }) {
  const message = await putFile(rest, channelId, existing, STATE_FILE, seal(token, state), '📈 What your mod portal did while running 24/7 (encrypted).');
  return { messageId: message.id };
}

module.exports = {
  VERSION,
  CHANNEL_NAME,
  MARKER,
  SETTINGS_FILE,
  STATE_FILE,
  FILE_TYPES,
  seal,
  open,
  signedHeaders,
  checkSigned,
  makeBundle,
  bundleHash,
  bundleFiles,
  announceKey,
  mergeServer,
  mergeAlerts,
  findChannel,
  ensureChannel,
  readChannel,
  download,
  saveBundle,
  loadBundle,
  saveState,
};
