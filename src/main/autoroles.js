// Auto roles: roles given to everyone who joins (bots can get their own), right away or after a
// wait, and a Verify button members press to get roles. If the server uses Membership Screening,
// roles wait until the member accepts the rules. Joins need the Server Members Intent and are handled
// while the app is open or in the tray. The Verify button is answered by the mod portal when the
// bot's interactions go there, otherwise by the app; the roles it gives are in its custom ID
// (av:<role>,<role>), so it needs no stored settings. No Electron here.
const { fetchAllMembers } = require('./builder');

const DELAYS = [0, 60, 300, 600, 1800, 3600]; // seconds
const MAX_ROLES = 4; // four role IDs fit in a button's 100-character custom ID
const STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 };
const DEFAULT_VERIFY = {
  title: 'Welcome! Please verify',
  text: 'Press the button below to confirm you have read the rules and get access to the rest of the server.',
  color: 0x0bbfbc,
  button: { label: 'Verify', emoji: { name: '✅' }, style: 'success' },
};

const isId = (v) => /^\d{15,21}$/.test(String(v || ''));
const roleList = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter(isId))].slice(0, MAX_ROLES);
const str = (v, max, fallback) => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

function cleanEmoji(e) {
  if (!e || (!e.id && !e.name)) return null;
  if (e.id) return isId(e.id) ? { id: String(e.id), name: String(e.name || 'emoji').replace(/[^\w]/g, '').slice(0, 32) || 'emoji', animated: !!e.animated } : null;
  return { name: String(e.name).trim().slice(0, 32) };
}

// Checks and tidies a server's settings from the app.
function normalizeSettings(input) {
  const v = input?.verify || {};
  const delay = Number(input?.delay);
  const color = Number(v.color);
  const s = {
    guildId: isId(input?.guildId) ? String(input.guildId) : '',
    guildName: str(input?.guildName, 100, ''),
    enabled: !!input?.enabled,
    roles: roleList(input?.roles),
    botRoles: roleList(input?.botRoles),
    delay: DELAYS.includes(delay) ? delay : 0,
    verify: {
      enabled: !!v.enabled,
      channelId: isId(v.channelId) ? String(v.channelId) : '',
      channelName: str(v.channelName, 100, ''),
      messageId: isId(v.messageId) ? String(v.messageId) : '',
      roles: roleList(v.roles),
      title: str(v.title, 256, DEFAULT_VERIFY.title),
      text: str(v.text, 2000, DEFAULT_VERIFY.text),
      color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : DEFAULT_VERIFY.color,
      button: {
        label: str(v.button?.label, 80, '') || DEFAULT_VERIFY.button.label,
        emoji: v.button && 'emoji' in v.button ? cleanEmoji(v.button.emoji) : DEFAULT_VERIFY.button.emoji,
        style: STYLES[v.button?.style] ? v.button.style : DEFAULT_VERIFY.button.style,
      },
    },
  };
  // Role names, only to show them in the app.
  const names = input?.roleNames && typeof input.roleNames === 'object' ? input.roleNames : {};
  s.roleNames = Object.fromEntries([...new Set([...s.roles, ...s.botRoles, ...s.verify.roles])].map((id) => [id, String(names[id] || '').slice(0, 100)]));
  if (s.enabled && !s.roles.length && !s.botRoles.length) throw Object.assign(new Error('Pick at least one role to give.'), { status: 400 });
  if (s.verify.enabled && (!s.verify.channelId || !s.verify.roles.length)) throw Object.assign(new Error('Pick the channel for the Verify button and the roles it gives.'), { status: 400 });
  return s;
}

const verifyId = (roles) => `av:${roles.join(',')}`;
function parseVerifyId(id) {
  const m = String(id || '').match(/^av:(\d{15,21}(?:,\d{15,21}){0,3})$/);
  return m ? m[1].split(',') : null;
}

// The message with the Verify button.
function verifyMessage(v) {
  const button = { type: 2, style: STYLES[v.button.style], label: v.button.label, custom_id: verifyId(v.roles) };
  if (v.button.emoji) button.emoji = v.button.emoji;
  const embed = { color: v.color, description: v.text || 'Press the button below to verify.' };
  if (v.title) embed.title = v.title;
  return { content: '', embeds: [embed], components: [{ type: 1, components: [button] }], allowed_mentions: { parse: [] } };
}

const explain = (err) =>
  err.code === 50013 ? "The bot can't give that role. Give it Manage Roles and move its role above the roles it gives." : err.code === 10011 ? 'One of the roles was deleted. Pick the roles again.' : err.message;

// Gives roles one by one. Resolves to null, 'left' when they're no longer in the server, or a problem.
async function giveRoles(rest, guildId, userId, roles, reason) {
  for (const role of roles) {
    try {
      await rest.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${role}`, { reason });
    } catch (err) {
      if (err.code === 10007 || err.code === 10013) return 'left';
      return explain(err);
    }
  }
  return null;
}

// settingsFor(guildId): the server's normalized settings, or null.
// report(guildId, problem): the latest problem (null once roles are given fine).
function createAutoRoles({ rest, settingsFor, report = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const waiting = new Map(); // `${guild}:${user}` -> timer, or 'screening' while they haven't accepted the rules

  function give(guildId, user, delay) {
    const key = `${guildId}:${user.id}`;
    const run = async () => {
      waiting.delete(key);
      const s = settingsFor(guildId);
      if (!s?.enabled) return;
      const roles = user.bot ? s.botRoles : s.roles;
      if (!roles.length) return;
      const problem = await giveRoles(rest, guildId, user.id, roles, 'Auto role for new members');
      if (problem !== 'left') report(guildId, problem);
    };
    if (!delay) return run();
    waiting.set(key, setTimer(run, delay * 1000));
    return null;
  }

  function handle(type, d) {
    if (!d?.guild_id || !d.user) return null;
    const key = `${d.guild_id}:${d.user.id}`;
    if (type === 'GUILD_MEMBER_REMOVE') {
      const timer = waiting.get(key);
      if (timer && timer !== 'screening') clearTimer(timer);
      waiting.delete(key);
      return null;
    }
    const s = settingsFor(d.guild_id);
    if (!s?.enabled) return null;
    if (type === 'GUILD_MEMBER_ADD') {
      // Membership Screening: their roles wait until they accept the rules.
      if (d.pending) {
        waiting.set(key, 'screening');
        return null;
      }
      return give(d.guild_id, d.user, s.delay);
    }
    if (type === 'GUILD_MEMBER_UPDATE' && waiting.get(key) === 'screening' && !d.pending) {
      waiting.delete(key);
      return give(d.guild_id, d.user, s.delay);
    }
    return null;
  }

  // Gives the roles to members who joined before (or while the app was closed). onProgress(done, total).
  async function giveExisting(guildId, onProgress = () => {}) {
    const s = settingsFor(guildId);
    if (!s) throw new Error("This server's auto roles aren't set up.");
    const { members } = await fetchAllMembers(rest, guildId, 100000);
    const missing = members.filter((m) => !m.pending && (m.user.bot ? s.botRoles : s.roles).some((r) => !m.roles.includes(r)));
    let given = 0;
    for (const [i, m] of missing.entries()) {
      const roles = (m.user.bot ? s.botRoles : s.roles).filter((r) => !m.roles.includes(r));
      const problem = await giveRoles(rest, guildId, m.user.id, roles, 'Auto role for existing members');
      if (problem && problem !== 'left') {
        report(guildId, problem);
        throw new Error(problem);
      }
      if (!problem) given++;
      onProgress(i + 1, missing.length);
    }
    return { given, checked: members.length };
  }

  return { handle, giveExisting };
}

// Answers Verify buttons: gives the roles the member doesn't have yet, and tells only them.
function createVerify({ rest }) {
  async function interaction(i) {
    if (i?.type !== 3 || !i.guild_id || !i.member?.user) return null;
    const roles = parseVerifyId(i.data?.custom_id);
    if (!roles) return null;
    const missing = roles.filter((r) => !(i.member.roles || []).includes(r));
    if (!missing.length) return { response: { type: 4, data: { content: "You're already verified. 👍", flags: 64 } } };
    return {
      response: { type: 5, data: { flags: 64 } },
      after: async () => {
        const problem = await giveRoles(rest, i.guild_id, i.member.user.id, missing, 'Verified with the Verify button');
        const content = problem ? `✗ ${problem === 'left' ? 'Something went wrong.' : problem} Let a moderator know.` : "✅ You're verified. Welcome in!";
        await rest.request('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { body: { content, allowed_mentions: { parse: [] } } }).catch(() => {});
      },
    };
  }
  return { interaction };
}

module.exports = { createAutoRoles, createVerify, normalizeSettings, verifyMessage, parseVerifyId, giveRoles, DELAYS, MAX_ROLES, DEFAULT_VERIFY };
