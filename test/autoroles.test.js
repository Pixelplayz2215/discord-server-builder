// Tests for auto roles and the Verify button with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const ar = require('../src/main/autoroles');

const G = '100000000000000001';
const R = { member: '400000000000000001', bot: '400000000000000002', verified: '400000000000000003', high: '400000000000000009' };
const ANNA = { id: '200000000000000005', username: 'anna' };
const BEEP = { id: '200000000000000006', username: 'beep', bot: true };

function fakeDiscord({ members = [], gone = [] } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      if (path === `/guilds/${G}/members`) return members;
      const m = path.match(/members\/(\d+)\/roles\/(\d+)$/);
      if (m && gone.includes(m[1])) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
      if (m && m[2] === R.high) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      return null;
    },
  };
}
const given = (discord) => discord.calls.filter((c) => c.method === 'PUT').map((c) => c.path.replace(`/guilds/${G}/members/`, ''));
const settings = (extra = {}) => ar.normalizeSettings({ guildId: G, enabled: true, roles: [R.member], botRoles: [R.bot], ...extra });

test('settings are checked: roles to give, a known delay, and a Verify button that names its roles', () => {
  assert.throws(() => ar.normalizeSettings({ guildId: G, enabled: true }), /at least one role/);
  assert.throws(() => ar.normalizeSettings({ guildId: G, verify: { enabled: true, roles: [R.verified] } }), /channel for the Verify button/);
  const s = ar.normalizeSettings({ guildId: G, enabled: true, roles: [R.member, R.member, 'x'], delay: 42 });
  assert.deepEqual(s.roles, [R.member]);
  assert.equal(s.delay, 0);
  const v = ar.verifyMessage(ar.normalizeSettings({ guildId: G, verify: { enabled: true, channelId: '300000000000000001', roles: [R.verified, R.member] } }).verify);
  const button = v.components[0].components[0];
  assert.equal(button.custom_id, `av:${R.verified},${R.member}`);
  assert.equal(button.style, 3);
  assert.deepEqual(ar.parseVerifyId(button.custom_id), [R.verified, R.member]);
  assert.equal(ar.parseVerifyId('tk:open:1:2'), null);
  assert.equal(v.embeds[0].title, 'Welcome! Please verify');
});

test('new members get their roles, bots get the bot roles, and screening waits for the rules', async () => {
  const discord = fakeDiscord();
  const problems = [];
  const engine = ar.createAutoRoles({ rest: discord, settingsFor: () => settings(), report: (g, p) => problems.push(p) });
  await engine.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA, roles: [] });
  await engine.handle('GUILD_MEMBER_ADD', { guild_id: G, user: BEEP, roles: [] });
  assert.deepEqual(given(discord), [`${ANNA.id}/roles/${R.member}`, `${BEEP.id}/roles/${R.bot}`]);
  assert.equal(discord.calls[0].reason, 'Auto role for new members');

  // Membership Screening: nothing until they accept the rules.
  const screened = { id: '200000000000000007', username: 'newbie' };
  await engine.handle('GUILD_MEMBER_ADD', { guild_id: G, user: screened, pending: true });
  await engine.handle('GUILD_MEMBER_UPDATE', { guild_id: G, user: screened, pending: true, roles: [] });
  assert.equal(given(discord).length, 2);
  await engine.handle('GUILD_MEMBER_UPDATE', { guild_id: G, user: screened, pending: false, roles: [] });
  assert.equal(given(discord).at(-1), `${screened.id}/roles/${R.member}`);
  // Later updates of the same member don't give the role again.
  await engine.handle('GUILD_MEMBER_UPDATE', { guild_id: G, user: screened, pending: false, roles: [R.member] });
  assert.equal(given(discord).length, 3);
  assert.deepEqual(problems, [null, null, null]);
});

test('a wait before giving roles is cancelled when they leave, and problems are explained', async () => {
  const timers = [];
  const cleared = [];
  const discord = fakeDiscord();
  const problems = [];
  const engine = ar.createAutoRoles({ rest: discord, settingsFor: () => settings({ delay: 300, roles: [R.member, R.high] }), report: (g, p) => problems.push(p), setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: (t) => cleared.push(t) });
  engine.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA, roles: [] });
  engine.handle('GUILD_MEMBER_ADD', { guild_id: G, user: { id: '200000000000000008', username: 'raider' }, roles: [] });
  assert.deepEqual(timers.map((t) => t.ms), [300000, 300000]);
  assert.equal(given(discord).length, 0, 'nothing yet');
  engine.handle('GUILD_MEMBER_REMOVE', { guild_id: G, user: { id: '200000000000000008' } });
  assert.deepEqual(cleared, [2]);
  await timers[0].fn();
  assert.deepEqual(given(discord), [`${ANNA.id}/roles/${R.member}`, `${ANNA.id}/roles/${R.high}`]);
  assert.match(problems[0], /move its role above the roles it gives/);
});

test('existing members without the roles get them, with progress', async () => {
  const members = [
    { user: ANNA, roles: [] },
    { user: { id: '200000000000000010', username: 'has' }, roles: [R.member] },
    { user: BEEP, roles: [] },
    { user: { id: '200000000000000011', username: 'screening' }, roles: [], pending: true },
    { user: { id: '200000000000000012', username: 'left' }, roles: [] },
  ];
  const discord = fakeDiscord({ members, gone: ['200000000000000012'] });
  const progress = [];
  const engine = ar.createAutoRoles({ rest: discord, settingsFor: () => settings() });
  const result = await engine.giveExisting(G, (done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(result, { given: 2, checked: 5 });
  assert.deepEqual(given(discord), [`${ANNA.id}/roles/${R.member}`, `${BEEP.id}/roles/${R.bot}`, `200000000000000012/roles/${R.member}`]);
  assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
});

test('the Verify button gives the roles a member is missing, and tells only them', async () => {
  const discord = fakeDiscord();
  const verify = ar.createVerify({ rest: discord });
  const press = (roles) => ({ type: 3, application_id: '1', token: 't', guild_id: G, member: { user: ANNA, roles }, data: { custom_id: `av:${R.verified},${R.member}` } });
  const done = await verify.interaction(press([]));
  assert.deepEqual(done.response, { type: 5, data: { flags: 64 } }, 'only they see the reply');
  await done.after();
  assert.deepEqual(given(discord), [`${ANNA.id}/roles/${R.verified}`, `${ANNA.id}/roles/${R.member}`]);
  assert.equal(discord.calls.at(-1).body.content, "✅ You're verified. Welcome in!");

  const again = await verify.interaction(press([R.verified, R.member]));
  assert.deepEqual(again.response, { type: 4, data: { content: "You're already verified. 👍", flags: 64 } });
  assert.equal(await verify.interaction({ ...press([]), data: { custom_id: 'tk:open:1:2' } }), null);
});
