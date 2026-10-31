// Tests for the slash commands with a fake Discord. Run: npm run test:portal
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createAuth } = require('./auth');
const { createGuard, P } = require('./guard');
const { createInteractions, verifySignature, publicKey } = require('./interactions');
const { createPortal } = require('./index');
const { COMMANDS } = require('../src/main/commands');
const { transcriptSignature } = require('../src/main/tickets');

const G = '100000000000000001';
const CH = '300000000000000001';
const THREAD = '300000000000000002';
const BOT = '200000000000000000';
const OWNER = '200000000000000001';
const ADMIN = '200000000000000002';
const MOD = '200000000000000003';
const HELPER = '200000000000000004';
const MEMBER = '200000000000000005';
const QUIET = '200000000000000006'; // a member whose DMs are closed
const R = { admin: '400000000000000001', mod: '400000000000000002', helper: '400000000000000003', member: '400000000000000004', bot: '400000000000000005' };

const { publicKey: pub, privateKey } = crypto.generateKeyPairSync('ed25519');
const VERIFY_KEY = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const perms = (...bits) => String(bits.reduce((a, b) => a | b, 0n));

function fakeDiscord() {
  const calls = [];
  const replies = {}; // interaction token -> reply body
  const roles = [
    { id: G, name: '@everyone', position: 0, permissions: '0' },
    { id: R.member, name: 'Member', position: 1, permissions: '0' },
    { id: R.helper, name: 'Helper', position: 2, permissions: perms(P.MODERATE_MEMBERS) },
    { id: R.mod, name: 'Mod', position: 3, permissions: perms(P.KICK_MEMBERS, P.BAN_MEMBERS, P.MODERATE_MEMBERS, P.MANAGE_MESSAGES, P.MANAGE_CHANNELS) },
    { id: R.admin, name: 'Admin', position: 5, permissions: perms(P.ADMINISTRATOR) },
    { id: R.bot, name: 'Bot', position: 6, permissions: perms(P.ADMINISTRATOR), managed: true },
  ];
  const members = { [OWNER]: [], [ADMIN]: [R.admin], [MOD]: [R.mod], [HELPER]: [R.helper], [MEMBER]: [R.member], [QUIET]: [R.member], [BOT]: [R.bot] };
  const channels = [{ id: CH, type: 0, name: 'general', permission_overwrites: [] }];
  const messages = {}; // channel id -> newest first
  const transcripts = {}; // log message id -> message with a transcript attached
  let next = 500000000000000000n;
  const newId = () => String(next++);
  const error = (status, code, message) => Object.assign(new Error(message), { status, code });

  return {
    calls,
    replies,
    channels,
    messages,
    transcripts,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      let m;
      if (path === '/applications/@me') return { id: BOT, verify_key: VERIFY_KEY };
      if (path === '/users/@me') return { id: BOT, username: 'bot' };
      if (path === `/guilds/${G}` && method === 'GET') return { id: G, name: 'Main', owner_id: OWNER };
      if (path === `/guilds/${G}/roles`) return roles;
      if ((m = path.match(/^\/guilds\/\d+\/members\/(\d+)$/)) && method === 'GET') {
        if (!members[m[1]]) throw error(404, 10007, 'Unknown member');
        return { user: { id: m[1] }, roles: members[m[1]] };
      }
      if (path === `/guilds/${G}/channels`) {
        if (method === 'GET') return channels;
        const created = { id: newId(), ...opts.body };
        channels.push(created);
        return created;
      }
      if ((m = path.match(/^\/channels\/(\d+)\/messages$/))) {
        const list = (messages[m[1]] ||= []);
        if (method === 'POST') {
          if (m[1] === `9${QUIET.slice(1)}`) throw error(403, 50007, 'Cannot send messages to this user');
          const msg = { id: newId(), author: { id: BOT }, timestamp: new Date().toISOString(), ...opts.body };
          list.unshift(msg);
          return msg;
        }
        const start = opts.query?.before ? list.findIndex((x) => x.id === opts.query.before) + 1 : 0;
        return list.slice(start, start + (opts.query?.limit || 50));
      }
      if ((m = path.match(/^\/channels\/\d+\/messages\/(\d+)$/)) && method === 'GET' && transcripts[m[1]]) return transcripts[m[1]];
      if (path === '/users/@me/channels') return { id: `9${opts.body.recipient_id.slice(1)}` };
      if ((m = path.match(/^\/channels\/(\d+)$/)) && method === 'GET') return channels.find((c) => c.id === m[1]) || { id: m[1], guild_id: G, type: 0, permission_overwrites: [] };
      if (path === `/guilds/${G}/emojis`) return [{ id: '800000000000000001', name: 'pepe', animated: false }, { id: '800000000000000002', name: 'party_parrot', animated: true }];
      // An emoji from a server the bot isn't in.
      if (method === 'PUT' && /\/reactions\/ghost%3A\d+\/@me$/.test(path)) throw error(400, 10014, 'Unknown Emoji');
      if ((m = path.match(/^\/webhooks\/\d+\/([^/]+)\/messages\/@original$/))) {
        replies[m[1]] = opts.body;
        return {};
      }
      return { ok: true };
    },
  };
}

async function startPortal({ tickets = null, fetchImpl } = {}) {
  const discord = fakeDiscord();
  const guard = createGuard(discord);
  const config = { publicUrl: 'http://localhost', clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/auth/callback', sessionSecret: 'z'.repeat(32), sessionDays: 7 };
  const server = createPortal({ config, rest: discord, auth: createAuth(config), guard, fetchImpl, interactions: createInteractions({ rest: discord, guard, tickets }) });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/interactions`;

  const post = async (payload, { signature, timestamp = String(Math.floor(Date.now() / 1000)) } = {}) => {
    const body = JSON.stringify(payload);
    const sig = signature ?? crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': timestamp }, body });
    return { status: res.status, json: await res.json() };
  };

  let count = 0;
  // Sends a slash command and waits for the portal's follow-up reply.
  const run = async (name, options = {}, { by = MOD, channel = { id: CH, type: 0 }, permissions, appPermissions } = {}) => {
    const token = `tok-${++count}`;
    const users = {};
    const resolvedMembers = {};
    for (const [key, value] of Object.entries(options)) {
      if (['member', 'user'].includes(key)) {
        users[value] = { id: value, username: `user${value.slice(-1)}` };
        if (value !== '999999999999999999') resolvedMembers[value] = { roles: [] };
      }
    }
    const { status, json } = await post({
      type: 2,
      id: newInteractionId(),
      application_id: BOT,
      token,
      guild_id: G,
      channel_id: channel.id,
      channel,
      member: { user: { id: by, username: `user${by.slice(-1)}` }, roles: [], permissions },
      app_permissions: appPermissions,
      data: { name, options: Object.entries(options).map(([key, value]) => ({ name: key, value })), resolved: { users, members: resolvedMembers } },
    });
    assert.equal(status, 200);
    assert.deepEqual(json, { type: 5, data: { flags: 64 } });
    for (let i = 0; i < 200 && !discord.replies[token]; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(discord.replies[token], `no reply to /${name}`);
    return discord.replies[token];
  };
  return { discord, server, post, run };
}
let interactionIds = 0;
const newInteractionId = () => String(700000000000000000n + BigInt(++interactionIds));

test('command definitions are valid for Discord', () => {
  const names = new Set();
  for (const c of COMMANDS) {
    assert.match(c.name, /^[a-z_-]{1,32}$/);
    assert.ok(!names.has(c.name), `duplicate /${c.name}`);
    names.add(c.name);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, `/${c.name} description is ${c.description.length} characters`);
    if (c.default_member_permissions !== null) assert.match(c.default_member_permissions, /^\d+$/);
    let optionalSeen = false;
    for (const o of c.options) {
      assert.match(o.name, /^[a-z0-9_-]{1,32}$/);
      assert.ok(o.description.length <= 100, `/${c.name} ${o.name} description too long`);
      assert.ok(!(o.autocomplete && o.choices), `/${c.name} ${o.name} can't have both autocomplete and choices`);
      if (o.required) assert.ok(!optionalSeen, `/${c.name}: required option ${o.name} after an optional one`);
      else optionalSeen = true;
      if (o.choices) {
        assert.ok(o.choices.length <= 25);
        for (const ch of o.choices) assert.ok(ch.name.length <= 100);
      }
    }
  }
});

test('requests need a valid, recent Discord signature', async () => {
  const key = publicKey(VERIFY_KEY);
  const body = Buffer.from('{"type":1}');
  const now = String(Math.floor(Date.now() / 1000));
  const sign = (ts) => crypto.sign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');
  assert.equal(verifySignature(key, sign(now), now, body), true);
  assert.equal(verifySignature(key, sign(now), now, Buffer.from('{"type":2}')), false);
  const old = String(Number(now) - 3600);
  assert.equal(verifySignature(key, sign(old), old, body), false);
  assert.equal(verifySignature(key, 'nope', now, body), false);

  const { server, post } = await startPortal();
  try {
    assert.deepEqual((await post({ type: 1 })).json, { type: 1 });
    assert.equal((await post({ type: 1 }, { signature: '0'.repeat(128) })).status, 401);
    const unknown = await post({ type: 2, data: { name: 'dance' }, guild_id: G, member: { user: { id: MOD } } });
    assert.equal(unknown.json.type, 4);
    assert.equal(unknown.json.data.flags, 64);
    assert.match(unknown.json.data.content, /doesn't know that command/);
  } finally {
    server.close();
  }
});

test('/warn DMs the member and records numbered cases in a private #mod-cases', async () => {
  const { discord, server, run } = await startPortal();
  try {
    const first = await run('warn', { member: MEMBER, reason: 'spam' });
    assert.match(first.content, /Warned <@200000000000000005> \(case 1\)\. They have 1 warning now\.$/);
    const second = await run('warn', { member: MEMBER, reason: 'more spam' });
    assert.match(second.content, /\(case 2\)\. They have 2 warnings now\./);
    assert.deepEqual(second.allowed_mentions, { parse: [] });

    const log = discord.channels.find((c) => c.name === 'mod-cases');
    assert.ok(log, '#mod-cases was not created');
    const everyone = log.permission_overwrites.find((o) => o.id === G);
    assert.equal(BigInt(everyone.deny) & (1n << 10n), 1n << 10n, '@everyone should not see #mod-cases');
    const readers = log.permission_overwrites.filter((o) => o.type === 0 && o.id !== G).map((o) => o.id).sort();
    assert.deepEqual(readers, [R.mod, R.helper].sort());
    assert.ok(log.permission_overwrites.some((o) => o.id === BOT && o.type === 1));

    const [latest] = discord.messages[log.id];
    assert.equal(latest.embeds[0].title, 'Case 2 · Warn');
    assert.equal(latest.embeds[0].footer.text, `Member ID ${MEMBER} · Moderator ID ${MOD} · warn`);
    assert.equal(discord.messages[`9${MEMBER.slice(1)}`].length, 2, 'the member should get a DM per warning');
    assert.match(discord.messages[`9${MEMBER.slice(1)}`][0].content, /warned in \*\*Main\*\*.*\n\*\*Reason:\*\* more spam/s);

    const quiet = await run('warn', { member: QUIET, reason: 'x' });
    assert.match(quiet.content, /\(case 3\).*DMs are closed/);
  } finally {
    server.close();
  }
});

test('commands follow the mod\'s own permissions and rank', async () => {
  const { discord, server, run } = await startPortal();
  try {
    assert.match((await run('kick', { member: MEMBER }, { by: HELPER })).content, /^✗ You need the Kick Members permission/);
    assert.match((await run('ban', { member: ADMIN }, { by: MOD })).content, /^✗ That member has a role equal to or higher than yours/);
    assert.match((await run('warn', { member: OWNER, reason: 'x' }, { by: MOD })).content, /^✗ You can't moderate the server owner/);
    assert.match((await run('warn', { member: QUIET, reason: 'x' }, { by: MEMBER })).content, /^✗ You are not a moderator/);
    assert.match((await run('purge', { count: 5 }, { by: HELPER })).content, /^✗ You need the Manage Messages permission/);

    const kicked = await run('kick', { member: MEMBER, reason: 'spam' }, { by: MOD });
    assert.match(kicked.content, /^👢 Kicked <@200000000000000005>\. Recorded as case 1\./);
    const call = discord.calls.find((c) => c.method === 'DELETE' && c.path === `/guilds/${G}/members/${MEMBER}`);
    assert.equal(call.reason, 'spam — by user3 (200000000000000003) via /kick');
  } finally {
    server.close();
  }
});

test('timeout, ban, unban, lock and slowmode do what they say', async () => {
  const { discord, server, run } = await startPortal();
  try {
    const before = Date.now();
    assert.match((await run('timeout', { member: MEMBER, duration: 3600 })).content, /^🔇 Timed out <@\d+> for 1 hour\. Recorded as case 1\./);
    const patch = discord.calls.find((c) => c.method === 'PATCH' && c.path === `/guilds/${G}/members/${MEMBER}`);
    const until = Date.parse(patch.body.communication_disabled_until);
    assert.ok(until >= before + 3600e3 && until < Date.now() + 3600e3 + 1000);
    assert.match((await run('timeout', { member: MEMBER, duration: 12345 })).content, /^✗ Pick a duration/);

    // Someone who isn't in the server can still be banned by ID, and unbanned again.
    const outsider = '999999999999999999';
    assert.match((await run('ban', { member: outsider, delete_messages: 86400 })).content, /^🔨 Banned <@999999999999999999>\. Recorded as case 2\.$/);
    assert.deepEqual(discord.calls.find((c) => c.method === 'PUT' && c.path === `/guilds/${G}/bans/${outsider}`).body, { delete_message_seconds: 86400 });
    assert.match((await run('unban', { user: outsider })).content, /^✅ Unbanned .* case 3\./);

    assert.match((await run('lock', {})).content, /^🔒 Locked <#300000000000000001>\.$/);
    assert.ok(discord.calls.some((c) => c.method === 'PUT' && c.path === `/channels/${CH}/permissions/${G}`));
    assert.match((await run('lock', {}, { channel: { id: THREAD, type: 11 } })).content, /^✗ Threads can't be locked/);
    assert.match((await run('slowmode', { interval: 30 })).content, /now 30 seconds/);
    assert.deepEqual(discord.calls.find((c) => c.method === 'PATCH' && c.path === `/channels/${CH}`).body, { rate_limit_per_user: 30 });
  } finally {
    server.close();
  }
});

test('/cases shows a member\'s history, newest first', async () => {
  const { server, run } = await startPortal();
  try {
    assert.equal((await run('cases', { member: MEMBER })).content, '<@200000000000000005> has no cases.');
    await run('warn', { member: MEMBER, reason: 'first' });
    await run('timeout', { member: MEMBER, duration: 600, reason: 'second' });
    await run('warn', { member: QUIET, reason: 'someone else' });
    const { embeds } = await run('cases', { member: MEMBER });
    assert.equal(embeds[0].title, 'Cases for user5');
    const text = embeds[0].description;
    assert.match(text, /1 × Timeout · 1 × Warn/);
    assert.ok(text.indexOf('#2 Timeout** (10 minutes)') < text.indexOf('#1 Warn'), 'newest case should come first');
    assert.doesNotMatch(text, /someone else/);
  } finally {
    server.close();
  }
});

test('/poll posts a reaction poll for anyone who can post polls, with the bot reacting in order', async () => {
  const { discord, server, run } = await startPortal();
  const member = { by: MEMBER, permissions: perms(1n << 11n, 1n << 49n), appPermissions: perms(1n << 6n, 1n << 10n, 1n << 11n, 1n << 14n, 1n << 16n) };
  try {
    const posted = await run('poll', { message: 'Friday game?', emoji1: '🔥', option1: 'Minecraft', emoji2: '<:pepe:800000000000000001>', option2: 'Valorant', emoji3: ':party_parrot:', option3: 'Board games' }, member);
    assert.match(posted.content, /^📊 Posted your poll: https:\/\/discord\.com\/channels\/\d+\/300000000000000001\/\d+$/);
    const [msg] = discord.messages[CH];
    assert.equal(msg.embeds[0].title, 'Friday game?');
    assert.equal(msg.embeds[0].author.name, 'Poll by user5');
    assert.match(msg.embeds[0].description, /^\*Select one or more answers\*\n\n🔥 \*\*Minecraft\*\*\n⬛{10} \*\*0%\*\* · 0 votes\n\n<:pepe:800000000000000001> \*\*Valorant\*\*/);
    assert.match(msg.embeds[0].description, /<a:party_parrot:800000000000000002> \*\*Board games\*\*/);
    assert.equal(msg.embeds[0].footer.text, '📊 0 votes · React to vote');
    const reactions = discord.calls.filter((c) => c.method === 'PUT' && c.path.includes(`/messages/${msg.id}/reactions/`)).map((c) => decodeURIComponent(c.path.split('/reactions/')[1]));
    assert.deepEqual(reactions, ['🔥/@me', 'pepe:800000000000000001/@me', 'party_parrot:800000000000000002/@me']);

    // Members who can't post polls there, a bot missing permissions, and bad answers.
    assert.match((await run('poll', { message: 'x', emoji1: '🔥', option1: 'a', emoji2: '💧', option2: 'b' }, { ...member, permissions: perms(1n << 11n) })).content, /^✗ You can't post polls in this channel\.$/);
    assert.match((await run('poll', { message: 'x', emoji1: '🔥', option1: 'a', emoji2: '💧', option2: 'b' }, { ...member, appPermissions: perms(1n << 10n, 1n << 11n) })).content, /^✗ The bot needs Embed Links, Add Reactions, Read Message History in this channel/);
    assert.match((await run('poll', { message: 'x', emoji1: 'hello there', option1: 'a', emoji2: '💧', option2: 'b' }, member)).content, /isn't an emoji/);
    assert.match((await run('poll', { message: 'x', emoji1: '🔥', option1: 'a', emoji2: '🔥', option2: 'b' }, member)).content, /its own emoji/);
    assert.match((await run('poll', { message: 'x', emoji1: '🔥', option1: 'a', emoji2: '💧', option2: 'b', emoji3: '🌊' }, member)).content, /Option 3 needs both an emoji and its text/);

    // An emoji the bot can't use: the half-made poll is taken down again.
    const before = discord.messages[CH].length;
    assert.match((await run('poll', { message: 'x', emoji1: '🔥', option1: 'a', emoji2: '<:ghost:800000000000000009>', option2: 'b' }, member)).content, /can't use one of those emojis/);
    const ghost = discord.messages[CH][0];
    assert.equal(discord.messages[CH].length, before + 1);
    assert.ok(discord.calls.some((c) => c.method === 'DELETE' && c.path === `/channels/${CH}/messages/${ghost.id}`), 'the broken poll should be deleted');
  } finally {
    server.close();
  }
});

test('/poll emoji boxes suggest server emojis and standard ones as you type', async () => {
  const { server, post } = await startPortal();
  const ask = async (value, name = 'emoji2') => {
    const { json } = await post({ type: 4, guild_id: G, channel_id: CH, member: { user: { id: MEMBER } }, data: { name: 'poll', options: [{ name: 'message', value: 'q' }, { name, value, focused: true }] } });
    assert.equal(json.type, 8);
    return json.data.choices;
  };
  try {
    const all = await ask('');
    assert.deepEqual(all.slice(0, 2).map((c) => c.value), ['<:pepe:800000000000000001>', '<a:party_parrot:800000000000000002>']);
    assert.ok(all.some((c) => c.value === '👍') && all.length <= 25);
    const fire = await ask('fire');
    assert.ok(fire.some((c) => c.value === '🔥'));
    assert.deepEqual((await ask('par')).map((c) => c.value)[0], '<a:party_parrot:800000000000000002>');
    assert.deepEqual(await ask('x', 'option1'), []);
  } finally {
    server.close();
  }
});

test('/lock and /unlock tell members in the channel why, before locking and after unlocking', async () => {
  const { discord, server, run } = await startPortal();
  const order = () => discord.calls.filter((c) => (c.method === 'POST' && c.path === `/channels/${CH}/messages`) || (c.method === 'PUT' && c.path === `/channels/${CH}/permissions/${G}`)).map((c) => c.method);
  try {
    assert.match((await run('lock', { reason: 'Raid in progress' })).content, /^🔒 Locked <#300000000000000001>\.$/);
    const [notice] = discord.messages[CH];
    assert.equal(notice.embeds[0].title, '🔒 Channel locked');
    assert.equal(notice.embeds[0].description, "Members can't send messages here for now.\n\n**Reason:** Raid in progress");
    assert.deepEqual(notice.allowed_mentions, { parse: [] });
    assert.deepEqual(order(), ['POST', 'PUT'], 'told before the lock, while the bot can still post');
    const put = discord.calls.find((c) => c.method === 'PUT' && c.path === `/channels/${CH}/permissions/${G}`);
    assert.equal(put.reason, 'Raid in progress — by user3 (200000000000000003) via /lock');

    await run('unlock', {});
    assert.equal(discord.messages[CH][0].embeds[0].title, '🔓 Channel unlocked');
    assert.equal(discord.messages[CH][0].embeds[0].description, 'Members can send messages here again.');
    assert.deepEqual(order(), ['POST', 'PUT', 'PUT', 'POST'], 'told after the unlock');

    // A forum can't hold a message: it's locked without one.
    discord.channels.push({ id: '300000000000000005', type: 15, name: 'ideas', permission_overwrites: [] });
    assert.match((await run('lock', { channel: '300000000000000005' })).content, /^🔒 Locked/);
    assert.equal(discord.messages['300000000000000005'], undefined);
  } finally {
    server.close();
  }
});

test('ticket buttons and forms go to the ticket engine; unknown buttons get a hint', async () => {
  let ran = false;
  const tickets = { interaction: async (i) => (i.data.custom_id.startsWith('tk:') ? { response: { type: 6 }, after: async () => (ran = true) } : null) };
  const { server, post } = await startPortal({ tickets });
  try {
    const press = (custom_id, type = 3) => post({ type, id: '1', application_id: BOT, token: 't', guild_id: G, channel_id: CH, member: { user: { id: MEMBER } }, data: { custom_id } });
    assert.deepEqual((await press(`tk:claim:${CH}:${CH}`)).json, { type: 6 });
    for (let i = 0; i < 50 && !ran; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(ran, true, 'the work after the reply runs');
    assert.deepEqual((await press(`tk:closing:${CH}:${CH}`, 5)).json, { type: 6 });
    const unknown = await press('something-else');
    assert.equal(unknown.json.data.flags, 64);
    assert.match(unknown.json.data.content, /doesn't know that button/);
  } finally {
    server.close();
  }
});

test('transcripts open from signed links only, with no scripts allowed', async () => {
  const LOG_MSG = '700000000000000001';
  const fetchImpl = async (url) => (url === 'https://cdn.test/transcript.html' ? new Response('<!doctype html><p>chat</p>', { status: 200 }) : new Response('', { status: 404 }));
  const { discord, server } = await startPortal({ fetchImpl });
  discord.transcripts[LOG_MSG] = { id: LOG_MSG, attachments: [{ filename: 'transcript-ticket-anna.html', url: 'https://cdn.test/transcript.html' }] };
  discord.transcripts['700000000000000002'] = { id: '700000000000000002', attachments: [] };
  const base = `http://127.0.0.1:${server.address().port}/transcripts`;
  const sig = (msg) => transcriptSignature('z'.repeat(32), CH, msg);
  try {
    const ok = await fetch(`${base}/${CH}/${LOG_MSG}?sig=${sig(LOG_MSG)}`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '<!doctype html><p>chat</p>');
    assert.match(ok.headers.get('content-security-policy'), /default-src 'none'/);
    assert.doesNotMatch(ok.headers.get('content-security-policy'), /script-src/);
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');

    assert.equal((await fetch(`${base}/${CH}/${LOG_MSG}?sig=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/${CH}/${LOG_MSG}`)).status, 403);
    assert.equal((await fetch(`${base}/${CH}/700000000000000002?sig=${sig('700000000000000002')}`)).status, 404, 'no transcript attached');
  } finally {
    server.close();
  }
});
