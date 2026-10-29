// Moderation cases, kept as messages in a private #mod-cases channel that the bot creates in each
// server. Discord is the store, so cases survive portal restarts (free hosts wipe their disk) and
// mods can read them in Discord too. Each case is one embed whose footer holds the IDs to search by.
const { MOD_ACCESS } = require('./guard');

const CHANNEL_NAME = 'mod-cases';
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

  // Private: hidden from @everyone, readable (not writable) by every role that can kick, ban or time out.
  async function createChannel(guild, roles) {
    const me = await botId();
    const modRoles = roles.filter((r) => r.id !== guild.id && !r.managed && BigInt(r.permissions) & MOD_ACCESS);
    const channel = await rest.request('POST', `/guilds/${guild.id}/channels`, {
      body: {
        name: CHANNEL_NAME,
        type: 0,
        topic: "Cases recorded by the mod commands (/warn, /timeout, /kick, /ban…). Use /cases to look someone up. Don't rename this channel.",
        permission_overwrites: [
          { id: guild.id, type: 0, allow: '0', deny: String(BIT.VIEW_CHANNEL) },
          { id: me, type: 1, allow: String(BIT.VIEW_CHANNEL | BIT.SEND_MESSAGES | BIT.EMBED_LINKS | BIT.READ_MESSAGE_HISTORY), deny: '0' },
          ...modRoles.map((r) => ({ id: r.id, type: 0, allow: String(BIT.VIEW_CHANNEL | BIT.READ_MESSAGE_HISTORY), deny: String(BIT.SEND_MESSAGES) })),
        ],
      },
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

module.exports = { createCases, parseCase, caseEmbed, escapeMarkdown, TYPES, CHANNEL_NAME };
