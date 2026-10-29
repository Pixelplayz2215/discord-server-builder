// Moderation cases, kept as messages in a private #mod-cases channel that the bot creates in each
// server. Discord is the store, so cases survive portal restarts (free hosts wipe their disk) and
// mods can read them in Discord too. Each case is one embed whose footer holds the IDs to search by.
// Shared by the app (owner bots) and the mod portal (server/), so it must not depend on Electron.

const CHANNEL_NAME = 'mod-cases';
// Kick, Ban or Timeout: the roles that can read #mod-cases (same rule as the portal's mod access).
const MOD_ACCESS = (1n << 1n) | (1n << 2n) | (1n << 40n);
const SCAN_PAGES = 10; // newest 1000 messages
const BIT = { VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n, EMBED_LINKS: 1n << 14n, READ_MESSAGE_HISTORY: 1n << 16n };
const TYPES = {
  warn: { label: 'Warn', color: 0xf5a623 },
  timeout: { label: 'Timeout', color: 0x7f8cf0 },
  untimeout: { label: 'Timeout ended', color: 0x0bbfbc },
  kick: { label: 'Kick', color: 0xfc8a35 },
  ban: { label: 'Ban', color: 0xfc354c },
  unban: { label: 'Unban', color: 0x0bbfbc },
};
const FOOTER = /^Member ID (\d+) · Moderator ID (\d+) · (\w+)$/;
const TITLE = /^Case (\d+) · /;

const escapeMarkdown = (text) => String(text).replace(/[\\*_`~|>[\]()]/g, '\\$&');

function parseCase(message, botId) {
  if (message.author?.id !== botId) return null;
  const embed = message.embeds?.[0];
  const number = embed?.title?.match(TITLE);
  const ids = embed?.footer?.text?.match(FOOTER);
  if (!number || !ids || !TYPES[ids[3]]) return null;
  const field = (name) => embed.fields?.find((f) => f.name === name)?.value || '';
  return {
    number: Number(number[1]),
    memberId: ids[1],
    moderatorId: ids[2],
    type: ids[3],
    reason: field('Reason'),
    duration: field('Duration'),
    at: embed.timestamp || message.timestamp,
    messageId: message.id,
  };
}

function caseEmbed(number, { type, member, moderator, reason, duration }) {
  return {
    title: `Case ${number} · ${TYPES[type].label}`,
    color: TYPES[type].color,
    fields: [
      { name: 'Member', value: `<@${member.id}> · ${escapeMarkdown(member.label)}`, inline: true },
      { name: 'Moderator', value: `<@${moderator.id}>`, inline: true },
      ...(duration ? [{ name: 'Duration', value: duration, inline: true }] : []),
      { name: 'Reason', value: (reason || 'No reason given').slice(0, 1024) },
    ],
    footer: { text: `Member ID ${member.id} · Moderator ID ${moderator.id} · ${type}` },
    timestamp: new Date().toISOString(),
  };
}

// A text channel for the bot's logs: hidden from @everyone, readable (not writable) by every role
// that can kick, ban or time out, and writable by the bot.
function privateChannel(name, topic, guild, roles, botUserId) {
  const modRoles = roles.filter((r) => r.id !== guild.id && !r.managed && BigInt(r.permissions) & MOD_ACCESS);
  return {
    name,
    type: 0,
    topic,
    permission_overwrites: [
      { id: guild.id, type: 0, allow: '0', deny: String(BIT.VIEW_CHANNEL) },
      { id: botUserId, type: 1, allow: String(BIT.VIEW_CHANNEL | BIT.SEND_MESSAGES | BIT.EMBED_LINKS | BIT.READ_MESSAGE_HISTORY), deny: '0' },
      ...modRoles.map((r) => ({ id: r.id, type: 0, allow: String(BIT.VIEW_CHANNEL | BIT.READ_MESSAGE_HISTORY), deny: String(BIT.SEND_MESSAGES) })),
    ],
  };
}

function createCases(rest, { botId }) {
  const channels = new Map(); // guildId -> channel id
  const queues = new Map(); // guildId -> last write, so case numbers never clash

  async function findChannel(guildId) {
    if (channels.has(guildId)) return channels.get(guildId);
    const list = await rest.request('GET', `/guilds/${guildId}/channels`);
    const found = list.find((c) => c.type === 0 && c.name === CHANNEL_NAME);
    if (found) channels.set(guildId, found.id);
    return found?.id || null;
  }

  async function createChannel(guild, roles) {
    const channel = await rest.request('POST', `/guilds/${guild.id}/channels`, {
      body: privateChannel(CHANNEL_NAME, "Cases recorded by the mod commands (/warn, /timeout, /kick, /ban…). Use /cases to look someone up. Don't rename this channel.", guild, roles, await botId()),
      reason: 'Case log for the mod commands',
    });
    channels.set(guild.id, channel.id);
    return channel.id;
  }

  // Runs fn with the case channel's id, finding it again once if it was deleted or renamed meanwhile.
  async function withChannel(guild, roles, create, fn) {
    for (let attempt = 0; ; attempt++) {
      const id = (await findChannel(guild.id)) || (create ? await createChannel(guild, roles) : null);
      if (!id) return fn(null);
      try {
        return await fn(id);
      } catch (err) {
        if (err.code !== 10003 || attempt) throw err;
        channels.delete(guild.id);
      }
    }
  }

  async function lastNumber(channelId) {
    const me = await botId();
    const recent = await rest.request('GET', `/channels/${channelId}/messages`, { query: { limit: 100 } });
    for (const m of recent) {
      const c = parseCase(m, me);
      if (c) return c.number;
    }
    return 0;
  }

  // entry: { type, member: { id, label }, moderator: { id }, reason, duration }
  function record(guild, roles, entry) {
    const write = () =>
      withChannel(guild, roles, true, async (channelId) => {
        const number = (await lastNumber(channelId)) + 1;
        await rest.request('POST', `/channels/${channelId}/messages`, { body: { embeds: [caseEmbed(number, entry)], allowed_mentions: { parse: [] } } });
        return { number, channelId };
      });
    const next = (queues.get(guild.id) || Promise.resolve()).catch(() => {}).then(write);
    queues.set(guild.id, next);
    return next;
  }

  // A member's cases, newest first.
  async function list(guild, memberId) {
    const me = await botId();
    return withChannel(guild, [], false, async (channelId) => {
      if (!channelId) return [];
      const found = [];
      let before;
      for (let page = 0; page < SCAN_PAGES; page++) {
        const batch = await rest.request('GET', `/channels/${channelId}/messages`, { query: { limit: 100, before } });
        for (const m of batch) {
          const c = parseCase(m, me);
          if (c && c.memberId === memberId) found.push(c);
        }
        if (batch.length < 100) break;
        before = batch[batch.length - 1].id;
      }
      return found;
    });
  }

  return { record, list };
}

// DMs a user; false when their DMs are closed (or they share no server with the bot).
async function notifyUser(rest, userId, content) {
  try {
    const dm = await rest.request('POST', '/users/@me/channels', { body: { recipient_id: userId } });
    await rest.request('POST', `/channels/${dm.id}/messages`, { body: { content: content.slice(0, 2000), allowed_mentions: { parse: [] } } });
    return true;
  } catch {
    return false;
  }
}

// Records a warning and DMs the member the reason.
async function warnMember(rest, caseLog, { guild, roles, member, moderator, reason }) {
  const { number } = await caseLog.record(guild, roles, { type: 'warn', member, moderator, reason });
  const warnings = (await caseLog.list(guild, member.id)).filter((c) => c.type === 'warn').length;
  const told = await notifyUser(rest, member.id, `⚠️ You were warned in **${escapeMarkdown(guild.name)}**.${reason ? `\n**Reason:** ${reason}` : ''}`);
  return { number, warnings, told };
}

function durationLabel(seconds) {
  const units = [['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    const n = Math.round(seconds / size);
    if (seconds >= size * 0.95 && Math.abs(n * size - seconds) <= size * 0.05) return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }
  const n = Math.max(1, Math.round(seconds));
  return seconds >= 60 ? `${Math.round(seconds / 60)} minutes` : `${n} second${n === 1 ? '' : 's'}`;
}

// The case that a moderation API call amounts to (ban, unban, kick, timeout), or null. Lets actions
// taken in the app be recorded like the slash commands' ones.
function caseFromCall(method, path, body, now = Date.now()) {
  let m = String(path).match(/^\/guilds\/(\d{15,21})\/bans\/(\d{15,21})$/);
  if (m && (method === 'PUT' || method === 'DELETE')) return { guildId: m[1], memberId: m[2], type: method === 'PUT' ? 'ban' : 'unban' };
  m = String(path).match(/^\/guilds\/(\d{15,21})\/members\/(\d{15,21})$/);
  if (!m) return null;
  if (method === 'DELETE') return { guildId: m[1], memberId: m[2], type: 'kick' };
  if (method === 'PATCH' && body && 'communication_disabled_until' in body) {
    const until = Date.parse(body.communication_disabled_until);
    if (!body.communication_disabled_until || !Number.isFinite(until)) return { guildId: m[1], memberId: m[2], type: 'untimeout' };
    return { guildId: m[1], memberId: m[2], type: 'timeout', duration: durationLabel((until - now) / 1000) };
  }
  return null;
}

module.exports = { createCases, parseCase, caseEmbed, escapeMarkdown, notifyUser, warnMember, caseFromCall, durationLabel, privateChannel, TYPES, CHANNEL_NAME };
