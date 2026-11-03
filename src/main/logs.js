// Server logs: turns the bot's gateway events into embeds posted in a log channel, while the app is
// open or in the tray. Recent messages are kept in memory so deleted and edited ones can be shown:
// everything posted while the bot is connected, bots' posts included, and the last few in each
// channel from when it connects (so a restart doesn't forget them). No Electron here, so it can be
// tested with fake events.
const { isLocked, lockFromAudit, parseAuditReason } = require('../shared/modlog');

const INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_MODERATION: 1 << 2, GUILD_MESSAGES: 1 << 9, MESSAGE_CONTENT: 1 << 15 };
const EVENT_GROUPS = ['members', 'moderation', 'messages', 'server'];
const MAX_MESSAGES = 20000;
const RECENT_PER_CHANNEL = 50; // read from each channel when the bot connects
const TEXT_CHANNELS = new Set([0, 5]); // text and announcement channels
const MAX_MEMBERS = 50000;
const NEW_ACCOUNT_MS = 7 * 86400000;
const FLUSH_MS = 2000;
const AUDIT_DELAY_MS = 1500; // Discord writes the audit log entry a moment after the change
const AUDIT_MAX_AGE_MS = 2 * 60000;
const COLORS = { join: 0x0bbfbc, leave: 0x8a80a3, kick: 0xfc8a35, ban: 0xfc354c, unban: 0x0bbfbc, member: 0x7f8cf0, delete: 0xfc8a35, edit: 0xf5a623, server: 0x5865f2 };
const AUDIT = { KICK: 20, BAN: 22, UNBAN: 23 };
const AUDIT_REUSE_MS = 1000; // one read of the audit log serves a burst of events (a raid's bans)

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
// posted(guildId, n): n log entries went out.
function createServerLogger({ rest, configFor, onError = () => {}, posted = () => {}, flushMs = FLUSH_MS, auditDelayMs = AUDIT_DELAY_MS }) {
  const messages = new Map(); // message id -> { guildId, channelId, author, content, attachments }
  const members = new Map(); // guild:user -> { nick, roles, until, joinedAt, user }
  const channels = new Map(); // channel id -> { name, locked }
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
          posted(guildId, batch.length);
        } catch (err) {
          onError(guildId, err);
        }
      }
    } finally {
      q.sending = false;
    }
  }

  const cacheGuild = (d) => {
    for (const c of d.channels || []) channels.set(c.id, { name: c.name, locked: isLocked(c, d.id) });
    for (const r of d.roles || []) roles.set(r.id, r.name);
    for (const m of d.members || []) rememberMember(d.id, m);
  };

  // A message, as the log needs it if it's deleted or edited later. Bots' and webhooks' posts are
  // kept too (their edits aren't logged: bots edit their own posts all the time).
  const messageOf = (guildId, m) => {
    const card = m.embeds?.[0];
    return {
      guildId,
      channelId: m.channel_id,
      author: m.author,
      bot: !!m.author?.bot || !!m.webhook_id,
      webhook: !!m.webhook_id,
      content: m.content || '',
      card: card ? card.title || card.author?.name || card.description || '' : '',
      attachments: (m.attachments || []).map((a) => a.filename),
    };
  };

  // The last few messages in each channel, read when the bot connects, so a message posted before a
  // restart is still known if it's deleted. Ones it saw being posted since stay as they are.
  async function rememberRecent(d, cfg) {
    for (const c of d.channels || []) {
      if (!TEXT_CHANNELS.has(c.type) || c.id === cfg.channelId) continue;
      const list = await rest.request('GET', `/channels/${c.id}/messages`, { query: { limit: RECENT_PER_CHANNEL } }).catch(() => null);
      if (!Array.isArray(list)) continue; // the bot can't read this channel
      for (const m of [...list].reverse()) {
        if (m?.id && !messages.has(m.id)) remember(messages, m.id, messageOf(d.id, { ...m, channel_id: c.id }), MAX_MESSAGES);
      }
    }
  }

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

  // Who did something and why come from the audit log (when the bot may read it): the newest entry
  // matching match(entry) from the last two minutes, or null.
  const auditReads = new Map(); // guild id -> { at, entries }
  async function recentAudit(guildId, match) {
    await new Promise((r) => setTimeout(r, auditDelayMs));
    let read = auditReads.get(guildId);
    if (!read || Date.now() - read.at > AUDIT_REUSE_MS) {
      read = { at: Date.now(), entries: rest.request('GET', `/guilds/${guildId}/audit-logs`, { query: { limit: 50 } }).then((log) => log?.audit_log_entries || []).catch(() => []) };
      auditReads.set(guildId, read);
    }
    return (await read.entries).find((e) => Date.now() - snowflakeTime(e.id) < AUDIT_MAX_AGE_MS && match(e)) || null;
  }

  // Commands through the bot name the real moderator and the command in the reason.
  function byAndWhy(entry) {
    if (!entry) return [];
    const { reason, by, via } = parseAuditReason(entry.reason);
    return [
      { name: 'By', value: by ? `<@${by.id}> · ${escape(by.name)} via \`${via}\`` : `<@${entry.user_id}>`, inline: true },
      { name: 'Reason', value: reason ? clip(reason, 1024) : '*No reason given*' },
    ];
  }

  async function logLock(guildId, channel, locked) {
    const found = await recentAudit(guildId, (e) => e.target_id === channel.id && lockFromAudit(e, guildId, channel.type) === (locked ? 'locked' : 'unlocked'));
    post(guildId, { title: locked ? '🔒 Channel locked' : '🔓 Channel unlocked', color: locked ? COLORS.ban : COLORS.unban, description: `<#${channel.id}> · ${escape(channel.name)}`, fields: byAndWhy(found) });
  }

  // Discord says "member left" for leaves, kicks and bans alike; the audit log tells them apart.
  async function logLeave(guildId, user, before, on) {
    const entry = await recentAudit(guildId, (e) => e.target_id === user.id && (e.action_type === AUDIT.KICK || e.action_type === AUDIT.BAN));
    if (entry?.action_type === AUDIT.BAN && on.moderation) return; // logged as a ban
    const lines = [userLine(user)];
    if (before?.joinedAt) lines.push(`Joined ${stamp(Date.parse(before.joinedAt))}`);
    if (before?.roles.length) lines.push(`**Roles:** ${before.roles.map((r) => `<@&${r}>`).join(' ')}`);
    const thumbnail = avatarUrl(user) ? { url: avatarUrl(user) } : undefined;
    if (entry?.action_type === AUDIT.KICK) post(guildId, { title: 'Member kicked', color: COLORS.kick, description: lines.join('\n'), thumbnail, fields: byAndWhy(entry) });
    else if (on.members) post(guildId, { title: 'Member left', color: COLORS.leave, description: lines.join('\n'), thumbnail });
  }

  async function logBan(guildId, user, banned) {
    const entry = await recentAudit(guildId, (e) => e.target_id === user.id && e.action_type === (banned ? AUDIT.BAN : AUDIT.UNBAN));
    post(guildId, { title: banned ? 'Member banned' : 'Member unbanned', color: banned ? COLORS.ban : COLORS.unban, description: userLine(user), fields: byAndWhy(entry) });
  }

  function handle(type, d) {
    if (!d) return;
    if (type === 'GUILD_CREATE') {
      const cfg = configFor(d.id);
      if (cfg) cacheGuild(d);
      if (cfg?.events.messages) rememberRecent(d, cfg).catch(() => {});
      return;
    }
    const guildId = d.guild_id;
    const cfg = guildId && configFor(guildId);
    if (!cfg) return;
    const on = cfg.events;

    switch (type) {
      case 'MESSAGE_CREATE':
        if (on.messages && d.channel_id !== cfg.channelId) remember(messages, d.id, messageOf(guildId, d), MAX_MESSAGES);
        break;

      case 'MESSAGE_UPDATE': {
        const before = messages.get(d.id);
        if (!on.messages || !before) break;
        if (Array.isArray(d.embeds)) before.card = messageOf(guildId, { ...d, author: before.author }).card;
        if (typeof d.content !== 'string' || d.content === before.content) break;
        if (!before.bot && (before.content || d.content)) {
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
          post(guildId, { title: 'Message deleted', color: COLORS.delete, description: `In <#${d.channel_id}>. It's older than the messages the bot remembers, so its author and text aren't known.` });
          break;
        }
        // A bot's post is often just a card: its title stands in for the text. (People's posts only
        // get cards from link previews.)
        const card = before.bot ? before.card : '';
        const noText = card ? `*A card:* ${escape(card)}` : cfg.content === false && !before.bot ? '*Text not available: Message Content Intent is off for this bot.*' : '*No text*';
        const fields = [{ name: 'Message', value: clip(before.content || noText, 1024) }];
        if (before.content && card) fields.push({ name: 'Card', value: clip(escape(card), 1024) });
        if (before.attachments.length) fields.push({ name: 'Attachments', value: clip(before.attachments.map(escape).join('\n'), 1024) });
        const who = before.webhook ? ' · a webhook' : before.bot ? ' · a bot' : '';
        post(guildId, { title: 'Message deleted', color: COLORS.delete, description: `${userLine(before.author)}${who} in <#${d.channel_id}>`, fields });
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
        if (on.members || on.moderation) logLeave(guildId, d.user, before, on).catch(() => {});
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
        if (on.moderation) logBan(guildId, d.user, type === 'GUILD_BAN_ADD').catch(() => {});
        break;

      case 'CHANNEL_CREATE':
      case 'CHANNEL_DELETE':
      case 'CHANNEL_UPDATE': {
        const old = channels.get(d.id);
        const locked = isLocked(d, guildId);
        if (type === 'CHANNEL_DELETE') channels.delete(d.id);
        else channels.set(d.id, { name: d.name, locked });
        if (type === 'CHANNEL_UPDATE' && old && old.locked !== locked && on.moderation && d.type !== 4) logLock(guildId, d, locked).catch(() => {});
        if (!on.server || (d.id === cfg.channelId && type !== 'CHANNEL_DELETE')) break;
        const kind = d.type === 4 ? 'Category' : 'Channel';
        if (type === 'CHANNEL_CREATE') post(guildId, { title: `${kind} created`, color: COLORS.server, description: `<#${d.id}> · ${escape(d.name)}` });
        if (type === 'CHANNEL_DELETE') post(guildId, { title: `${kind} deleted`, color: COLORS.delete, description: escape(d.name) });
        if (type === 'CHANNEL_UPDATE' && old && old.name !== d.name) post(guildId, { title: `${kind} renamed`, color: COLORS.server, description: `<#${d.id}>: ${escape(old.name)} → ${escape(d.name)}` });
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
