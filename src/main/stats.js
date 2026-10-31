// Server stats: voice channels whose names show live counts (members, users, bots, channels, roles),
// renamed as the numbers change while the app is open or in the tray. Members can see them but not
// join. Counts come from Discord's API every few minutes; bots and users need the member list, which
// needs the Server Members Intent. Discord lets a bot rename a channel only twice every 10 minutes,
// so each channel is renamed at most once every 5 minutes. No Electron here.
const { fetchAllMembers } = require('./builder');

// [key, label, default name, what it counts]
const COUNTERS = [
  ['members', 'Members', '👥 Members: {count}', 'Everyone in the server'],
  ['users', 'Users', '🙋 Users: {count}', "Members who aren't bots"],
  ['bots', 'Bots', '🤖 Bots: {count}', 'Bot accounts'],
  ['channels', 'Channels', '💬 Channels: {count}', 'Text, voice, forum and announcement channels'],
  ['roles', 'Roles', '🏷️ Roles: {count}', 'Roles, not counting @everyone'],
];
const NEEDS_MEMBER_LIST = new Set(['users', 'bots']);
const REFRESH_EVERY_MS = 5 * 60 * 1000;
const RENAME_EVERY_MS = 5 * 60 * 1000 + 15 * 1000; // a little over half of Discord's 10-minute window
const SCAN_EVERY_MS = 30 * 60 * 1000; // the member list (for bots) is read less often: it's slow on big servers
const MAX_SCAN = 200000;
const CATEGORY = 4;
const CONNECT = 1n << 20n;
const MEMBER_INTENT_HELP = 'Bots and Users need the member list. Turn on the Server Members Intent for your bot in the Developer Portal (Bot → Privileged Gateway Intents).';

const problem = (message) => Object.assign(new Error(message), { status: 400 });
const isId = (v) => /^\d{15,21}$/.test(String(v || ''));

function formatCount(n, format = 'full') {
  if (format !== 'short' || n < 1000) return Number(n).toLocaleString('en-US');
  const [div, unit] = n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const value = n / div;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.floor(value)}${unit}`;
}

// A counter's channel name: its template with the number in place of {count} ("…" until it's known).
const channelName = (template, count, format) => String(template).replace(/\{count\}/g, count == null ? '…' : formatCount(count, format)).trim().slice(0, 100);

// Checks and tidies a server's stats settings from the app.
function normalizeSettings(input) {
  const counters = {};
  for (const [key, label, name] of COUNTERS) {
    const c = input?.counters?.[key] || {};
    const template = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 90) : name;
    if (c.on && !template.includes('{count}')) throw problem(`The ${label} counter's name needs {count} where the number goes.`);
    counters[key] = { on: !!c.on, name: template, channelId: isId(c.channelId) ? String(c.channelId) : '' };
  }
  if (!Object.values(counters).some((c) => c.on)) throw problem('Turn on at least one counter.');
  return {
    guildId: isId(input?.guildId) ? String(input.guildId) : '',
    guildName: String(input?.guildName || '').slice(0, 100),
    categoryId: isId(input?.categoryId) ? String(input.categoryId) : '',
    categoryName: String(input?.categoryName || '').slice(0, 100),
    madeCategory: !!input?.madeCategory,
    format: input?.format === 'short' ? 'short' : 'full',
    counters,
  };
}

// Members, channels and roles straight from the API (and the channels, to see the counters' names).
async function countBasics(rest, guildId) {
  const [guild, channels, roles] = await Promise.all([
    rest.request('GET', `/guilds/${guildId}`, { query: { with_counts: true } }),
    rest.request('GET', `/guilds/${guildId}/channels`),
    rest.request('GET', `/guilds/${guildId}/roles`),
  ]);
  return {
    channels,
    counts: { members: guild.approximate_member_count ?? guild.member_count ?? null, channels: channels.filter((c) => c.type !== CATEGORY).length, roles: roles.filter((r) => r.id !== guildId).length },
  };
}

// settingsFor(): the servers with stats, as [{ guildId, settings }].
// report(guildId, { counts, updatedAt, problem }): the latest counts and any problem, for the app.
function createStats({ rest, settingsFor, report = () => {}, now = Date.now, refreshEveryMs = REFRESH_EVERY_MS, renameEveryMs = RENAME_EVERY_MS, scanEveryMs = SCAN_EVERY_MS, maxScan = MAX_SCAN }) {
  const servers = new Map(); // guildId -> { refreshedAt, running, bots, scannedAt, renamedAt: {}, renaming: Set }
  const serverOf = (id) => {
    if (!servers.has(id)) servers.set(id, { refreshedAt: 0, running: false, bots: null, scannedAt: 0, renamedAt: {}, renaming: new Set() });
    return servers.get(id);
  };

  async function refresh(guildId, settings, { force = false } = {}) {
    const s = serverOf(guildId);
    if (s.running) return null;
    s.running = true;
    const problems = [];
    let counts = null;
    try {
      const basics = await countBasics(rest, guildId);
      counts = basics.counts;
      const on = COUNTERS.filter(([key]) => settings.counters[key]?.on);

      if (on.some(([key]) => NEEDS_MEMBER_LIST.has(key))) {
        if (force || s.bots == null || now() - s.scannedAt >= scanEveryMs) {
          try {
            const { members, truncated } = await fetchAllMembers(rest, guildId, maxScan);
            s.bots = members.filter((m) => m.user?.bot).length;
            s.scannedAt = now();
            if (truncated) problems.push(`This server has over ${maxScan.toLocaleString('en-US')} members, so Bots and Users only count the first ${maxScan.toLocaleString('en-US')}.`);
          } catch (err) {
            if (err.code === 50001 || err.status === 403) problems.push(MEMBER_INTENT_HELP);
            else problems.push(`Couldn't read the member list: ${err.message}`);
          }
        }
        if (s.bots != null) Object.assign(counts, { bots: s.bots, users: Math.max(0, counts.members - s.bots) });
      }

      // Rename the counters whose number changed, each at most once every few minutes. Renames run
      // on their own, so one channel waiting on Discord's limit doesn't hold up the rest.
      const byId = new Map(basics.channels.map((c) => [c.id, c]));
      for (const [key, label] of on) {
        const c = settings.counters[key];
        const channel = byId.get(c.channelId);
        if (!channel) {
          problems.push(`The ${label} channel was deleted. Save the setup again to make it.`);
          continue;
        }
        if (counts[key] == null) continue;
        const want = channelName(c.name, counts[key], settings.format);
        if (channel.name === want || s.renaming.has(c.channelId) || now() - (s.renamedAt[c.channelId] || 0) < renameEveryMs) continue;
        s.renaming.add(c.channelId);
        s.renamedAt[c.channelId] = now();
        rest
          .request('PATCH', `/channels/${c.channelId}`, { body: { name: want }, reason: 'Server stats' })
          .catch((err) => report(guildId, { counts, updatedAt: now(), problem: err.code === 50013 || err.code === 50001 ? 'The bot needs Manage Channels to update the counters.' : `Couldn't rename the ${label} channel: ${err.message}` }))
          .finally(() => s.renaming.delete(c.channelId));
      }
    } catch (err) {
      problems.push(err.code === 50001 || err.code === 50013 ? "The bot can't see this server's channels or roles." : err.message);
    } finally {
      s.running = false;
      s.refreshedAt = now();
    }
    const state = { counts, updatedAt: now(), problem: problems.join(' ') || null };
    report(guildId, state);
    return state;
  }

  // Refreshes every server that's due.
  async function tick() {
    for (const { guildId, settings } of settingsFor()) {
      if (now() - serverOf(guildId).refreshedAt >= refreshEveryMs) await refresh(guildId, settings);
    }
  }

  return { refresh, tick, forget: (guildId) => servers.delete(guildId) };
}

module.exports = { createStats, normalizeSettings, countBasics, channelName, formatCount, COUNTERS, NEEDS_MEMBER_LIST, CONNECT, MEMBER_INTENT_HELP };
