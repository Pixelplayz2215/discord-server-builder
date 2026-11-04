// Locking a server behind its Verify button, in one go: @everyone stops seeing channels (except the
// Verify channel, and any others picked to stay open), and the roles the button gives see what
// @everyone could see before: through their role, and named on each of those channels with View
// Channel so it shows there. Channels that let @everyone in by name stop doing so; private channels
// stay as they are. Bots whose roles relied on @everyone to see channels get View
// Channels on their own role. What was changed is kept, so unlocking puts it back. No Electron here.
const { fetchAllMembers } = require('./builder');

const P = { ADMIN: 1n << 3n, VIEW: 1n << 10n, HISTORY: 1n << 16n };
const ROLE = 0; // a permission overwrite for a role
const bits = (v) => BigInt(v || 0);
const sees = (perms) => !!(perms & P.ADMIN) || !!(perms & P.VIEW);
const problem = (message) => Object.assign(new Error(message), { status: 400 });
const GONE = new Set([10003, 10009, 10011]); // unknown channel, overwrite, role

// What locking would change. roles/channels: the server's, from Discord. botRoleIds: the bot's own
// roles. verifyChannelId: where the Verify button is; openChannelIds: others @everyone keeps seeing.
// hideVerify: the Verify channel disappears for members once they've verified (off unless asked:
// it's often the rules channel). joinRoleIds: roles new members get as soon as they join (auto
// roles); any that can see channels would let them skip the Verify button, so they're named.
function planLock({ guildId, roles, channels, botRoleIds, verifyChannelId, verifiedRoleIds, openChannelIds = [], hideVerify = false, joinRoleIds = [] }) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const verified = verifiedRoleIds.map((id) => byId.get(id)).filter(Boolean);
  if (!verified.length) throw problem('Pick the roles the Verify button gives first.');
  if (!channels.some((c) => c.id === verifyChannelId)) throw problem("The Verify button's channel is gone. Post the button again first.");
  const botTop = Math.max(0, ...botRoleIds.map((id) => byId.get(id)?.position ?? 0));
  if (!sees(botRoleIds.reduce((all, id) => all | bits(byId.get(id)?.permissions), 0n))) {
    throw problem("The bot's own role needs View Channels first, or the bot would stop seeing your channels too. Turn it on for the bot's role in Server Settings → Roles.");
  }

  // Roles that have to see channels on their own once @everyone can't: the verified roles, and bots'.
  const roleEdits = [];
  const stuckBots = [];
  for (const r of roles) {
    const isVerified = verifiedRoleIds.includes(r.id);
    const isBot = !!(r.managed && r.tags?.bot_id) && !botRoleIds.includes(r.id);
    if (r.id === guildId || (!isVerified && !isBot) || sees(bits(r.permissions))) continue;
    if (r.position >= botTop) {
      if (isVerified) throw problem(`The bot's role must be above @${r.name} to change it. Move the bot's role up in Server Settings → Roles.`);
      stuckBots.push(r.name);
      continue;
    }
    roleEdits.push({ id: r.id, name: r.name, bot: isBot, before: String(bits(r.permissions)), after: String(bits(r.permissions) | P.VIEW) });
  }

  const open = new Set([verifyChannelId, ...openChannelIds]);
  const channelEdits = [];
  for (const c of channels) {
    const overwrites = c.permission_overwrites || [];
    const current = (id) => {
      const o = overwrites.find((x) => x.id === id);
      return o ? { allow: bits(o.allow), deny: bits(o.deny) } : null;
    };
    const edits = [];
    const set = (id, allow, deny) => {
      const before = current(id);
      if (before && before.allow === allow && before.deny === deny) return;
      edits.push({ id, before: before && { allow: String(before.allow), deny: String(before.deny) }, after: { allow: String(allow), deny: String(deny) } });
    };
    const everyone = current(guildId) || { allow: 0n, deny: 0n };
    if (open.has(c.id)) {
      // Everyone can read it (the rules, the Verify button)…
      set(guildId, everyone.allow | P.VIEW | P.HISTORY, everyone.deny & ~(P.VIEW | P.HISTORY));
      // …and once verified, members don't need the Verify channel any more.
      if (hideVerify && c.id === verifyChannelId) {
        for (const r of verified) {
          const o = current(r.id) || { allow: 0n, deny: 0n };
          set(r.id, o.allow & ~P.VIEW, o.deny | P.VIEW);
        }
      }
    } else if (!(everyone.deny & P.VIEW)) {
      // Not private. If it lets @everyone in by name, that goes; and the verified roles get View
      // Channel on it, so its permissions screen shows who sees it (their role would let them anyway).
      if (everyone.allow & P.VIEW) set(guildId, everyone.allow & ~P.VIEW, everyone.deny);
      for (const r of verified) {
        const o = current(r.id) || { allow: 0n, deny: 0n };
        if (!(o.allow & P.VIEW)) set(r.id, o.allow | P.VIEW, o.deny & ~P.VIEW);
      }
    }
    if (edits.length) channelEdits.push({ id: c.id, name: c.name, type: c.type, edits });
  }

  // A role given on join that can see channels (on its own, or let in by name) lets new members in
  // without verifying.
  const joinRolesSee = joinRoleIds
    .map((id) => byId.get(id))
    .filter((r) => r && (verifiedRoleIds.includes(r.id) || sees(bits(r.permissions)) || channels.some((c) => !open.has(c.id) && (c.permission_overwrites || []).some((o) => o.id === r.id && bits(o.allow) & P.VIEW))))
    .map((r) => r.name);

  const everyoneBits = bits(byId.get(guildId)?.permissions);
  return {
    alreadyHidden: !(everyoneBits & P.VIEW),
    everyone: { before: String(everyoneBits), after: String(everyoneBits & ~P.VIEW) },
    roles: roleEdits,
    stuckBots,
    joinRolesSee,
    channels: channelEdits,
  };
}

// Makes the changes: roles that need to see first, then the channels, and @everyone last, so nobody
// who should keep access loses it on the way. Resolves to a record of what changed (for unlocking);
// a failure part way carries the record so far as err.record. onStep(done, total).
async function applyLock(rest, guildId, plan, { reason, onStep = () => {} } = {}) {
  const record = { at: Date.now(), everyone: null, roles: [], channels: [] };
  const total = plan.roles.length + plan.channels.reduce((n, c) => n + c.edits.length, 0) + 1;
  let done = 0;
  try {
    for (const r of plan.roles) {
      await rest.request('PATCH', `/guilds/${guildId}/roles/${r.id}`, { body: { permissions: r.after }, reason });
      record.roles.push({ id: r.id, before: r.before });
      onStep(++done, total);
    }
    for (const c of plan.channels) {
      const changed = { id: c.id, edits: [] };
      record.channels.push(changed);
      for (const e of c.edits) {
        await rest.request('PUT', `/channels/${c.id}/permissions/${e.id}`, { body: { type: ROLE, allow: e.after.allow, deny: e.after.deny }, reason });
        changed.edits.push({ id: e.id, before: e.before });
        onStep(++done, total);
      }
    }
    if (!plan.alreadyHidden) {
      await rest.request('PATCH', `/guilds/${guildId}/roles/${guildId}`, { body: { permissions: plan.everyone.after }, reason });
      record.everyone = plan.everyone.before;
    }
    onStep(++done, total);
    return record;
  } catch (err) {
    err.record = record;
    throw err;
  }
}

// Puts back what applyLock changed: @everyone first (so members see the server again straight
// away), then the channels, then the roles. Only the View Channels it took or gave is changed on
// roles, so other permission changes made since are kept. Channels or roles deleted since are skipped.
async function undoLock(rest, guildId, record, { reason } = {}) {
  const skipGone = (err) => {
    if (!GONE.has(err.code)) throw err;
  };
  const roles = await rest.request('GET', `/guilds/${guildId}/roles`);
  const now = (id) => bits(roles.find((r) => r.id === id)?.permissions);
  if (record.everyone != null && bits(record.everyone) & P.VIEW) {
    await rest.request('PATCH', `/guilds/${guildId}/roles/${guildId}`, { body: { permissions: String(now(guildId) | P.VIEW) }, reason });
  }
  for (const c of record.channels || []) {
    for (const e of c.edits) {
      const path = `/channels/${c.id}/permissions/${e.id}`;
      if (e.before) await rest.request('PUT', path, { body: { type: ROLE, allow: e.before.allow, deny: e.before.deny }, reason }).catch(skipGone);
      else await rest.request('DELETE', path, { reason }).catch(skipGone);
    }
  }
  for (const r of record.roles || []) {
    if (roles.some((x) => x.id === r.id) && !(bits(r.before) & P.VIEW)) {
      await rest.request('PATCH', `/guilds/${guildId}/roles/${r.id}`, { body: { permissions: String(now(r.id) & ~P.VIEW) }, reason }).catch(skipGone);
    }
  }
}

// Gives the verified roles to the people already in the server, so locking doesn't shut them out.
// Bots and members still on the rules screen are left out. onProgress(done, total).
async function giveToMembers(rest, guildId, roleIds, { reason, onProgress = () => {} } = {}) {
  let members;
  try {
    ({ members } = await fetchAllMembers(rest, guildId, 100000));
  } catch (err) {
    if (err.code === 50001 || err.status === 403) throw problem("The bot can't list the members. Turn on the Server Members Intent for it (Developer Portal → Bot), or lock without giving the role to everyone already here.");
    throw err;
  }
  const missing = members.filter((m) => !m.user.bot && !m.pending && roleIds.some((r) => !m.roles.includes(r)));
  let given = 0;
  for (const [i, m] of missing.entries()) {
    for (const role of roleIds.filter((r) => !m.roles.includes(r))) {
      try {
        await rest.request('PUT', `/guilds/${guildId}/members/${m.user.id}/roles/${role}`, { reason });
      } catch (err) {
        if (err.code === 10007) break; // they left
        if (err.code === 50013) throw problem("The bot can't give that role. Give it Manage Roles and move its role above the role it gives.");
        throw err;
      }
    }
    given++;
    onProgress(i + 1, missing.length);
  }
  return { given, checked: members.length };
}

module.exports = { planLock, applyLock, undoLock, giveToMembers };
