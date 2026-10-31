// Tests for reaction roles with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const rr = require('../src/main/reactionroles');

const G = '100000000000000001';
const CH = '300000000000000001';
const CH2 = '300000000000000002';
const BOT = '200000000000000000';
const USER = '200000000000000005';
const R = { he: '400000000000000001', she: '400000000000000002', they: '400000000000000003', gamer: '400000000000000004' };
const CUSTOM = { id: '500000000000000009', name: 'pixel', animated: false };

function fakeRest({ failRole = null, deletedMessages = [] } = {}) {
  const calls = [];
  let next = 900;
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      if (method === 'POST' && /\/channels\/\d+\/messages$/.test(path)) return { id: `7000000000000000${next++}` };
      if (method === 'PATCH' && deletedMessages.some((id) => path.endsWith(id))) throw Object.assign(new Error('Unknown Message'), { status: 404, code: 10008 });
      if (failRole && path.includes('/roles/')) throw Object.assign(new Error('Missing Permissions'), { status: 403, code: 50013 });
      return null;
    },
  };
}

const panel = (extra = {}) => ({
  id: 'p1',
  guildId: G,
  channelId: CH,
  messageId: '700000000000000001',
  title: 'Pronouns',
  message: 'Pick yours.',
  style: 'embed',
  color: 0x0bbfbc,
  listRoles: true,
  mode: 'normal',
  pairs: [
    { emoji: { name: '♂️' }, roleId: R.he, roleName: 'he/him', description: '' },
    { emoji: { name: '♀️' }, roleId: R.she, roleName: 'she/her', description: '' },
    { emoji: CUSTOM, roleId: R.they, roleName: 'they/them', description: 'any' },
  ],
  ...extra,
});

test('the panel message lists each emoji and role, as a card or plain text', () => {
  const card = rr.panelMessage(panel());
  assert.equal(card.embeds[0].title, 'Pronouns');
  assert.equal(card.embeds[0].color, 0x0bbfbc);
  assert.equal(card.embeds[0].description, `Pick yours.\n\n♂️  <@&${R.he}>\n♀️  <@&${R.she}>\n<:pixel:${CUSTOM.id}>  <@&${R.they}> · any`);
  assert.deepEqual(card.allowed_mentions, { parse: [] }, 'listing roles never pings them');
  const text = rr.panelMessage(panel({ style: 'text', listRoles: false }));
  assert.equal(text.content, '**Pronouns**\nPick yours.');
  assert.deepEqual(text.embeds, []);
});

test('panels are checked before saving', () => {
  const ok = rr.normalizePanel({ ...panel(), mode: 'weird', color: 'x' });
  assert.equal(ok.mode, 'normal');
  assert.equal(ok.color, 0x7f8cf0);
  assert.throws(() => rr.normalizePanel({ ...panel(), pairs: [] }), /at least one/);
  assert.throws(() => rr.normalizePanel({ ...panel(), pairs: [{ emoji: { name: '✌️' }, roleId: R.he }, { emoji: { name: '✌' }, roleId: R.she }] }), /its own emoji/);
  assert.throws(() => rr.normalizePanel({ ...panel(), pairs: [{ emoji: { name: '🎮' }, roleId: '' }] }), /role/);
  const many = Array.from({ length: 21 }, (_, i) => ({ emoji: { name: String.fromCodePoint(0x1f600 + i) }, roleId: R.he }));
  assert.throws(() => rr.normalizePanel({ ...panel(), pairs: many }), /20 different reactions/);
});

test('posting a new panel sends the message, then adds every reaction', async () => {
  const rest = fakeRest();
  const id = await rr.publishPanel(rest, panel({ messageId: null }), null);
  assert.equal(rest.calls[0].method, 'POST');
  assert.equal(rest.calls[0].body.content, undefined, 'a card message has no empty text');
  const reactions = rest.calls.filter((c) => c.method === 'PUT').map((c) => c.path);
  assert.deepEqual(reactions, [
    `/channels/${CH}/messages/${id}/reactions/${encodeURIComponent('♂️')}/@me`,
    `/channels/${CH}/messages/${id}/reactions/${encodeURIComponent('♀️')}/@me`,
    `/channels/${CH}/messages/${id}/reactions/${encodeURIComponent(`pixel:${CUSTOM.id}`)}/@me`,
  ]);
});

test('editing updates the message in place and takes back reactions for removed emojis', async () => {
  const rest = fakeRest();
  const before = panel();
  const after = panel({ pairs: before.pairs.slice(0, 2) });
  const id = await rr.publishPanel(rest, after, before);
  assert.equal(id, before.messageId);
  assert.equal(rest.calls[0].method, 'PATCH');
  assert.ok(rest.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/reactions/${encodeURIComponent(`pixel:${CUSTOM.id}`)}/@me`)));
  assert.ok(!rest.calls.some((c) => c.method === 'POST'));
});

test('a deleted message is posted again, and moving channels removes the old one', async () => {
  const gone = fakeRest({ deletedMessages: ['700000000000000001'] });
  const id = await rr.publishPanel(gone, panel(), panel());
  assert.notEqual(id, '700000000000000001');
  assert.ok(gone.calls.some((c) => c.method === 'POST'));

  const moving = fakeRest();
  const moved = await rr.publishPanel(moving, panel({ channelId: CH2 }), panel());
  assert.ok(moving.calls.some((c) => c.method === 'POST' && c.path === `/channels/${CH2}/messages`));
  assert.ok(moving.calls.some((c) => c.method === 'DELETE' && c.path === `/channels/${CH}/messages/700000000000000001`));
  assert.notEqual(moved, '700000000000000001');
});

function engine(p, opts) {
  const rest = fakeRest(opts);
  const problems = [];
  const e = rr.createReactionRoles({ rest, botId: BOT, panelFor: (id) => (id === p.messageId ? p : null), report: (_, problem) => problems.push(problem) });
  const reaction = (type, emoji, extra = {}) => e.handle(type, { guild_id: G, channel_id: CH, message_id: p.messageId, user_id: USER, emoji, member: { user: { id: USER }, roles: [] }, ...extra });
  return { rest, problems, e, reaction };
}

test('reacting gives the role, unreacting takes it back, and other reactions are ignored', async () => {
  const p = panel();
  const { rest, reaction } = engine(p);
  // Discord may send the emoji without the presentation selector.
  await reaction('MESSAGE_REACTION_ADD', { name: '♂', id: null });
  await reaction('MESSAGE_REACTION_ADD', { name: 'pixel', id: CUSTOM.id });
  await reaction('MESSAGE_REACTION_ADD', { name: '🍕', id: null });
  await reaction('MESSAGE_REACTION_ADD', { name: '♀️', id: null }, { user_id: BOT, member: { user: { id: BOT, bot: true }, roles: [] } });
  await reaction('MESSAGE_REACTION_ADD', { name: '♀️', id: null }, { message_id: '799999999999999999' });
  await reaction('MESSAGE_REACTION_REMOVE', { name: '♂️', id: null });
  const roleCalls = rest.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(roleCalls, [
    `PUT /guilds/${G}/members/${USER}/roles/${R.he}`,
    `PUT /guilds/${G}/members/${USER}/roles/${R.they}`,
    `DELETE /guilds/${G}/members/${USER}/roles/${R.he}`,
  ]);
  assert.match(rest.calls[0].reason, /Reaction role \(Pronouns\)/);
});

test('"pick only one" swaps the role and takes back the other reaction; "add only" keeps roles', async () => {
  const unique = panel({ mode: 'unique' });
  const u = engine(unique);
  await u.reaction('MESSAGE_REACTION_ADD', { name: '♀️', id: null }, { member: { user: { id: USER }, roles: [R.he] } });
  const calls = u.rest.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(calls.includes(`DELETE /guilds/${G}/members/${USER}/roles/${R.he}`));
  assert.ok(calls.includes(`DELETE /channels/${CH}/messages/${unique.messageId}/reactions/${encodeURIComponent('♂️')}/${USER}`));
  assert.ok(calls.includes(`PUT /guilds/${G}/members/${USER}/roles/${R.she}`));
  assert.ok(!calls.includes(`DELETE /guilds/${G}/members/${USER}/roles/${R.they}`), "roles they don't have aren't touched");

  const verify = engine(panel({ mode: 'verify' }));
  await verify.reaction('MESSAGE_REACTION_REMOVE', { name: '♂️', id: null });
  assert.equal(verify.rest.calls.length, 0);
});

test('problems are reported, and cleared reactions are put back', async () => {
  const p = panel();
  const failing = engine(p, { failRole: true });
  await failing.reaction('MESSAGE_REACTION_ADD', { name: '♂️', id: null });
  assert.match(failing.problems.pop(), /Manage Roles/);

  const { rest, e } = engine(p);
  await e.handle('MESSAGE_REACTION_REMOVE_ALL', { guild_id: G, channel_id: CH, message_id: p.messageId });
  assert.equal(rest.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/@me')).length, 3);
  await e.handle('MESSAGE_REACTION_REMOVE_EMOJI', { guild_id: G, channel_id: CH, message_id: p.messageId, emoji: { name: 'pixel', id: CUSTOM.id } });
  assert.equal(rest.calls.filter((c) => c.method === 'PUT').length, 4);
});

test('catching up gives roles to people who reacted while the bot was away, and only adds', async () => {
  const p = panel({ pairs: [panel().pairs[0]] });
  const reactors = Array.from({ length: 150 }, (_, i) => ({ id: `2100000000000${String(i).padStart(5, '0')}`, bot: false }));
  reactors.push({ id: BOT, bot: true });
  const calls = [];
  const rest = {
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      if (path.includes('/reactions/')) {
        const start = opts.query.after ? reactors.findIndex((u) => u.id === opts.query.after) + 1 : 0;
        return reactors.slice(start, start + opts.query.limit);
      }
      if (method === 'GET' && path.includes('/members/')) {
        const id = path.split('/').pop();
        return { user: { id }, roles: Number(id.slice(-1)) % 2 ? [R.he] : [] }; // odd ids already have it
      }
      return null;
    },
  };
  const e = rr.createReactionRoles({ rest, botId: BOT, panelFor: () => p });
  const result = await e.catchUp(p);
  assert.equal(result.checked, 150);
  assert.equal(result.added, 75);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 75);
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'catching up never removes roles');
});
