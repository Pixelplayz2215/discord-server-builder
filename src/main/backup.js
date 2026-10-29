// Server backups: an exact snapshot of a server's roles, channels, permission overwrites and
// settings, saved as JSON on this PC, and a restore that recreates whatever is missing and puts
// permissions, layout and (optionally) settings back. Restoring never deletes anything.
// No Electron here, so it can be tested with a fake Discord.
const fs = require('fs');
const path = require('path');

const FORMAT = 'discord-server-builder-backup';
const RESTORABLE = new Set([0, 2, 4, 5, 13, 15]); // text, voice, category, announcement, stage, forum
// Announcement, stage and forum channels need a Community server; fall back like the builder does.
const FALLBACK_TYPE = { 5: 0, 13: 2, 15: 0 };
const KEEP_AUTO = 7;
const ID = /^\d{15,21}$/;

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const byPosition = (a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const isVoice = (type) => type === 2 || type === 13;

async function snapshotServer(rest, guildId, { label = '', auto = false } = {}) {
  const [guild, roles, channels] = await Promise.all([
    rest.request('GET', `/guilds/${guildId}`),
    rest.request('GET', `/guilds/${guildId}/roles`),
    rest.request('GET', `/guilds/${guildId}/channels`),
  ]);
  return {
    format: FORMAT,
    version: 1,
    takenAt: new Date().toISOString(),
    label: String(label || '').slice(0, 80),
    auto: !!auto,
    guild: pick(guild, ['id', 'name', 'verification_level', 'default_message_notifications', 'explicit_content_filter', 'afk_timeout', 'afk_channel_id', 'system_channel_id']),
    roles: roles.map((r) => pick(r, ['id', 'name', 'color', 'hoist', 'mentionable', 'permissions', 'position', 'managed'])),
    channels: channels
      .filter((c) => RESTORABLE.has(c.type))
      .map((c) => ({
        ...pick(c, ['id', 'type', 'name', 'position', 'parent_id', 'topic', 'nsfw', 'rate_limit_per_user', 'bitrate', 'user_limit']),
        permission_overwrites: (c.permission_overwrites || []).map((o) => pick(o, ['id', 'type', 'allow', 'deny'])),
      })),
  };
}

function validateBackup(data) {
  const ok =
    data &&
    data.format === FORMAT &&
    ID.test(data.guild?.id || '') &&
    Array.isArray(data.roles) &&
    Array.isArray(data.channels) &&
    data.roles.every((r) => ID.test(r.id) && typeof r.name === 'string') &&
    data.channels.every((c) => ID.test(c.id) && typeof c.name === 'string' && Number.isInteger(c.type) && Array.isArray(c.permission_overwrites));
  if (!ok) throw new Error("That file isn't a Discord Server Builder backup.");
  return data;
}

const overwriteKey = (list) =>
  (list || [])
    .map((o) => `${o.id}:${o.type}:${o.allow}:${o.deny}`)
    .sort()
    .join('|');

const roleBody = (r) => ({ name: r.name, color: r.color || 0, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: String(r.permissions) });

// Brings a server back to a backup. With dryRun it only reads, and returns the steps it would take.
// opts: missing (recreate deleted roles and channels), permissions (role permissions and channel
// overwrites), layout (categories and order), settings (server name and safety settings).
async function restoreBackup(rest, guildId, backup, opts = {}, emit = () => {}) {
  const { missing = true, permissions = true, layout = true, settings = false, dryRun = false } = opts;
  const reason = 'Restored from a backup in Discord Server Builder';
  const stats = { ok: 0, failed: 0, planned: [] };
  const step = async (label, fn) => {
    if (dryRun) {
      stats.planned.push(label);
      return null;
    }
    try {
      const result = await fn();
      stats.ok++;
      emit({ type: 'step', level: 'ok', msg: label });
      return result;
    } catch (err) {
      stats.failed++;
      emit({ type: 'step', level: 'error', msg: `${label} — ${err.message}` });
      return null;
    }
  };

  const [guild, roles, channels, me] = await Promise.all([
    rest.request('GET', `/guilds/${guildId}`),
    rest.request('GET', `/guilds/${guildId}/roles`),
    rest.request('GET', `/guilds/${guildId}/channels`),
    rest.request('GET', '/users/@me'),
  ]);
  const botMember = await rest.request('GET', `/guilds/${guildId}/members/${me.id}`);
  const botTop = guild.owner_id === me.id ? Infinity : Math.max(0, ...roles.filter((r) => botMember.roles.includes(r.id)).map((r) => r.position));
  const source = backup.guild.id;
  const placeholder = (id) => `new:${id}`;
  const real = (id) => (id && !String(id).startsWith('new:') ? id : null);

  /* ---------- Roles: same ID, else the same name, else recreate ---------- */
  const roleMap = new Map([[source, guildId]]);
  const freeRoles = roles.filter((r) => r.id !== guildId && !r.managed);
  const takeRole = (pred) => {
    const i = freeRoles.findIndex(pred);
    return i >= 0 ? freeRoles.splice(i, 1)[0] : null;
  };
  const backupRoles = backup.roles.filter((r) => r.id !== source && !r.managed).sort((a, b) => b.position - a.position);
  for (const r of backupRoles) {
    const match = takeRole((x) => x.id === r.id) || takeRole((x) => x.name === r.name);
    if (match) {
      roleMap.set(r.id, match.id);
      const differs = String(match.permissions) !== String(r.permissions) || (match.color || 0) !== (r.color || 0) || !!match.hoist !== !!r.hoist || !!match.mentionable !== !!r.mentionable;
      if (permissions && differs && match.position < botTop) {
        await step(`Reset role @${r.name}`, () => rest.request('PATCH', `/guilds/${guildId}/roles/${match.id}`, { body: roleBody(r), reason }));
      }
    } else if (missing) {
      const created = await step(`Recreated role @${r.name}`, () => rest.request('POST', `/guilds/${guildId}/roles`, { body: roleBody(r), reason }));
      roleMap.set(r.id, created?.id || placeholder(r.id));
    }
  }
  const everyoneBackup = backup.roles.find((r) => r.id === source);
  const everyoneNow = roles.find((r) => r.id === guildId);
  if (permissions && everyoneBackup && everyoneNow && String(everyoneBackup.permissions) !== String(everyoneNow.permissions)) {
    await step('Reset @everyone permissions', () => rest.request('PATCH', `/guilds/${guildId}/roles/${guildId}`, { body: { permissions: String(everyoneBackup.permissions) }, reason }));
  }

  // Role order, for the roles below the bot's own (the only ones it can move).
  if (layout) {
    const wanted = backupRoles
      .filter((r) => roleMap.has(r.id))
      .sort((a, b) => a.position - b.position)
      .map((r) => roleMap.get(r.id))
      .filter((id) => !real(id) || (roles.find((x) => x.id === id)?.position ?? 0) < botTop);
    const current = roles.filter((r) => wanted.includes(r.id)).sort((a, b) => a.position - b.position).map((r) => r.id);
    if (wanted.some((id) => !real(id)) || current.join() !== wanted.join()) {
      await step('Put roles back in order', () =>
        rest.request('PATCH', `/guilds/${guildId}/roles`, { body: wanted.filter(real).map((id, i) => ({ id, position: i + 1 })), reason }),
      );
    }
  }

  /* ---------- Channels: categories first, so channels can go back into them ---------- */
  const overwritesFor = (c) =>
    c.permission_overwrites
      .map((o) => (o.type === 1 ? o : real(roleMap.get(o.id)) ? { ...o, id: roleMap.get(o.id) } : null))
      .filter(Boolean)
      .map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }));
  const freeChannels = [...channels];
  const takeChannel = (pred) => {
    const i = freeChannels.findIndex(pred);
    return i >= 0 ? freeChannels.splice(i, 1)[0] : null;
  };
  const chanMap = new Map();
  const bodyFor = (c, type, parentId) => {
    const body = { name: c.name, type, permission_overwrites: overwritesFor(c) };
    if (parentId) body.parent_id = parentId;
    if (!isVoice(type) && type !== 4 && c.topic) body.topic = c.topic;
    if (c.nsfw) body.nsfw = true;
    if ((type === 0 || type === 15) && c.rate_limit_per_user) body.rate_limit_per_user = c.rate_limit_per_user;
    if (isVoice(type) && c.bitrate && c.bitrate <= 96000) body.bitrate = c.bitrate;
    if (type === 2 && c.user_limit) body.user_limit = c.user_limit;
    return body;
  };
  const create = async (c, parentId, label) => {
    if (dryRun) return step(label, null);
    try {
      const created = await rest.request('POST', `/guilds/${guildId}/channels`, { body: bodyFor(c, c.type, parentId), reason });
      stats.ok++;
      emit({ type: 'step', level: 'ok', msg: label });
      return created;
    } catch (err) {
      if (FALLBACK_TYPE[c.type] === undefined) {
        stats.failed++;
        emit({ type: 'step', level: 'error', msg: `${label} — ${err.message}` });
        return null;
      }
      return step(`${label} as a ${FALLBACK_TYPE[c.type] === 2 ? 'voice' : 'text'} channel (the original type needs a Community server)`, () =>
        rest.request('POST', `/guilds/${guildId}/channels`, { body: bodyFor(c, FALLBACK_TYPE[c.type], parentId), reason }),
      );
    }
  };

  const categories = backup.channels.filter((c) => c.type === 4).sort(byPosition);
  for (const c of categories) {
    const match = takeChannel((x) => x.id === c.id) || takeChannel((x) => x.type === 4 && x.name === c.name);
    if (match) {
      chanMap.set(c.id, match.id);
      if (permissions && overwriteKey(match.permission_overwrites) !== overwriteKey(overwritesFor(c))) {
        await step(`Reset permissions on category ${c.name}`, () => rest.request('PATCH', `/channels/${match.id}`, { body: { permission_overwrites: overwritesFor(c) }, reason }));
      }
    } else if (missing) {
      const created = await create(c, null, `Recreated category ${c.name}`);
      chanMap.set(c.id, created?.id || placeholder(c.id));
    }
  }

  const others = backup.channels.filter((c) => c.type !== 4).sort(byPosition);
  for (const c of others) {
    const parent = c.parent_id ? chanMap.get(c.parent_id) || null : null;
    const parentId = real(parent);
    const match =
      takeChannel((x) => x.id === c.id) ||
      takeChannel((x) => x.type === c.type && x.name === c.name && (x.parent_id || null) === parentId) ||
      takeChannel((x) => x.type === c.type && x.name === c.name);
    const label = `${isVoice(c.type) ? '🔊' : '#'}${c.name}`;
    if (match) {
      chanMap.set(c.id, match.id);
      const patch = {};
      if (permissions && overwriteKey(match.permission_overwrites) !== overwriteKey(overwritesFor(c))) patch.permission_overwrites = overwritesFor(c);
      // Back into its category (unless that category is only being recreated in a dry run).
      if (layout && (match.parent_id || null) !== parentId && (parent === null || parentId)) patch.parent_id = parentId;
      if (Object.keys(patch).length) {
        const what = [patch.parent_id !== undefined ? 'moved back into its category' : null, patch.permission_overwrites ? 'reset permissions' : null].filter(Boolean).join(', ');
        await step(`${label}: ${what}`, () => rest.request('PATCH', `/channels/${match.id}`, { body: patch, reason }));
      }
    } else if (missing) {
      const created = await create(c, parentId, `Recreated ${label}`);
      chanMap.set(c.id, created?.id || placeholder(c.id));
    }
  }

  // Channel order, using the positions saved in the backup.
  if (layout) {
    const current = new Map(channels.map((c) => [c.id, c.position]));
    const moves = backup.channels.filter((c) => real(chanMap.get(c.id))).map((c) => ({ id: chanMap.get(c.id), position: c.position }));
    const created = backup.channels.some((c) => chanMap.has(c.id) && !real(chanMap.get(c.id)));
    if (created || moves.some((m) => current.has(m.id) && current.get(m.id) !== m.position) || moves.some((m) => !current.has(m.id))) {
      await step('Put channels back in order', () => rest.request('PATCH', `/guilds/${guildId}/channels`, { body: moves, reason }));
    }
  }

  /* ---------- Server settings ---------- */
  if (settings) {
    const g = backup.guild;
    const wanted = {
      name: g.name,
      verification_level: g.verification_level,
      default_message_notifications: g.default_message_notifications,
      explicit_content_filter: g.explicit_content_filter,
      afk_timeout: g.afk_timeout,
      afk_channel_id: g.afk_channel_id ? real(chanMap.get(g.afk_channel_id)) : null,
      system_channel_id: g.system_channel_id ? real(chanMap.get(g.system_channel_id)) : null,
    };
    const changes = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => v !== undefined && (guild[k] ?? null) !== v));
    if (Object.keys(changes).length) {
      await step(`Server settings: ${Object.keys(changes).map((k) => k.replace(/_id$/, '').replace(/_/g, ' ')).join(', ')}`, () => rest.request('PATCH', `/guilds/${guildId}`, { body: changes, reason }));
    }
  }

  return stats;
}

/* ---------- Files: <root>/<guild id>/<time>[-auto].json ---------- */
const backupFile = (root, guildId, id) => {
  if (!ID.test(String(guildId)) || !/^[\w-]{1,64}$/.test(String(id))) throw new Error('Invalid backup.');
  return path.join(root, String(guildId), `${id}.json`);
};

function saveBackup(root, guildId, backup, suffix = backup.auto ? 'auto' : '') {
  const dir = path.join(root, String(guildId));
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.parse(backup.takenAt) || Date.now()}${suffix ? `-${suffix}` : ''}`;
  fs.writeFileSync(backupFile(root, guildId, id), JSON.stringify(backup));
  return id;
}

function readBackup(root, guildId, id) {
  return validateBackup(JSON.parse(fs.readFileSync(backupFile(root, guildId, id), 'utf8')));
}

// Newest first, without the bulky role and channel lists.
function listBackups(root, guildId) {
  const dir = path.join(root, String(guildId));
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^[\w-]+\.json$/.test(f));
  } catch {
    return [];
  }
  const list = [];
  for (const file of files) {
    try {
      const b = validateBackup(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      list.push({
        id: file.slice(0, -5),
        takenAt: b.takenAt,
        label: b.label || '',
        auto: !!b.auto,
        serverId: b.guild.id,
        serverName: b.guild.name,
        roles: b.roles.filter((r) => r.id !== b.guild.id && !r.managed).length,
        channels: b.channels.length,
      });
    } catch {
      // not a readable backup; leave it alone
    }
  }
  return list.sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
}

// Automatic backups roll over: only the newest few are kept.
function staleAutoBackups(root, guildId, keep = KEEP_AUTO) {
  return listBackups(root, guildId)
    .filter((b) => b.auto)
    .slice(keep)
    .map((b) => backupFile(root, guildId, b.id));
}

module.exports = { snapshotServer, restoreBackup, validateBackup, saveBackup, readBackup, listBackups, staleAutoBackups, backupFile, FORMAT };
