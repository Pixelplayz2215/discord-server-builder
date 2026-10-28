// Tests for the mod portal with a fake Discord. Run: npm run test:portal
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createAuth, createSessions, sha256 } = require('./auth');
const { createGuard, P } = require('./guard');
const { createPortal } = require('./index');

const G = '100000000000000001';
const OTHER_G = '100000000000000002';
const CH = '300000000000000001';
const BOT = '200000000000000000';
const OWNER = '200000000000000001';
const ADMIN = '200000000000000002';
const MOD = '200000000000000003';
const HELPER = '200000000000000004';
const MEMBER = '200000000000000005';
const NOBODY = '200000000000000006';
const R = { admin: '400000000000000001', mod: '400000000000000002', helper: '400000000000000003', member: '400000000000000004', bot: '400000000000000005' };

const perms = (...bits) => String(bits.reduce((a, b) => a | b, 0n));
const user = (id) => ({ id, username: `user${id.slice(-1)}`, global_name: null });

function fakeDiscord() {
  const calls = [];
  const roles = [
    { id: G, name: '@everyone', position: 0, permissions: '0' },
    { id: R.member, name: 'Member', position: 1, permissions: '0' },
    { id: R.helper, name: 'Helper', position: 2, permissions: perms(P.MODERATE_MEMBERS) },
    { id: R.mod, name: 'Mod', position: 3, permissions: perms(P.KICK_MEMBERS, P.BAN_MEMBERS, P.MODERATE_MEMBERS, P.MANAGE_MESSAGES, P.VIEW_AUDIT_LOG) },
    { id: R.admin, name: 'Admin', position: 5, permissions: perms(P.ADMINISTRATOR) },
    { id: R.bot, name: 'Bot', position: 6, permissions: perms(P.ADMINISTRATOR), managed: true },
  ];
  const members = {
    [OWNER]: [],
    [ADMIN]: [R.admin],
    [MOD]: [R.mod, R.member],
    [HELPER]: [R.helper],
    [MEMBER]: [R.member],
    [NOBODY]: [],
    [BOT]: [R.bot],
  };
  const notFound = () => Object.assign(new Error('Unknown member'), { status: 404, code: 10007 });
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      let m;
      if (path === '/users/@me') return { id: BOT, username: 'bot' };
      if (path === '/users/@me/guilds') return [{ id: G, name: 'Main' }, { id: OTHER_G, name: 'Other' }];
      if ((m = path.match(/^\/guilds\/(\d+)$/)) && method === 'GET') return { id: m[1], name: 'Guild', owner_id: OWNER };
      if ((m = path.match(/^\/guilds\/(\d+)\/roles$/))) return m[1] === G ? roles : [{ id: OTHER_G, position: 0, permissions: '0' }];
      if ((m = path.match(/^\/guilds\/(\d+)\/members\/(\d+)$/)) && method === 'GET') {
        if (m[1] !== G || !members[m[2]]) throw notFound();
        return { user: { id: m[2] }, roles: members[m[2]] };
      }
      if ((m = path.match(/^\/channels\/(\d+)$/)) && method === 'GET') return { id: m[1], guild_id: G, permission_overwrites: [] };
      return { ok: true };
    },
  };
}

const call = (method, path, extra = {}) => ({ method, path, ...extra });

test('session tokens verify, and reject tampering and expiry', () => {
  const s = createSessions('x'.repeat(32), 7);
  const token = s.issue({ id: MOD, username: 'mod' });
  assert.equal(s.verify(token).id, MOD);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ id: OWNER, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(s.verify(`${forged}.${sig}`), null);
  assert.equal(s.verify(`${payload}.${sig.slice(0, -2)}xx`), null);
  assert.equal(createSessions('x'.repeat(32), -1).verify(createSessions('x'.repeat(32), -1).issue({ id: MOD })), null);
});

test('sign-in flow needs the verifier and hands out one session', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (url.endsWith('/oauth2/token') ? { access_token: 'at' } : { id: MOD, username: 'mod', global_name: 'Mod', avatar: null }),
  });
  const auth = createAuth({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://p/auth/callback', sessionSecret: 'x'.repeat(32), sessionDays: 7 }, { fetchImpl });
  const id = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const url = new URL(auth.loginUrl(id, sha256(verifier)));
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('state'), id);
  assert.throws(() => auth.loginUrl('short', 'bad'), /Invalid/);

  assert.deepEqual(auth.poll(id, verifier), { pending: true });
  await auth.handleCallback('code', id);
  assert.throws(() => auth.poll(id, 'wrong-verifier'), /Invalid sign-in/);
  const done = auth.poll(id, verifier);
  assert.equal(done.user.id, MOD);
  assert.equal(auth.sessions.verify(done.token).id, MOD);
  assert.throws(() => auth.poll(id, verifier), /expired/);
});

test('only members with Kick, Ban or Timeout are mods', async () => {
  const guard = createGuard(fakeDiscord());
  await assert.doesNotReject(guard.actorIn(G, user(MOD)));
  await assert.doesNotReject(guard.actorIn(G, user(HELPER)));
  await assert.doesNotReject(guard.actorIn(G, user(OWNER)));
  await assert.rejects(guard.actorIn(G, user(MEMBER)), /not a moderator/);
  await assert.rejects(guard.actorIn(G, user(NOBODY)), /not a moderator/);
  const guilds = await guard.modGuilds(user(MOD));
  assert.deepEqual(guilds.map((g) => g.id), [G]);
});

test('mods can only act on members ranked below them', async () => {
  const guard = createGuard(fakeDiscord());
  const mod = user(MOD);
  await assert.doesNotReject(guard.authorize(mod, call('PUT', `/guilds/${G}/bans/${MEMBER}`, { body: { delete_message_seconds: 0 } })));
  await assert.doesNotReject(guard.authorize(mod, call('PUT', `/guilds/${G}/bans/999999999999999999`)));
  await assert.rejects(guard.authorize(mod, call('PUT', `/guilds/${G}/bans/${ADMIN}`)), /equal to or higher/);
  await assert.rejects(guard.authorize(mod, call('DELETE', `/guilds/${G}/members/${OWNER}`)), /server owner/);
  await assert.rejects(guard.authorize(mod, call('DELETE', `/guilds/${G}/members/${MOD}`)), /yourself/);
  await assert.rejects(guard.authorize(mod, call('DELETE', `/guilds/${G}/members/${BOT}`)), /equal to or higher/);
});

test('each action needs its own Discord permission', async () => {
  const guard = createGuard(fakeDiscord());
  const helper = user(HELPER);
  await assert.doesNotReject(guard.authorize(helper, call('PATCH', `/guilds/${G}/members/${MEMBER}`, { body: { communication_disabled_until: null } })));
  await assert.rejects(guard.authorize(helper, call('DELETE', `/guilds/${G}/members/${MEMBER}`)), /Kick Members/);
  await assert.rejects(guard.authorize(helper, call('PATCH', `/guilds/${G}/members/${MEMBER}`, { body: { nick: 'x' } })), /Manage Nicknames/);
  await assert.rejects(guard.authorize(helper, call('GET', `/guilds/${G}/bans`)), /Ban Members/);
  await assert.rejects(guard.authorize(user(MOD), call('PUT', `/guilds/${G}/members/${MEMBER}/roles/${R.helper}`)), /Manage Roles/);
});

test('roles can only be handed out below your own top role', async () => {
  const guard = createGuard(fakeDiscord());
  const admin = user(ADMIN);
  await assert.doesNotReject(guard.authorize(admin, call('PUT', `/guilds/${G}/members/${MEMBER}/roles/${R.mod}`)));
  await assert.rejects(guard.authorize(admin, call('PUT', `/guilds/${G}/members/${MEMBER}/roles/${R.admin}`)), /equal to or higher/);
  await assert.rejects(guard.authorize(admin, call('PUT', `/guilds/${G}/members/${MEMBER}/roles/${R.bot}`)), /cannot be assigned/);
});

test('owner-only and unexpected changes are refused', async () => {
  const guard = createGuard(fakeDiscord());
  const owner = user(OWNER);
  await assert.rejects(guard.authorize(owner, call('POST', `/guilds/${G}/channels`)), /Only the server owner/);
  await assert.rejects(guard.authorize(owner, call('DELETE', `/channels/${CH}`)), /Only the server owner/);
  await assert.rejects(guard.authorize(owner, call('PATCH', `/guilds/${G}`, { body: { name: 'x' } })), /Only the server owner/);
  await assert.rejects(guard.authorize(owner, call('POST', `/channels/${CH}/messages`)), /Only the server owner/);
  await assert.rejects(guard.authorize(user(MOD), call('PATCH', `/guilds/${G}/members/${MEMBER}`, { body: { roles: [R.admin] } })), /can't change "roles"/);
});

test('audit reasons and queries are cleaned up', async () => {
  const guard = createGuard(fakeDiscord());
  const out = await guard.authorize(user(MOD), call('DELETE', `/guilds/${G}/members/${MEMBER}`, { reason: 'spam', query: { limit: 5, evil: 'x', with_counts: true } }));
  assert.match(out.reason, /^spam — by user3 \(200000000000000003\) via mod portal$/);
  assert.deepEqual(out.query, { limit: 5, with_counts: true });
});

test('HTTP API requires a session and forwards allowed calls as the bot', async () => {
  const discord = fakeDiscord();
  const config = { publicUrl: 'http://localhost', clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/auth/callback', sessionSecret: 'y'.repeat(32), sessionDays: 7 };
  const auth = createAuth(config);
  const server = createPortal({ config, rest: discord, auth, guard: createGuard(discord) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await post('/api/discord', { method: 'GET', path: `/guilds/${G}` })).status, 401);

    const token = auth.sessions.issue(user(MOD));
    const kick = await post('/api/discord', { method: 'DELETE', path: `/guilds/${G}/members/${MEMBER}`, reason: 'spam' }, token);
    assert.equal(kick.status, 200);
    const sent = discord.calls.find((c) => c.method === 'DELETE');
    assert.equal(sent.path, `/guilds/${G}/members/${MEMBER}`);
    assert.match(sent.reason, /via mod portal/);

    const blocked = await post('/api/discord', { method: 'POST', path: `/guilds/${G}/channels`, body: { name: 'x' } }, token);
    assert.equal(blocked.status, 403);
    assert.match((await blocked.json()).error, /Only the server owner/);

    const guilds = await (await post('/api/discord', { method: 'GET', path: '/users/@me/guilds' }, token)).json();
    assert.deepEqual(guilds.map((g) => g.id), [G]);

    const lockOther = await post('/api/lock', { guildId: OTHER_G, channelId: CH, locked: true }, token);
    assert.equal(lockOther.status, 400);
  } finally {
    server.close();
  }
});
