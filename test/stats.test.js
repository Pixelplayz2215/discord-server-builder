// Tests for server stats with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../src/main/stats');

const G = '100000000000000001';
const CH = { members: '300000000000000011', users: '300000000000000012', bots: '300000000000000013', channels: '300000000000000014', roles: '300000000000000015' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeDiscord({ members = 10, bots = 2, membersIntent = true } = {}) {
  const calls = [];
  const state = { members, bots };
  const channels = [
    { id: '300000000000000010', type: 4, name: '📊 Server Stats' },
    { id: '300000000000000020', type: 0, name: 'general' },
    ...Object.entries(CH).map(([key, id]) => ({ id, type: 2, name: `${key}: old`, parent_id: '300000000000000010' })),
  ];
  return {
    calls,
    state,
    channels,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      if (path === `/guilds/${G}`) return { id: G, approximate_member_count: state.members };
      if (path === `/guilds/${G}/channels`) return channels.map((c) => ({ ...c }));
      if (path === `/guilds/${G}/roles`) return [{ id: G }, { id: '400000000000000001' }, { id: '400000000000000002' }];
      if (path === `/guilds/${G}/members`) {
        if (!membersIntent) throw Object.assign(new Error('Missing Access'), { status: 403, code: 50001 });
        return Array.from({ length: state.members }, (_, i) => ({ user: { id: String(200000000000000000n + BigInt(i)), bot: i < state.bots } }));
      }
      const m = path.match(/^\/channels\/(\d+)$/);
      if (m && method === 'PATCH') return Object.assign(channels.find((c) => c.id === m[1]), opts.body);
      return null;
    },
  };
}

const settings = (on = Object.keys(CH), extra = {}) =>
  stats.normalizeSettings({ guildId: G, counters: Object.fromEntries(stats.COUNTERS.map(([key, , name]) => [key, { on: on.includes(key), name, channelId: CH[key] }])), ...extra });

test('numbers show in full or short, wherever {count} is', () => {
  assert.equal(stats.formatCount(1234567), '1,234,567');
  assert.deepEqual([999, 1234, 12345, 1500000].map((n) => stats.formatCount(n, 'short')), ['999', '1.2K', '12K', '1.5M']);
  assert.equal(stats.formatCount(1000, 'short'), '1K');
  assert.equal(stats.channelName('👥 Members: {count}', 1234, 'full'), '👥 Members: 1,234');
  assert.equal(stats.channelName('{count} humans', null), '… humans');
  assert.throws(() => stats.normalizeSettings({ counters: { members: { on: true, name: 'Members' } } }), /needs \{count\}/);
  assert.throws(() => stats.normalizeSettings({ counters: {} }), /at least one counter/);
  assert.equal(stats.normalizeSettings({ counters: { roles: { on: true, name: '  ' } } }).counters.roles.name, '🏷️ Roles: {count}', 'an empty name goes back to the default');
});

test('counts members, users, bots, channels and roles, and renames each counter', async () => {
  const discord = fakeDiscord({ members: 10, bots: 2 });
  const reports = [];
  const engine = stats.createStats({ rest: discord, settingsFor: () => [{ guildId: G, settings: settings() }], report: (g, s) => reports.push(s) });
  const state = await engine.refresh(G, settings());
  // 6 channels that aren't categories, including the counters themselves; @everyone isn't a role.
  assert.deepEqual(state.counts, { members: 10, channels: 6, roles: 2, bots: 2, users: 8 });
  assert.equal(state.problem, null);
  await sleep(5);
  const names = Object.fromEntries(Object.entries(CH).map(([key, id]) => [key, discord.channels.find((c) => c.id === id).name]));
  assert.deepEqual(names, { members: '👥 Members: 10', users: '🙋 Users: 8', bots: '🤖 Bots: 2', channels: '💬 Channels: 6', roles: '🏷️ Roles: 2' });
  assert.equal(discord.calls.find((c) => c.method === 'PATCH').reason, 'Server stats');
  assert.equal(reports.length, 1);
});

test('renames wait out Discord\'s limit, and the member list is read less often', async () => {
  let clock = 1_000_000;
  const discord = fakeDiscord({ members: 10, bots: 2 });
  const engine = stats.createStats({ rest: discord, settingsFor: () => [], now: () => clock });
  const patches = () => discord.calls.filter((c) => c.method === 'PATCH').length;
  const scans = () => discord.calls.filter((c) => c.path === `/guilds/${G}/members`).length;
  await engine.refresh(G, settings());
  await sleep(5);
  assert.equal(patches(), 5);

  // Someone joins a minute later: the count is read, but the channel waits.
  discord.state.members = 11;
  clock += 60e3;
  assert.equal((await engine.refresh(G, settings())).counts.members, 11);
  await sleep(5);
  assert.equal(patches(), 5, 'too soon to rename again');
  assert.equal(scans(), 1, 'the member list is kept for a while');

  clock += 5 * 60e3;
  await engine.refresh(G, settings());
  await sleep(5);
  assert.deepEqual(discord.calls.filter((c) => c.method === 'PATCH').slice(5).map((c) => c.body.name).sort(), ['👥 Members: 11', '🙋 Users: 9'], 'only what changed is renamed');

  // Nothing changed: nothing is renamed, even long after.
  clock += 60 * 60e3;
  await engine.refresh(G, settings());
  await sleep(5);
  assert.equal(patches(), 7);
  assert.equal(scans(), 2, 'read again after half an hour');
});

test('without the Server Members Intent, bots and users wait and the reason is given; deleted counters are noticed', async () => {
  const discord = fakeDiscord({ membersIntent: false });
  const engine = stats.createStats({ rest: discord, settingsFor: () => [] });
  const state = await engine.refresh(G, settings());
  await sleep(5);
  assert.equal(state.counts.bots, undefined);
  assert.match(state.problem, /Server Members Intent/);
  const named = (id) => discord.channels.find((c) => c.id === id).name;
  assert.equal(named(CH.members), '👥 Members: 10', 'the others still update');
  assert.equal(named(CH.bots), 'bots: old');

  discord.channels.splice(discord.channels.findIndex((c) => c.id === CH.roles), 1);
  const after = await stats.createStats({ rest: discord, settingsFor: () => [] }).refresh(G, settings(['members', 'roles']));
  assert.match(after.problem, /The Roles channel was deleted\. Save the setup again/);
  assert.ok(!discord.calls.some((c) => c.path === `/guilds/${G}/members` && false), 'no member list needed for members and roles');
});

test('tick refreshes servers when they are due', async () => {
  let clock = 0;
  const discord = fakeDiscord();
  const engine = stats.createStats({ rest: discord, settingsFor: () => [{ guildId: G, settings: settings(['members']) }], now: () => clock });
  const reads = () => discord.calls.filter((c) => c.path === `/guilds/${G}`).length;
  clock = 10 * 60e3;
  await engine.tick();
  await engine.tick();
  assert.equal(reads(), 1);
  clock += 5 * 60e3;
  await engine.tick();
  assert.equal(reads(), 2);
});
