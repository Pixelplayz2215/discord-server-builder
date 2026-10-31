// Decides what a signed-in moderator may do. Every request is checked against the mod's own
// permissions in that server (looked up through the bot), so the portal never lets anyone do more
// than Discord itself would let them do — and only moderation actions are allowed at all.

const P = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
};
const ALL = (1n << 53n) - 1n;
// Holding any of these in a server makes you a mod there.
const MOD_ACCESS = P.KICK_MEMBERS | P.BAN_MEMBERS | P.MODERATE_MEMBERS;
const PERMISSION_NAMES = {
  [P.KICK_MEMBERS]: 'Kick Members',
  [P.BAN_MEMBERS]: 'Ban Members',
  [P.MANAGE_CHANNELS]: 'Manage Channels',
  [P.VIEW_AUDIT_LOG]: 'View Audit Log',
  [P.MANAGE_MESSAGES]: 'Manage Messages',
  [P.MANAGE_NICKNAMES]: 'Manage Nicknames',
  [P.MANAGE_ROLES]: 'Manage Roles',
  [P.MODERATE_MEMBERS]: 'Timeout Members',
};

const deny = (message, status = 403) => Object.assign(new Error(message), { status });

// Discord API calls a mod may make through the portal. Anything not listed is owner-only.
// need: permission required; target: the {u} user must rank below the mod; body: allowed fields.
const POLICY = [
  { method: 'GET', path: /^\/users\/@me\/guilds$/, special: 'guilds' },
  { method: 'GET', path: /^\/users\/(?<u>\d{15,21})$/, guildless: true },
  { method: 'GET', path: /^\/guilds\/(?<g>\d{15,21})$/ },
  { method: 'GET', path: /^\/guilds\/(?<g>\d{15,21})\/(channels|roles)$/ },
  { method: 'GET', path: /^\/guilds\/(?<g>\d{15,21})\/members\/(?<u>\d{15,21})$/ },
  { method: 'GET', path: /^\/guilds\/(?<g>\d{15,21})\/bans$/, need: P.BAN_MEMBERS },
  { method: 'PUT', path: /^\/guilds\/(?<g>\d{15,21})\/bans\/(?<u>\d{15,21})$/, need: P.BAN_MEMBERS, target: true, body: { delete_message_seconds: P.BAN_MEMBERS } },
  { method: 'DELETE', path: /^\/guilds\/(?<g>\d{15,21})\/bans\/(?<u>\d{15,21})$/, need: P.BAN_MEMBERS },
  { method: 'DELETE', path: /^\/guilds\/(?<g>\d{15,21})\/members\/(?<u>\d{15,21})$/, need: P.KICK_MEMBERS, target: true },
  { method: 'PATCH', path: /^\/guilds\/(?<g>\d{15,21})\/members\/(?<u>\d{15,21})$/, target: true, body: { communication_disabled_until: P.MODERATE_MEMBERS, nick: P.MANAGE_NICKNAMES } },
  { method: 'PUT', path: /^\/guilds\/(?<g>\d{15,21})\/members\/(?<u>\d{15,21})\/roles\/(?<r>\d{15,21})$/, need: P.MANAGE_ROLES, target: true, role: true },
  { method: 'DELETE', path: /^\/guilds\/(?<g>\d{15,21})\/members\/(?<u>\d{15,21})\/roles\/(?<r>\d{15,21})$/, need: P.MANAGE_ROLES, target: true, role: true },
  { method: 'GET', path: /^\/guilds\/(?<g>\d{15,21})\/audit-logs$/, need: P.VIEW_AUDIT_LOG },
  { method: 'PATCH', path: /^\/channels\/(?<c>\d{15,21})$/, need: P.MANAGE_CHANNELS, body: { rate_limit_per_user: P.MANAGE_CHANNELS } },
];
const QUERY_KEYS = new Set(['with_counts', 'limit', 'before', 'after', 'action_type']);

function createGuard(rest, { ttlMs = 30000 } = {}) {
  const cache = new Map();
  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await fn();
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  };
  const forget = (guildId, userId) => cache.delete(`m:${guildId}:${userId}`);

  const getMember = (guildId, userId) =>
    cached(`m:${guildId}:${userId}`, () =>
      rest.request('GET', `/guilds/${guildId}/members/${userId}`).catch((err) => {
        if (err.code === 10007 || err.code === 10013 || err.status === 404) return null;
        throw err;
      }),
    );
  const getGuild = (guildId) => cached(`g:${guildId}`, () => rest.request('GET', `/guilds/${guildId}`));
  const getRoles = (guildId) => cached(`r:${guildId}`, () => rest.request('GET', `/guilds/${guildId}/roles`));

  function permissionsOf(guild, roles, member) {
    if (!member) return 0n;
    if (guild.owner_id === member.user.id) return ALL;
    let bits = 0n;
    for (const role of roles) if (role.id === guild.id || member.roles.includes(role.id)) bits |= BigInt(role.permissions);
    return bits & P.ADMINISTRATOR ? ALL : bits;
  }

  function topPosition(guild, roles, member) {
    if (!member) return -1;
    if (guild.owner_id === member.user.id) return Infinity;
    return Math.max(0, ...roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position));
  }

  // The mod's standing in one server, or a 403 when they are not a mod there.
  async function actorIn(guildId, user) {
    const [guild, roles, member] = await Promise.all([getGuild(guildId), getRoles(guildId), getMember(guildId, user.id)]);
    const perms = permissionsOf(guild, roles, member);
    if (!member || !(perms & MOD_ACCESS)) throw deny('You are not a moderator in this server.');
    return { user, guild, roles, member, perms, top: topPosition(guild, roles, member) };
  }

  function requirePermission(actor, need) {
    if (need && !(actor.perms & need)) throw deny(`You need the ${PERMISSION_NAMES[need] || 'required'} permission in this server.`);
  }

  // Same rule Discord uses between members: you can only act on people ranked below you.
  async function requireTarget(actor, targetId) {
    if (targetId === actor.user.id) throw deny("You can't do that to yourself here.");
    if (targetId === actor.guild.owner_id) throw deny("You can't moderate the server owner.");
    const target = await getMember(actor.guild.id, targetId);
    if (target && topPosition(actor.guild, actor.roles, target) >= actor.top) throw deny('That member has a role equal to or higher than yours.');
  }

  function requireRole(actor, roleId) {
    const role = actor.roles.find((r) => r.id === roleId);
    if (!role || role.id === actor.guild.id || role.managed) throw deny('That role cannot be assigned.');
    if (role.position >= actor.top) throw deny('That role is equal to or higher than your highest role.');
  }

  // Servers the bot is in where this user is a mod.
  async function modGuilds(user) {
    const guilds = await rest.request('GET', '/users/@me/guilds', { query: { with_counts: true } });
    const results = await Promise.all(
      guilds.map((g) =>
        actorIn(g.id, user)
          .then(() => g)
          .catch(() => null),
      ),
    );
    return results.filter(Boolean);
  }

  // Checks one proxied Discord API call and returns the sanitized request to send as the bot.
  async function authorize(user, { method, path, query, body, reason }) {
    const cleanPath = String(path || '').split('?')[0];
    let rule;
    let match;
    for (const r of POLICY) {
      if (r.method === method && (match = cleanPath.match(r.path))) {
        rule = r;
        break;
      }
    }
    if (!rule) throw deny('Only the server owner can do that.');

    const cleanQuery = {};
    for (const [k, v] of Object.entries(query || {})) if (QUERY_KEYS.has(k) && ['string', 'number', 'boolean'].includes(typeof v)) cleanQuery[k] = v;

    if (rule.special === 'guilds') return { special: 'guilds' };
    if (rule.guildless) return { method, path: cleanPath, query: cleanQuery };

    const groups = match.groups || {};
    let guildId = groups.g;
    if (!guildId && groups.c) guildId = (await rest.request('GET', `/channels/${groups.c}`)).guild_id;
    if (!guildId) throw deny('That channel is not in a server.');
    const actor = await actorIn(guildId, user);
    requirePermission(actor, rule.need);

    let cleanBody;
    if (rule.body) {
      cleanBody = {};
      for (const [k, v] of Object.entries(body || {})) {
        if (!(k in rule.body)) throw deny(`Mods can't change "${k}" from the portal.`);
        requirePermission(actor, rule.body[k]);
        cleanBody[k] = v;
      }
    }
    if (rule.target) await requireTarget(actor, groups.u);
    if (rule.role) requireRole(actor, groups.r);
    if (rule.target && method !== 'GET') forget(guildId, groups.u);

    return { method, path: cleanPath, query: cleanQuery, body: cleanBody, reason: auditReason(reason, user) };
  }

  return { actorIn, requirePermission, requireTarget, modGuilds, authorize, P };
}

// via: where the action came from, e.g. "mod portal" or "/ban".
function auditReason(reason, user, via = 'mod portal') {
  const who = `by ${user.global_name || user.username} (${user.id}) via ${via}`;
  return (reason ? `${reason} — ${who}` : who).slice(0, 512);
}

module.exports = { createGuard, auditReason, P, POLICY, MOD_ACCESS };
