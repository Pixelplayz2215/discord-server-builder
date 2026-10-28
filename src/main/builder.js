// Builds a server layout from a template, clones an existing layout into a template,
// and implements the multi-request moderation tools (member paging, purge, channel lock).

const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
};

const any = (...bits) => bits.reduce((acc, b) => acc | b, 0n);

const MEMBER = any(
  P.CREATE_INSTANT_INVITE, P.CHANGE_NICKNAME, P.VIEW_CHANNEL, P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS,
  P.CREATE_PUBLIC_THREADS, P.EMBED_LINKS, P.ATTACH_FILES, P.ADD_REACTIONS, P.USE_EXTERNAL_EMOJIS,
  P.USE_EXTERNAL_STICKERS, P.READ_MESSAGE_HISTORY, P.USE_APPLICATION_COMMANDS, P.CONNECT, P.SPEAK,
  P.STREAM, P.USE_VAD, P.REQUEST_TO_SPEAK,
);
const MODERATOR = any(
  MEMBER, P.KICK_MEMBERS, P.BAN_MEMBERS, P.MANAGE_MESSAGES, P.MANAGE_THREADS, P.MANAGE_NICKNAMES,
  P.MODERATE_MEMBERS, P.VIEW_AUDIT_LOG, P.MUTE_MEMBERS, P.DEAFEN_MEMBERS, P.MOVE_MEMBERS,
  P.PRIORITY_SPEAKER, P.MENTION_EVERYONE,
);
const MANAGER = any(MODERATOR, P.MANAGE_CHANNELS, P.MANAGE_ROLES, P.MANAGE_GUILD_EXPRESSIONS, P.MANAGE_EVENTS, P.MANAGE_WEBHOOKS);

const PRESETS = { admin: P.ADMINISTRATOR, manager: MANAGER, moderator: MODERATOR, member: MEMBER, none: 0n };
const STAFF_PRESETS = new Set(['admin', 'manager', 'moderator']);

const CHANNEL_TYPES = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
const TYPE_NAMES = Object.fromEntries(Object.entries(CHANNEL_TYPES).map(([k, v]) => [v, k]));
// Announcement and stage channels need a Community server; fall back so the build keeps going.
const FALLBACK_TYPE = { 5: 0, 13: 2, 15: 0 };

const WRITE_BITS = any(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS, P.CREATE_PRIVATE_THREADS);
const isVoiceType = (type) => type === 2 || type === 13;

const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const colorToInt = (hex) => (hex && /^#?[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.replace('#', ''), 16) : 0);
const intToColor = (n) => (n ? `#${n.toString(16).padStart(6, '0')}` : '#99aab5');

function rolePermissions(role) {
  if (role.perms === 'custom') return String(role.permissions || '0');
  return String(PRESETS[role.perms] ?? 0n);
}

// Overwrites for one category/channel node: `private` hides it from @everyone and shows it to the
// listed roles; `readonly` stops @everyone sending while staff roles still can.
function nodeOverwrites(node, type, guildId, roleIds, staffKeys) {
  const map = new Map();
  const add = (id, allow, deny) => {
    const cur = map.get(id) || { allow: 0n, deny: 0n };
    map.set(id, { allow: cur.allow | allow, deny: cur.deny | deny });
  };
  const viewBits = isVoiceType(type) ? any(P.VIEW_CHANNEL, P.CONNECT) : P.VIEW_CHANNEL;
  const privateKeys = (node.private || []).filter((k) => roleIds[k]);
  if (privateKeys.length) {
    add(guildId, 0n, P.VIEW_CHANNEL);
    for (const key of privateKeys) add(roleIds[key], viewBits, 0n);
  }
  if (node.readonly && !isVoiceType(type)) {
    add(guildId, 0n, WRITE_BITS);
    for (const key of staffKeys) if (roleIds[key]) add(roleIds[key], P.SEND_MESSAGES, 0n);
  }
  return map;
}

// Channel-level bits win over category-level bits for the same role.
function mergeOverwrites(base, own) {
  const merged = new Map(base);
  for (const [id, o] of own) {
    const b = merged.get(id) || { allow: 0n, deny: 0n };
    merged.set(id, { allow: (b.allow & ~o.deny) | o.allow, deny: (b.deny & ~o.allow) | o.deny });
  }
  return merged;
}

const toApiOverwrites = (map) =>
  [...map].map(([id, o]) => ({ id, type: 0, allow: String(o.allow), deny: String(o.deny) }));

function countSteps(template, opts, existing) {
  let total = template.roles.length;
  for (const cat of template.categories) total += (cat.name ? 1 : 0) + cat.channels.length;
  if (opts.wipeChannels) total += existing.channels;
  if (opts.wipeRoles) total += existing.roles;
  if (opts.renameServer && opts.serverName) total += 1;
  return total + 1;
}

async function buildServer(rest, guildId, template, opts, emit) {
  const reason = 'Discord Server Builder';
  const stats = { ok: 0, failed: 0, warnings: 0 };
  const log = (level, msg) => emit({ type: 'step', level, msg });
  const step = async (label, fn) => {
    try {
      const result = await fn();
      stats.ok++;
      log('ok', label);
      return result;
    } catch (err) {
      stats.failed++;
      log('error', `${label} — ${err.message}`);
      return null;
    }
  };

  const [channels, roles, me] = await Promise.all([
    rest.request('GET', `/guilds/${guildId}/channels`),
    rest.request('GET', `/guilds/${guildId}/roles`),
    rest.request('GET', '/users/@me'),
  ]);
  const botMember = await rest.request('GET', `/guilds/${guildId}/members/${me.id}`);
  const botTop = Math.max(0, ...roles.filter((r) => botMember.roles.includes(r.id)).map((r) => r.position));
  const deletableRoles = roles.filter((r) => r.id !== guildId && !r.managed && r.position < botTop);

  emit({
    type: 'start',
    total: countSteps(template, opts, { channels: channels.length, roles: deletableRoles.length }),
  });

  if (opts.wipeChannels) {
    // Children first so categories are empty when they go.
    const ordered = [...channels].sort((a, b) => (a.type === 4) - (b.type === 4));
    for (const ch of ordered) await step(`Deleted ${ch.type === 4 ? 'category' : '#'}${ch.name}`, () => rest.request('DELETE', `/channels/${ch.id}`, { reason }));
  }
  if (opts.wipeRoles) {
    for (const role of deletableRoles) await step(`Deleted role @${role.name}`, () => rest.request('DELETE', `/guilds/${guildId}/roles/${role.id}`, { reason }));
  }
  if (opts.renameServer && opts.serverName) {
    await step(`Renamed server to "${opts.serverName}"`, () => rest.request('PATCH', `/guilds/${guildId}`, { body: { name: opts.serverName }, reason }));
  }

  // New roles are inserted just above @everyone, so creating top-to-bottom keeps the template order.
  const roleIds = {};
  for (const role of template.roles) {
    const created = await step(`Created role @${role.name}`, () =>
      rest.request('POST', `/guilds/${guildId}/roles`, {
        body: {
          name: role.name,
          color: colorToInt(role.color),
          hoist: !!role.hoist,
          mentionable: !!role.mentionable,
          permissions: rolePermissions(role),
        },
        reason,
      }),
    );
    if (created) roleIds[role.key] = created.id;
  }
  const staffKeys = template.roles.filter((r) => STAFF_PRESETS.has(r.perms)).map((r) => r.key);

  let systemChannelId = null;
  for (const cat of template.categories) {
    const catOverwrites = nodeOverwrites(cat, 4, guildId, roleIds, staffKeys);
    let parentId = null;
    if (cat.name) {
      const created = await step(`Created category ${cat.name}`, () =>
        rest.request('POST', `/guilds/${guildId}/channels`, {
          body: { name: cat.name, type: 4, permission_overwrites: toApiOverwrites(catOverwrites) },
          reason,
        }),
      );
      parentId = created?.id || null;
    }

    for (const ch of cat.channels) {
      let type = CHANNEL_TYPES[ch.type] ?? 0;
      const overwrites = mergeOverwrites(catOverwrites, nodeOverwrites(ch, type, guildId, roleIds, staffKeys));
      const payload = () => {
        const body = { name: ch.name, type, permission_overwrites: toApiOverwrites(overwrites) };
        if (parentId) body.parent_id = parentId;
        if (!isVoiceType(type) && ch.topic) body.topic = ch.topic.slice(0, 1024);
        if (type === 0 && ch.slowmode) body.rate_limit_per_user = Number(ch.slowmode);
        if (!isVoiceType(type) && ch.nsfw) body.nsfw = true;
        if (type === 2 && ch.userLimit) body.user_limit = Number(ch.userLimit);
        return body;
      };
      const label = `Created ${ch.type} channel ${isVoiceType(type) ? '🔊' : '#'}${ch.name}`;
      let created = null;
      try {
        created = await rest.request('POST', `/guilds/${guildId}/channels`, { body: payload(), reason });
        stats.ok++;
        log('ok', label);
      } catch (err) {
        if (FALLBACK_TYPE[type] !== undefined) {
          const original = ch.type;
          type = FALLBACK_TYPE[type];
          created = await step(`Created #${ch.name} as ${TYPE_NAMES[type]} (${original} needs a Community server)`, () =>
            rest.request('POST', `/guilds/${guildId}/channels`, { body: payload(), reason }),
          );
          if (created) stats.warnings++;
        } else {
          stats.failed++;
          log('error', `${label} — ${err.message}`);
        }
      }
      if (created && ch.system) systemChannelId = created.id;
    }
  }

  await step(systemChannelId ? 'Set welcome (system) channel' : 'Finished layout', () =>
    systemChannelId
      ? rest.request('PATCH', `/guilds/${guildId}`, { body: { system_channel_id: systemChannelId }, reason })
      : Promise.resolve(),
  );

  emit({ type: 'done', stats });
  return stats;
}

function detectPreset(permissions) {
  const bits = BigInt(permissions);
  if (bits & P.ADMINISTRATOR) return 'admin';
  for (const [name, value] of Object.entries(PRESETS)) if (value === bits) return name;
  return 'custom';
}

async function cloneServer(rest, guildId) {
  const [guild, roles, channels] = await Promise.all([
    rest.request('GET', `/guilds/${guildId}`),
    rest.request('GET', `/guilds/${guildId}/roles`),
    rest.request('GET', `/guilds/${guildId}/channels`),
  ]);
  const keyOf = (id) => `r${id}`;
  const templateRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      key: keyOf(r.id),
      name: r.name,
      color: intToColor(r.color),
      hoist: r.hoist,
      mentionable: r.mentionable,
      perms: detectPreset(r.permissions),
      permissions: r.permissions,
    }));
  const known = new Set(templateRoles.map((r) => r.key));

  const describe = (ch) => {
    const everyone = (ch.permission_overwrites || []).find((o) => o.id === guildId);
    const hidden = everyone && BigInt(everyone.deny) & P.VIEW_CHANNEL;
    const node = {};
    if (hidden) {
      node.private = (ch.permission_overwrites || [])
        .filter((o) => o.type === 0 && BigInt(o.allow) & P.VIEW_CHANNEL && known.has(keyOf(o.id)))
        .map((o) => keyOf(o.id));
    }
    if (everyone && BigInt(everyone.deny) & P.SEND_MESSAGES) node.readonly = true;
    return node;
  };
  const toChannel = (ch, parent) => {
    const own = describe(ch);
    const parentPrivate = parent ? JSON.stringify(describe(parent).private || []) : '[]';
    const channel = {
      type: TYPE_NAMES[ch.type] || 'text',
      name: ch.name,
      topic: ch.topic || '',
      slowmode: ch.rate_limit_per_user || 0,
      nsfw: !!ch.nsfw,
      readonly: !!own.readonly,
      private: JSON.stringify(own.private || []) === parentPrivate ? [] : own.private || [],
    };
    if (ch.type === 2 && ch.user_limit) channel.userLimit = ch.user_limit;
    if (guild.system_channel_id === ch.id) channel.system = true;
    return channel;
  };

  const byPosition = (a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const supported = (ch) => TYPE_NAMES[ch.type] && ch.type !== 4;
  const categories = channels.filter((c) => c.type === 4).sort(byPosition);
  const loose = channels.filter((c) => !c.parent_id && supported(c)).sort(byPosition);

  const templateCategories = [];
  if (loose.length) templateCategories.push({ name: '', channels: loose.map((c) => toChannel(c, null)) });
  for (const cat of categories) {
    const own = describe(cat);
    templateCategories.push({
      name: cat.name,
      private: own.private || [],
      readonly: !!own.readonly,
      channels: channels
        .filter((c) => c.parent_id === cat.id && supported(c))
        .sort(byPosition)
        .map((c) => toChannel(c, cat)),
    });
  }

  return {
    id: `clone-${guildId}-${Date.now()}`,
    name: `${guild.name} (copy)`,
    description: `Cloned from ${guild.name} on ${new Date().toLocaleDateString()}`,
    icon: '📋',
    serverName: guild.name,
    roles: templateRoles,
    categories: templateCategories,
  };
}

async function fetchAllMembers(rest, guildId, max = 10000) {
  const members = [];
  let after = '0';
  while (members.length < max) {
    const page = await rest.request('GET', `/guilds/${guildId}/members`, { query: { limit: 1000, after } });
    members.push(...page);
    if (page.length < 1000) return { members, truncated: false };
    after = page[page.length - 1].user.id;
  }
  return { members, truncated: true };
}

async function purgeMessages(rest, channelId, count, reason) {
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000 + 60 * 1000;
  let before;
  let deleted = 0;
  let skipped = 0;
  while (deleted + skipped < count) {
    const limit = Math.min(100, count - deleted - skipped);
    const batch = await rest.request('GET', `/channels/${channelId}/messages`, { query: { limit, before } });
    if (!batch.length) break;
    before = batch[batch.length - 1].id;
    const fresh = batch.filter((m) => !m.pinned && snowflakeTime(m.id) > cutoff);
    skipped += batch.length - fresh.length;
    if (fresh.length >= 2) {
      await rest.request('POST', `/channels/${channelId}/messages/bulk-delete`, { body: { messages: fresh.map((m) => m.id) }, reason });
    } else if (fresh.length === 1) {
      await rest.request('DELETE', `/channels/${channelId}/messages/${fresh[0].id}`, { reason });
    }
    deleted += fresh.length;
    // Older than 14 days from here on (messages come newest first), or the channel ran out.
    if (batch.length < limit || batch.some((m) => snowflakeTime(m.id) <= cutoff)) break;
  }
  return { deleted, skipped };
}

async function setChannelLock(rest, guildId, channelId, locked, reason) {
  const channel = await rest.request('GET', `/channels/${channelId}`);
  const bits = isVoiceType(channel.type) ? P.CONNECT : WRITE_BITS;
  const current = (channel.permission_overwrites || []).find((o) => o.id === guildId) || { allow: '0', deny: '0' };
  let allow = BigInt(current.allow);
  let deny = BigInt(current.deny);
  if (locked) {
    deny |= bits;
    allow &= ~bits;
  } else {
    deny &= ~bits;
  }
  await rest.request('PUT', `/channels/${channelId}/permissions/${guildId}`, {
    body: { type: 0, allow: String(allow), deny: String(deny) },
    reason,
  });
  return rest.request('GET', `/channels/${channelId}`);
}

module.exports = { buildServer, cloneServer, fetchAllMembers, purgeMessages, setChannelLock };
