// Persists bots (tokens encrypted with Windows DPAPI via safeStorage) and saved templates
// in the app's userData folder.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const target = file(name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

function encrypt(token) {
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(token).toString('base64') };
  return { plain: Buffer.from(token, 'utf8').toString('base64') };
}

function decrypt(record) {
  if (record.enc) return safeStorage.decryptString(Buffer.from(record.enc, 'base64'));
  return Buffer.from(record.plain || '', 'base64').toString('utf8');
}

const publicBot = ({ secret, ...bot }) => bot;

const store = {
  listBots() {
    return readJson('bots.json', []).map(publicBot);
  },

  getBot(botId) {
    const bot = readJson('bots.json', []).find((b) => b.id === botId);
    return bot ? publicBot(bot) : null;
  },

  // A bot token, or the mod-portal session for accounts with type 'mod'.
  getToken(botId) {
    const bot = readJson('bots.json', []).find((b) => b.id === botId);
    if (!bot) throw new Error('That bot is no longer saved.');
    return decrypt(bot.secret);
  },

  upsertBot(bot, token) {
    const bots = readJson('bots.json', []);
    const existing = bots.find((b) => b.id === bot.id);
    const record = {
      ...(bot.type === 'mod' ? {} : { presence: { enabled: true, status: 'online', text: '' } }),
      addedAt: Date.now(),
      ...existing,
      ...bot,
      secret: encrypt(token),
    };
    writeJson('bots.json', existing ? bots.map((b) => (b.id === bot.id ? record : b)) : [...bots, record]);
    return publicBot(record);
  },

  updateBot(botId, patch) {
    const bots = readJson('bots.json', []);
    const bot = bots.find((b) => b.id === botId);
    if (!bot) throw new Error('Bot not found.');
    Object.assign(bot, patch);
    writeJson('bots.json', bots);
    return publicBot(bot);
  },

  removeBot(botId) {
    writeJson('bots.json', readJson('bots.json', []).filter((b) => b.id !== botId));
  },

  reorderBots(ids) {
    const bots = readJson('bots.json', []);
    bots.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    writeJson('bots.json', bots);
  },

  getSettings() {
    return readJson('settings.json', {});
  },

  saveSettings(settings) {
    writeJson('settings.json', settings);
  },

  listTemplates() {
    return readJson('templates.json', []);
  },

  saveTemplate(template) {
    const templates = readJson('templates.json', []).filter((t) => t.id !== template.id);
    templates.push({ ...template, savedAt: Date.now() });
    writeJson('templates.json', templates);
    return template;
  },

  deleteTemplate(id) {
    writeJson('templates.json', readJson('templates.json', []).filter((t) => t.id !== id));
  },

  // Per-server settings for one bot (or signed-in moderator): lockdown, auto backups, server logs.
  getGuildConfig(botId, guildId) {
    return readJson('servers.json', {})[`${botId}:${guildId}`] || {};
  },

  setGuildConfig(botId, guildId, patch) {
    const all = readJson('servers.json', {});
    const key = `${botId}:${guildId}`;
    all[key] = { ...all[key], ...patch };
    writeJson('servers.json', all);
    return all[key];
  },

  // Social alerts, the Twitch account and the YouTube API key. The Twitch tokens and the API key are
  // encrypted like bot tokens and never leave the main process.
  getSocial() {
    const { twitchTokens, youtubeKey, ...social } = readJson('social.json', {});
    return { clientId: '', account: null, alerts: [], ...social };
  },

  getYouTubeKey() {
    const record = readJson('social.json', {}).youtubeKey;
    if (!record) return '';
    try {
      return decrypt(record);
    } catch {
      return '';
    }
  },

  setYouTubeKey(key) {
    const all = readJson('social.json', {});
    if (key) all.youtubeKey = encrypt(key);
    else delete all.youtubeKey;
    writeJson('social.json', all);
  },

  saveSocial(patch) {
    writeJson('social.json', { ...readJson('social.json', {}), ...patch });
  },

  getTwitchTokens() {
    const record = readJson('social.json', {}).twitchTokens;
    if (!record) return null;
    try {
      return JSON.parse(decrypt(record));
    } catch {
      return null;
    }
  },

  setTwitchTokens(tokens) {
    const all = readJson('social.json', {});
    if (tokens) all.twitchTokens = encrypt(JSON.stringify(tokens));
    else delete all.twitchTokens;
    writeJson('social.json', all);
  },

  // Every server with saved settings, as [{ botId, guildId, config }].
  listGuildConfigs() {
    return Object.entries(readJson('servers.json', {})).map(([key, config]) => {
      const [botId, guildId] = key.split(':');
      return { botId, guildId, config };
    });
  },
};

module.exports = store;
