// Server logs: turns the bot's gateway events into embeds posted in a log channel, while the app is
// open or in the tray. Recent messages are kept in memory so deleted and edited ones can be shown.
// No Electron here, so it can be tested with fake events.

const INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_MODERATION: 1 << 2, GUILD_MESSAGES: 1 << 9, MESSAGE_CONTENT: 1 << 15 };
const EVENT_GROUPS = ['members', 'moderation', 'messages', 'server'];
const MAX_MESSAGES = 5000;
const MAX_MEMBERS = 50000;
const NEW_ACCOUNT_MS = 7 * 86400000;
const FLUSH_MS = 2000;
const COLORS = { join: 0x0bbfbc, leave: 0x8a80a3, ban: 0xfc354c, unban: 0x0bbfbc, member: 0x7f8cf0, delete: 0xfc8a35, edit: 0xf5a623, server: 0x5865f2 };

const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const escape = (text) => String(text).replace(/[\\*_`~|>[\]()]/g, '\\$&');
const userLine = (u) => `<@${u.id}> · ${escape(u.global_name || u.username || 'unknown')} (\`${u.id}\`)`;
const avatarUrl = (u) => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : undefined);

// Gateway intents needed for the enabled event groups. Privileged ones only when the Developer Portal
// allows them (botIntents comes from the app's last check of the bot).
function intentsFor(configs, botIntents = {}) {
  let intents = 0;
  for (const c of configs) {
    intents |= INTENTS.GUILDS;
    if ((c.events.members || c.events.moderation) && botIntents.members) intents |= INTENTS.GUILD_MEMBERS;
    if (c.events.moderation) intents |= INTENTS.GUILD_MODERATION;
    if (c.events.messages) {
      intents |= INTENTS.GUILD_MESSAGES;
      if (botIntents.content) intents |= INTENTS.MESSAGE_CONTENT;
    }
  }
  return intents;
}

function normalizeConfig(input) {
  const events = {};
  for (const key of EVENT_GROUPS) events[key] = input?.events?.[key] !== false;
  return {
    enabled: !!input?.enabled,
    channelId: /^\d{15,21}$/.test(String(input?.channelId || '')) ? String(input.channelId) : null,
    events,
  };
}

// configFor(guildId): that server's log settings when logging is on (with a channel), else null.
// It may include content: false when Message Content Intent is off.
function createServerLogger({ rest, configFor, onError = () => {}, flushMs = FLUSH_MS }) {
  const messages = new Map(); // message id -> { guildId, channelId, author, content, attachments }
  const members = new Map(); // guild:user -> { nick, roles, until, joinedAt, user }
  const channels = new Map(); // channel id -> name
  const roles = new Map(); // role id -> name
  const queues = new Map(); // guild id -> { embeds, timer, sending }

  const remember = (map, key, value, max) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > max) map.delete(map.keys().next().value);
  };
  const rememberMember = (guildId, m) => {
    if (!m?.user) return;
    remember(members, `${guildId}:${m.user.id}`, { nick: m.nick || null, roles: [...(m.roles || [])], until: m.communication_disabled_until || null, joinedAt: m.joined_at || null, user: m.user }, MAX_MEMBERS);
  };

  function post(guildId, embed) {
    let q = queues.get(guildId);
    if (!q) queues.set(guildId, (q = { embeds: [], timer: null, sending: false }));
    q.embeds.push({ ...embed, timestamp: new Date().toISOString() });
    if (!q.timer && !q.sending) q.timer = setTimeout(() => flush(guildId), flushMs);
  }

  // Up to 10 embeds per message, so a raid's worth of joins doesn't become hundreds of messages.
  async function flush(guildId) {
    const q = queues.get(guildId);
    q.timer = null;
    q.sending = true;
    try {
      while (q.embeds.length) {
        const batch = q.embeds.splice(0, 10);
        const cfg = configFor(guildId);
        if (!cfg) continue;
        try {
          await rest.request('POST', `/channels/${cfg.channelId}/messages`, { body: { embeds: batch, allowed_mentions: { parse: [] } } });
        } catch (err) {
          onError(guildId, err);
        }
      }
    } finally {
      q.sending = false;
    }
  }

  const cacheGuild = (d) => {
    for (const c of d.channels || []) channels.set(c.id, c.name);
    for (const r of d.roles || []) roles.set(r.id, r.name);
    for (const m of d.members || []) rememberMember(d.id, m);
  };

  function memberChanges(guildId, d, before) {
    const lines = [];
    if (before.nick !== (d.nick || null)) lines.push(`**Nickname:** ${before.nick ? escape(before.nick) : '*none*'} → ${d.nick ? escape(d.nick) : '*none*'}`);
    const added = (d.roles || []).filter((r) => !before.roles.includes(r));
    const removed = before.roles.filter((r) => !(d.roles || []).includes(r));
    if (added.length) lines.push(`**Roles added:** ${added.map((r) => `<@&${r}>`).join(' ')}`);
    if (removed.length) lines.push(`**Roles removed:** ${removed.map((r) => `<@&${r}>`).join(' ')}`);
    const until = d.communication_disabled_until && Date.parse(d.communication_disabled_until) > Date.now() ? d.communication_disabled_until : null;
    const wasUntil = before.until && Date.parse(before.until) > Date.now() ? before.until : null;
    if (until && until !== wasUntil) lines.push(`**Timed out** until ${stamp(Date.parse(until), 'f')}`);
    if (!until && wasUntil) lines.push('**Timeout ended**');
    return lines;
  }

  function handle(type, d) {
    if (!d) return;
    if (type === 'GUILD_CREATE') {
      if (configFor(d.id)) cacheGuild(d);
      return;
    }
    const guildId = d.guild_id;
    const cfg = guildId && configFor(guildId);
    if (!cfg) return;
    const on = cfg.events;

    switch (type) {
      case 'MESSAGE_CREATE':
        if (on.messages && !d.author?.bot && !d.webhook_id && d.channel_id !== cfg.channelId) {
          remember(messages, d.id, { guildId, channelId: d.channel_id, author: d.author, content: d.content || '', attachments: (d.attachments || []).map((a) => a.filename) }, MAX_MESSAGES);
        }
        break;

      case 'MESSAGE_UPDATE': {
        const before = messages.get(d.id);
        if (!on.messages || !before || typeof d.content !== 'string' || d.content === before.content) break;
        if (before.content || d.content) {
          post(guildId, {
            title: 'Message edited',
            color: COLORS.edit,
            description: `${userLine(before.author)} in <#${d.channel_id}> · [jump to message](https://discord.com/channels/${guildId}/${d.channel_id}/${d.id})`,
            fields: [
              { name: 'Before', value: clip(before.content || '*empty*', 1024) },
              { name: 'After', value: clip(d.content || '*empty*', 1024) },
            ],
          });
        }
        before.content = d.content;
        break;
      }

      case 'MESSAGE_DELETE': {
        if (!on.messages || d.channel_id === cfg.channelId) break;
        const before = messages.get(d.id);
        messages.delete(d.id);
        if (!before) {
          post(guildId, { title: 'Message deleted', color: COLORS.delete, description: `In <#${d.channel_id}>. It was sent before the bot started watching, so its author and text aren't known.` });
          break;
        }
        const text = before.content || (cfg.content === false ? "*Text not available: Message Content Intent is off for this bot.*" : '*No text*');
        const fields = [{ name: 'Message', value: clip(text, 1024) }];
        if (before.attachments.length) fields.push({ name: 'Attachments', value: clip(before.attachments.map(escape).join('\n'), 1024) });
        post(guildId, { title: 'Message deleted', color: COLORS.delete, description: `${userLine(before.author)} in <#${d.channel_id}>`, fields });
        break;
      }

      case 'MESSAGE_DELETE_BULK':
        if (on.messages && d.channel_id !== cfg.channelId) {
          for (const id of d.ids || []) messages.delete(id);
          post(guildId, { title: `${(d.ids || []).length} messages deleted`, color: COLORS.delete, description: `Bulk deleted in <#${d.channel_id}> (a purge).` });
        }
        break;

      case 'GUILD_MEMBER_ADD': {
        rememberMember(guildId, d);
        if (!on.members) break;
        const created = snowflakeTime(d.user.id);
        const young = Date.now() - created < NEW_ACCOUNT_MS;
        post(guildId, {
          title: 'Member joined',
          color: COLORS.join,
          description: `${userLine(d.user)}\nAccount created ${stamp(created)}${young ? '\n⚠️ **New account** (under 7 days old)' : ''}`,
          thumbnail: avatarUrl(d.user) ? { url: avatarUrl(d.user) } : undefined,
        });
        break;
      }

      case 'GUILD_MEMBER_REMOVE': {
        const before = members.get(`${guildId}:${d.user.id}`);
        members.delete(`${guildId}:${d.user.id}`);
        if (!on.members) break;
        const lines = [userLine(d.user)];
        if (before?.joinedAt) lines.push(`Joined ${stamp(Date.parse(before.joinedAt))}`);
        if (before?.roles.length) lines.push(`**Roles:** ${before.roles.map((r) => `<@&${r}>`).join(' ')}`);
        post(guildId, { title: 'Member left', color: COLORS.leave, description: lines.join('\n'), thumbnail: avatarUrl(d.user) ? { url: avatarUrl(d.user) } : undefined });
        break;
      }

      case 'GUILD_MEMBER_UPDATE': {
        const key = `${guildId}:${d.user.id}`;
        const before = members.get(key);
        rememberMember(guildId, { ...before, ...d, joined_at: d.joined_at || before?.joinedAt });
        if (!on.moderation) break;
        // Without an earlier copy only a new timeout can be told apart from other changes.
        const changes = before ? memberChanges(guildId, d, before) : memberChanges(guildId, d, { nick: d.nick || null, roles: d.roles || [], until: null });
        const shown = before ? changes : changes.filter((line) => line.startsWith('**Timed out**'));
        if (shown.length) post(guildId, { title: 'Member updated', color: COLORS.member, description: `${userLine(d.user)}\n${shown.join('\n')}` });
        break;
      }

      case 'GUILD_BAN_ADD':
      case 'GUILD_BAN_REMOVE':
        if (on.moderation) {
          const ban = type === 'GUILD_BAN_ADD';
          post(guildId, { title: ban ? 'Member banned' : 'Member unbanned', color: ban ? COLORS.ban : COLORS.unban, description: userLine(d.user) });
        }
        break;

      case 'CHANNEL_CREATE':
      case 'CHANNEL_DELETE':
      case 'CHANNEL_UPDATE': {
        const old = channels.get(d.id);
        if (type === 'CHANNEL_DELETE') channels.delete(d.id);
        else channels.set(d.id, d.name);
        if (!on.server || (d.id === cfg.channelId && type !== 'CHANNEL_DELETE')) break;
        const kind = d.type === 4 ? 'Category' : 'Channel';
        if (type === 'CHANNEL_CREATE') post(guildId, { title: `${kind} created`, color: COLORS.server, description: `<#${d.id}> · ${escape(d.name)}` });
        if (type === 'CHANNEL_DELETE') post(guildId, { title: `${kind} deleted`, color: COLORS.delete, description: escape(d.name) });
        if (type === 'CHANNEL_UPDATE' && old && old !== d.name) post(guildId, { title: `${kind} renamed`, color: COLORS.server, description: `<#${d.id}>: ${escape(old)} → ${escape(d.name)}` });
        break;
      }

      case 'GUILD_ROLE_CREATE':
      case 'GUILD_ROLE_DELETE': {
        const role = d.role || { id: d.role_id, name: roles.get(d.role_id) };
        if (type === 'GUILD_ROLE_CREATE') roles.set(role.id, role.name);
        else roles.delete(role.id);
        if (on.server) post(guildId, type === 'GUILD_ROLE_CREATE' ? { title: 'Role created', color: COLORS.server, description: `<@&${role.id}> · ${escape(role.name)}` } : { title: 'Role deleted', color: COLORS.delete, description: escape(role.name || role.id) });
        break;
      }

      case 'GUILD_ROLE_UPDATE':
        if (d.role) roles.set(d.role.id, d.role.name);
        break;

      default:
        break;
    }
  }

  return { handle, flush, post };
}

module.exports = { createServerLogger, intentsFor, normalizeConfig, EVENT_GROUPS, INTENTS };
