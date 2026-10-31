// Tests for 24/7 with a fake Discord: the encrypted settings, the #bot-settings channel, and the
// portal running auto roles, announcements and polls from them. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Always = require('../src/main/always');
const { createAlways } = require('../server/always');
const { createPortal } = require('../server/index');
const autoRoles = require('../src/main/autoroles');
const announce = require('../src/main/announce');

const TOKEN = 'MTAw.fake.token';
const BOT = '900000000000000001';
const G = '100000000000000001';
const GENERAL = '300000000000000001';
const ROLE = '400000000000000001';
const ANNA = { id: '200000000000000005', username: 'anna' };

// A fake Discord with one server, its channels and their messages (attachments kept as bytes).
function fakeDiscord() {
  let next = 500000000000000000n;
  const id = () => String(next++);
  const channels = [{ id: GENERAL, type: 0, name: 'general', guild_id: G }];
  const messages = new Map(); // channel id -> [message], newest first
  const blobs = new Map(); // url -> bytes
  const calls = [];
  const fail = (code) => Object.assign(new Error(`code ${code}`), { code });
  const attach = (files = []) =>
    files.map((f) => {
      const url = `https://cdn.test/${id()}/${f.name}`;
      blobs.set(url, Buffer.from(f.data));
      return { filename: f.name, url, size: f.data.length };
    });
  const rest = {
    calls,
    async request(method, path, { body, files, query } = {}) {
      calls.push({ method, path, body, files: files?.map((f) => f.name) });
      if (path === '/users/@me') return { id: BOT, username: 'bot', bot: true };
      if (path === '/users/@me/guilds') return [{ id: G, name: 'Test' }];
      if (path === `/guilds/${G}`) return { id: G, name: 'Test' };
      if (path === `/guilds/${G}/channels` && method === 'GET') return channels;
      if (path === `/guilds/${G}/channels` && method === 'POST') {
        const c = { id: id(), guild_id: G, ...body };
        channels.push(c);
        return c;
      }
      const m = path.match(/^\/channels\/(\d+)\/messages(?:\/(\d+))?$/);
      if (m) {
        const list = messages.get(m[1]) || [];
        messages.set(m[1], list);
        if (method === 'GET' && !m[2]) return list.slice(0, query?.limit || 50);
        const found = list.find((x) => x.id === m[2]);
        if (method === 'GET') return found || Promise.reject(fail(10008));
        if (method === 'POST') {
          const msg = { id: id(), channel_id: m[1], author: { id: BOT }, content: body.content, embeds: body.embeds || [], attachments: attach(files) };
          list.unshift(msg);
          return msg;
        }
        if (method === 'PATCH') {
          if (!found) throw fail(10008);
          Object.assign(found, { content: body.content ?? found.content }, files ? { attachments: attach(files) } : {});
          return found;
        }
        if (method === 'DELETE') {
          messages.set(m[1], list.filter((x) => x !== found));
          return null;
        }
      }
      return null;
    },
  };
  const fetchImpl = async (url) => {
    const data = blobs.get(url);
    return { ok: !!data, status: data ? 200 : 404, arrayBuffer: async () => data };
  };
  return { rest, fetchImpl, channels, messages, calls };
}

function fakeGateway() {
  const gw = { intents: null, presence: null, stopped: false, emit: null };
  const connect = (onState, onEvent) => {
    gw.emit = onEvent;
    return {
      setIntents: (i) => (gw.intents = i),
      start: (p) => {
        gw.presence = p;
        onState('online');
      },
      stop: () => (gw.stopped = true),
    };
  };
  return { gw, connect };
}

const config = (now) => ({
  autoroles: autoRoles.normalizeSettings({ guildId: G, enabled: true, roles: [ROLE] }),
  announcements: [announce.normalize({ id: 'ann1', guildId: G, channelId: GENERAL, name: 'Rules', content: 'Read the rules', schedule: { on: true, at: now - 1000, repeat: 'once' } }, now - 60000)],
});

test('settings are encrypted with the bot token, and requests are signed with it', () => {
  const sealed = Always.seal(TOKEN, { hello: 'world' });
  assert.ok(!sealed.toString('utf8').includes('world'));
  assert.deepEqual(Always.open(TOKEN, sealed), { hello: 'world' });
  assert.throws(() => Always.open('another.token', sealed), /different bot token/);

  const body = JSON.stringify({ guildIds: [G] });
  const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  const headers = lower(Always.signedHeaders(TOKEN, body, 1000));
  assert.ok(Always.checkSigned(TOKEN, body, headers, 1000));
  assert.ok(!Always.checkSigned(TOKEN, `${body} `, headers, 1000), 'a changed body fails');
  assert.ok(!Always.checkSigned('another.token', body, headers, 1000), 'another token fails');
  assert.ok(!Always.checkSigned(TOKEN, body, headers, 1000 + 10 * 60 * 1000), 'an old request fails');
});

test("what the portal keeps up to date doesn't count as a settings change", () => {
  const now = Date.now();
  const c = { ...config(now), polls: [{ id: 'p1', messageId: '1', options: [], counts: [1, 2] }] };
  const alerts = [{ id: 'a1', platform: 'youtube', guildId: G, state: { seen: ['x'] } }, { id: 'a2', platform: 'twitch', guildId: G }];
  const bundle = Always.makeBundle({ guildId: G, config: c, alerts, youtubeKey: 'key', now });
  assert.equal(bundle.alerts.length, 1, 'only YouTube alerts run 24/7');
  assert.equal(bundle.youtubeKey, 'key');
  assert.ok(bundle.used);
  const hash = Always.bundleHash(bundle);
  const busier = structuredClone(bundle);
  busier.savedAt += 5000;
  busier.polls[0].counts = [5, 5];
  busier.announcements[0].lastSentAt = now;
  busier.announcements[0].schedule.nextAt = now + 86400000;
  busier.alerts[0].state = { seen: ['x', 'y'] };
  assert.equal(Always.bundleHash(busier), hash);
  busier.announcements[0].content = 'New text';
  assert.notEqual(Always.bundleHash(busier), hash);
  assert.ok(!Always.makeBundle({ guildId: G, config: {} }).used, 'a server with nothing set up has nothing to run');
});

test('the app saves settings in a private channel, and the portal reads them back', async () => {
  const d = fakeDiscord();
  const now = Date.now();
  const bundle = Always.makeBundle({ guildId: G, config: { ...config(now), announcements: [{ ...config(now).announcements[0], embed: { ...config(now).announcements[0].embed, imageFile: 'pic.png' } }] }, now });
  const picture = Buffer.from('picture bytes');
  const { channelId } = await Always.saveBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, bundle, readFile: (name) => (name === 'pic.png' ? picture : null) });
  const channel = d.channels.find((c) => c.id === channelId);
  assert.equal(channel.name, 'bot-settings');
  assert.equal(channel.permission_overwrites[0].deny, String(1n << 10n), 'hidden from everyone');
  assert.equal(channel.permission_overwrites[1].id, BOT);
  assert.equal(d.messages.get(channelId).length, 2, 'the settings and one picture');

  // Saving again edits the same message instead of posting another, and reuses the picture.
  await Always.saveBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, bundle: { ...bundle, savedAt: now + 1 }, readFile: () => picture });
  assert.equal(d.messages.get(channelId).length, 2);

  const loaded = await Always.loadBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, fetchImpl: d.fetchImpl });
  assert.equal(loaded.bundle.savedAt, now + 1);
  assert.equal(loaded.bundle.announcements[0].content, 'Read the rules');
  assert.match(loaded.bundle.files['pic.png'], /^f-[0-9a-f]{24}\.png$/);
  assert.ok(loaded.files.has(loaded.bundle.files['pic.png']));
  assert.equal(loaded.state, null);

  // A picture no longer used is removed.
  await Always.saveBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, bundle: Always.makeBundle({ guildId: G, config: config(now), now }), readFile: () => null });
  assert.equal(d.messages.get(channelId).length, 1);
});

test('the portal runs auto roles and announcements 24/7 and remembers what it sent', async () => {
  const d = fakeDiscord();
  const now = Date.now();
  const bundle = Always.makeBundle({ guildId: G, config: config(now), bot: { intents: { members: true }, presence: { enabled: true, status: 'online', text: 'Hi' }, slashCommands: true }, now });
  await Always.saveBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, bundle, readFile: () => null });

  const { gw, connect } = fakeGateway();
  const portal = createAlways({ rest: d.rest, token: TOKEN, fetchImpl: d.fetchImpl, connect, saveDelayMs: 10, catchUpDelayMs: 1, log: { error() {} } });
  await portal.start();
  assert.ok(gw.intents & (1 << 1), 'members intent for auto roles');
  assert.equal(gw.presence.text, 'Hi');
  assert.equal(portal.status().running, true);

  // Someone joins: they get the role.
  await gw.emit('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA, roles: [] });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(d.calls.some((c) => c.method === 'PUT' && c.path === `/guilds/${G}/members/${ANNA.id}/roles/${ROLE}`));

  // The scheduled announcement goes out once, and that is saved to the channel.
  await portal.tick();
  const sent = () => d.calls.filter((c) => c.method === 'POST' && c.path === `/channels/${GENERAL}/messages`);
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].body.content, 'Read the rules');
  const id = bundle.announcements[0].id;
  assert.equal(portal.status().servers[G].state.announcements[id].patch.schedule.on, false);
  await portal.close();
  assert.ok(gw.stopped);

  // After a restart it knows it already sent it.
  const again = createAlways({ rest: d.rest, token: TOKEN, fetchImpl: d.fetchImpl, connect: fakeGateway().connect, saveDelayMs: 10, log: { error() {} } });
  await again.start();
  assert.ok(again.status().servers[G].state.announcements[id].patch.lastMessageId);
  await again.tick();
  assert.equal(sent().length, 1, 'not sent twice');
  await again.close();
});

test('with 24/7 off the portal stays off the gateway', async () => {
  const d = fakeDiscord();
  await Always.saveBundle({ rest: d.rest, token: TOKEN, guildId: G, botUserId: BOT, bundle: Always.makeBundle({ guildId: G, config: config(Date.now()), on: false }), readFile: () => null });
  const { gw, connect } = fakeGateway();
  const portal = createAlways({ rest: d.rest, token: TOKEN, fetchImpl: d.fetchImpl, connect, log: { error() {} } });
  await portal.start();
  assert.equal(gw.intents, null);
  assert.equal(portal.status().running, false);
  assert.equal(portal.status().servers[G].on, false);
  await portal.close();
});

test("the portal answers 24/7 requests only when they're signed with its token", async () => {
  const d = fakeDiscord();
  const portal = createAlways({ rest: d.rest, token: TOKEN, fetchImpl: d.fetchImpl, connect: fakeGateway().connect, log: { error() {} } });
  const server = createPortal({ config: { publicUrl: 'http://localhost', botToken: TOKEN }, rest: d.rest, auth: {}, guard: {}, always: portal });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/health`)).json()).always, Always.VERSION);
    const body = JSON.stringify({ guildIds: [G] });
    const unsigned = await fetch(`${base}/always/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(unsigned.status, 401);
    const forged = await fetch(`${base}/always/status`, { method: 'POST', headers: Always.signedHeaders('another.token', body), body });
    assert.equal(forged.status, 401);
    const ok = await fetch(`${base}/always/reload`, { method: 'POST', headers: Always.signedHeaders(TOKEN, body), body });
    assert.equal(ok.status, 200);
    const status = await ok.json();
    assert.equal(status.version, Always.VERSION);
    assert.equal(status.running, false);
  } finally {
    server.close();
    await portal.close();
  }
});

test('the portal draws welcome cards and reads emoji colours like the app', async () => {
  const { createCards } = require('../server/cards');
  const { createCanvas } = require('@napi-rs/canvas');
  const red = createCanvas(32, 32);
  red.getContext('2d').fillStyle = '#e02020';
  red.getContext('2d').fillRect(0, 0, 32, 32);
  const redPng = await red.encode('png');
  const fetchImpl = async (url) => (url.includes('/emojis/') ? { ok: true, status: 200, arrayBuffer: async () => redPng } : { ok: false, status: 404 });
  const cards = createCards({ fetchImpl });
  assert.ok(cards.available);
  const WelcomeCard = require('../src/shared/welcomecard');
  const card = WelcomeCard.normalizeKind({ enabled: true, card: { font: 'Impact' } }, 'welcome').card;
  const png = await cards.render(card, { user: 'Anna', server: 'Test', count: 5 }, ANNA);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a PNG, even without the avatar');
  assert.equal(await cards.emojiColor({ id: '700000000000000001', name: 'redthing' }, 0), 'red');
  assert.equal(await cards.emojiColor({ name: '🟢' }, 0), require('../src/main/polls').defaultColor({ name: '🟢' }, 0));
});

test('the app takes in what the portal did: sent announcements, found and deleted polls, votes and videos', () => {
  const now = Date.now();
  const a = { ...config(now).announcements[0] };
  const changed = { ...a, id: 'ann2', schedule: { ...a.schedule, at: now + 5000 } };
  const app = {
    announcements: [a, changed],
    polls: [{ id: 'p1', messageId: '11', counts: [0, 0] }, { id: 'p2', messageId: '12', counts: [1, 1] }],
  };
  const server = {
    on: true,
    state: {
      announcements: {
        [a.id]: { key: Always.announceKey(a), patch: { schedule: { ...a.schedule, on: false, nextAt: null }, lastSentAt: now, lastMessageId: '99' } },
        // Saved for an older version of ann2 (its time changed since), so it isn't taken.
        ann2: { key: Always.announceKey(a), patch: { lastMessageId: '98' } },
      },
      polls: { found: [{ id: 'p3', messageId: '13', counts: [2, 0] }], counts: { p1: { counts: [3, 1], ended: false } }, forgotten: ['p2'] },
      alerts: { yt1: { seen: ['v1'] } },
    },
  };
  const patch = Always.mergeServer(app, server);
  assert.equal(patch.announcements[0].lastMessageId, '99');
  assert.equal(patch.announcements[0].schedule.on, false);
  assert.equal(patch.announcements[1].lastMessageId, undefined);
  assert.deepEqual(patch.polls.map((p) => p.id), ['p1', 'p3']);
  assert.deepEqual(patch.polls[0].counts, [3, 1]);
  assert.equal(Always.mergeServer({ ...app, ...patch }, server), null, 'nothing new the second time');

  const alerts = [{ id: 'yt1', botId: BOT, guildId: G, platform: 'youtube', state: {} }, { id: 'tw1', botId: BOT, guildId: G, platform: 'twitch', state: {} }];
  const merged = Always.mergeAlerts(alerts, BOT, { [G]: server });
  assert.ok(merged.changed);
  assert.deepEqual(merged.alerts[0].state, { seen: ['v1'] });
  assert.equal(merged.alerts[1], alerts[1]);
});
