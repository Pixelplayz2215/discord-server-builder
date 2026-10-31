// Tests for social alerts with fake YouTube and Twitch responses. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const social = require('../src/main/social');

const UC = 'UCabcdefghijklmnopqrstuv';
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function feed(videos, name = 'Pixel &amp; Co') {
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>${name}</title><author><name>${name}</name></author>${videos
    .map((v) => `<entry><yt:videoId>${v.id}</yt:videoId><title>${v.title || v.id}</title><link rel="alternate" href="${v.url || `https://www.youtube.com/watch?v=${v.id}`}"/><published>${new Date(v.at).toISOString()}</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" width="480" height="360"/></media:group></entry>`)
    .join('')}</feed>`;
}

test('YouTube feeds are parsed, with entities decoded and Shorts spotted', () => {
  const parsed = social.parseYouTubeFeed(feed([{ id: 'v1', title: 'Tips &amp; tricks &#39;26', at: 1000 }, { id: 'v2', at: 0, url: 'https://www.youtube.com/shorts/v2' }]));
  assert.equal(parsed.name, 'Pixel & Co');
  assert.equal(parsed.videos[0].title, "Tips & tricks '26");
  assert.equal(parsed.videos[0].isShort, false);
  assert.equal(parsed.videos[1].isShort, true);
  assert.equal(parsed.videos[0].thumbnail, 'https://i.ytimg.com/vi/v1/hqdefault.jpg');
});

test('YouTube channels resolve from IDs, links and @handles', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('/feeds/videos.xml')) return reply(200, feed([]));
    if (url === 'https://www.youtube.com/@pixel') return reply(200, `<html><script>var x = {"externalId":"${UC}"}</script></html>`);
    return reply(404, '');
  };
  assert.equal((await social.resolveYouTubeChannel(UC, fetchImpl)).id, UC);
  assert.equal((await social.resolveYouTubeChannel(`https://www.youtube.com/channel/${UC}/videos`, fetchImpl)).id, UC);
  const byHandle = await social.resolveYouTubeChannel('https://www.youtube.com/@pixel/featured', fetchImpl);
  assert.deepEqual(byHandle, { id: UC, name: 'Pixel & Co', url: `https://www.youtube.com/channel/${UC}` });
  assert.equal((await social.resolveYouTubeChannel('@pixel', fetchImpl)).id, UC);
  await assert.rejects(social.resolveYouTubeChannel('https://example.com/@pixel', fetchImpl), /YouTube channel link/);
  await assert.rejects(social.resolveYouTubeChannel('@nobody', fetchImpl), /no YouTube channel/);
});

test('YouTube\'s feed is tried again when it blinks, and Check still works while it is down', async () => {
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  const answers = [404, 500, 200];
  let calls = 0;
  const flaky = async () => {
    const status = answers[calls++];
    return reply(status, status === 200 ? feed([{ id: 'v1', at: 0 }]) : '');
  };
  assert.equal((await social.fetchYouTubeFeed(UC, flaky, { sleep })).videos[0].id, 'v1');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 4000]);

  // A request YouTube refuses outright isn't tried again.
  let refused = 0;
  await assert.rejects(social.fetchYouTubeFeed(UC, async () => (refused++, reply(400, '')), { sleep }), /isn't answering right now \(HTTP 400\)/);
  assert.equal(refused, 1);

  // Feed down: the channel's page confirms it exists and gives its name.
  const pages = [];
  const feedDown = async (url) => {
    pages.push(url);
    if (url.includes('/feeds/videos.xml')) return reply(500, '');
    if (url === `https://www.youtube.com/channel/${UC}`) return reply(200, '<meta property="og:title" content="Pixel &amp; Co">');
    return reply(404, '');
  };
  assert.deepEqual(await social.resolveYouTubeChannel(UC, feedDown, { sleep }), { id: UC, name: 'Pixel & Co', url: `https://www.youtube.com/channel/${UC}` });
  await assert.rejects(social.resolveYouTubeChannel('UCzzzzzzzzzzzzzzzzzzzzzz', feedDown, { sleep }), /no YouTube channel at that link/);

  // An @handle page already has the name, so the feed isn't needed at all.
  const handle = async (url) => (url === 'https://www.youtube.com/@pixel' ? reply(200, `<meta property="og:title" content="Pixel"><script>{"externalId":"${UC}"}</script>`) : reply(500, ''));
  assert.deepEqual(await social.resolveYouTubeChannel('@pixel', handle, { sleep }), { id: UC, name: 'Pixel', url: `https://www.youtube.com/channel/${UC}` });
});

function harness(alerts, { fetchImpl, twitch = null, failPost = false } = {}) {
  let clock = 1_000_000_000_000;
  const posts = [];
  const store = alerts.map((a) => ({ enabled: true, state: {}, ...a }));
  const watcher = social.createSocialWatcher({
    getAlerts: () => store,
    updateState: (id, state) => Object.assign(store.find((a) => a.id === id), { state }),
    post: async (alert, message) => {
      if (failPost) throw new Error('Missing Access');
      posts.push({ alert: alert.id, message });
    },
    getTwitch: () => twitch,
    fetchImpl,
    now: () => clock,
    sleep: async () => {},
  });
  return { watcher, posts, store, advance: (ms) => (clock += ms), now: () => clock };
}

test('YouTube alerts post new uploads once, oldest first, and never older ones', async () => {
  let videos = [];
  const fetches = [];
  const fetchImpl = async (url) => {
    fetches.push(url);
    return reply(200, feed(videos));
  };
  const h = harness([{ id: 'a', platform: 'youtube', source: { id: UC, name: 'Pixel' }, message: '', mention: 'none', createdAt: 1_000_000_000_000 }], { fetchImpl });
  videos = [{ id: 'old', at: h.now() - 86400e3 }];
  await h.watcher.tick();
  assert.equal(h.posts.length, 0, 'videos from before the alert existed are not posted');

  h.advance(60e3);
  videos = [{ id: 'new2', at: h.now() - 1000 }, { id: 'new1', at: h.now() - 2000 }, ...videos];
  await h.watcher.tick();
  assert.equal(fetches.length, 1, 'the feed is checked every 5 minutes, not every tick');

  h.advance(5 * 60e3);
  await h.watcher.tick();
  assert.deepEqual(h.posts.map((p) => p.message.content), ['**Pixel & Co** posted a new video: https://www.youtube.com/watch?v=new1', '**Pixel & Co** posted a new video: https://www.youtube.com/watch?v=new2']);
  assert.deepEqual(h.posts[0].message.allowed_mentions, { parse: [] });

  h.advance(5 * 60e3);
  await h.watcher.tick();
  assert.equal(h.posts.length, 2, 'nothing is posted twice');
});

test('YouTube Shorts can be left out, and feed or post problems show on the alert', async () => {
  const fetchImpl = async () => reply(200, feed([{ id: 's1', at: 1_000_000_100_000, url: 'https://www.youtube.com/shorts/s1' }]));
  const h = harness([{ id: 'a', platform: 'youtube', source: { id: UC, name: 'P' }, shorts: false, createdAt: 1_000_000_000_000 }], { fetchImpl });
  h.advance(200_000);
  await h.watcher.tick();
  assert.equal(h.posts.length, 0);

  // A failed check is often YouTube's feed blinking, so the problem only shows from the third in a row.
  const broken = harness([{ id: 'b', platform: 'youtube', source: { id: UC, name: 'P' }, createdAt: 0 }], { fetchImpl: async () => reply(404, '') });
  await broken.watcher.tick();
  assert.equal(broken.store[0].state.error, null);
  assert.equal(broken.store[0].state.failures, 1);
  for (let i = 0; i < 2; i++) {
    broken.advance(5 * 60e3);
    await broken.watcher.tick();
  }
  assert.match(broken.store[0].state.error, /video feed for this channel isn't answering right now \(HTTP 404\)/);

  const noAccess = harness([{ id: 'c', platform: 'youtube', source: { id: UC, name: 'P' }, createdAt: 1_000_000_000_000 }], { fetchImpl, failPost: true });
  noAccess.advance(200_000);
  await noAccess.watcher.tick();
  assert.match(noAccess.store[0].state.error, /Couldn't post in Discord: Missing Access/);
  assert.deepEqual(noAccess.store[0].state.seen, ['s1'], "a failed post isn't retried every few minutes");
});

test('Twitch alerts post once per stream, and not for a stream already running when added', async () => {
  let live = [{ id: 'stream1', user_id: '42', user_login: 'pixel', user_name: 'Pixel', title: 'Building servers', game_name: 'Minecraft', viewer_count: 12, started_at: '2026-01-01T00:00:00Z', thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_pixel-{width}x{height}.jpg' }];
  const twitch = { streams: async () => live };
  const h = harness([{ id: 't', platform: 'twitch', source: { id: '42', name: 'Pixel', login: 'pixel' }, mention: 'everyone', message: '' }], { twitch });
  await h.watcher.tick();
  assert.equal(h.posts.length, 0, 'already live when the alert was added');
  assert.equal(h.store[0].state.live, 'stream1');

  h.advance(60e3);
  await h.watcher.tick();
  assert.equal(h.posts.length, 0, 'same stream, no repeat');

  h.advance(60e3);
  live = [];
  await h.watcher.tick();
  assert.equal(h.store[0].state.live, null);

  h.advance(30e3);
  live = [{ ...live[0], id: 'stream2', user_id: '42', user_login: 'pixel', user_name: 'Pixel', title: 'Round two', game_name: 'Minecraft', thumbnail_url: 'https://static-cdn.jtvnw.net/x-{width}x{height}.jpg' }];
  await h.watcher.tick();
  assert.equal(h.posts.length, 0, 'Twitch is checked once a minute');
  h.advance(30e3);
  await h.watcher.tick();
  assert.equal(h.posts.length, 1);
  const { message } = h.posts[0];
  assert.equal(message.content, '@everyone **Pixel** is live on Twitch! Round two');
  assert.deepEqual(message.allowed_mentions, { parse: ['everyone'] });
  assert.equal(message.embeds[0].url, 'https://www.twitch.tv/pixel');
  assert.match(message.embeds[0].image.url, /^https:\/\/static-cdn\.jtvnw\.net\/x-1280x720\.jpg\?t=\d+$/);
});

test('Twitch alerts say so when nobody is logged in', async () => {
  const h = harness([{ id: 't', platform: 'twitch', source: { id: '42', name: 'Pixel' } }], { twitch: null });
  await h.watcher.tick();
  assert.match(h.store[0].state.error, /Log in with Twitch/);
});

test('role pings only allow that role, and custom messages fill in placeholders', () => {
  const m = social.youtubeMessage({ mention: '400000000000000002', message: 'New from {name}: {title} {url}' }, 'Pixel', { title: 'Hi', url: 'https://youtu.be/x' });
  assert.equal(m.content, '<@&400000000000000002> New from Pixel: Hi https://youtu.be/x');
  assert.deepEqual(m.allowed_mentions, { parse: [], roles: ['400000000000000002'] });
});

test('Log in with Twitch: device code, waiting, and the no-scope fallback', async () => {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, opts) => {
    const body = Object.fromEntries(new URLSearchParams(opts.body));
    calls.push({ url, body });
    if (url.endsWith('/device')) {
      if (body.scopes === '') return reply(400, { status: 400, message: 'missing scopes' });
      return reply(200, { device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCDEFGH', interval: 5, expires_in: 1800 });
    }
    polls++;
    if (polls === 1) return reply(400, { status: 400, message: 'authorization_pending' });
    if (polls === 2) return reply(400, { status: 400, message: 'slow_down' });
    return reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 14400 });
  };
  const login = await social.twitchStartLogin('client123', fetchImpl, 0);
  assert.equal(login.userCode, 'ABCD-EFGH');
  assert.equal(login.scopes, 'user:read:follows', 'falls back to one harmless scope when Twitch wants one');
  const waits = [];
  const tokens = await social.twitchFinishLogin('client123', login, fetchImpl, { sleep: async (ms) => waits.push(ms), now: () => 0 });
  assert.deepEqual(tokens, { access: 'at', refresh: 'rt', expiresAt: 14400e3 });
  assert.deepEqual(waits, [5000, 5000, 10000], 'slow_down makes it wait longer');
  const token = calls.filter((c) => c.url.endsWith('/token')).pop().body;
  assert.equal(token.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(token.scopes, 'user:read:follows');
  assert.equal(token.client_secret, undefined);

  const denied = async (url) => (url.endsWith('/device') ? reply(200, { device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 1, expires_in: 60 }) : reply(400, { status: 400, message: 'access_denied' }));
  const l2 = await social.twitchStartLogin('c', denied, 0);
  await assert.rejects(social.twitchFinishLogin('c', l2, denied, { sleep: async () => {}, now: () => 0 }), /declined/);
});

test('Twitch tokens refresh once for parallel calls, and after a 401', async () => {
  let tokens = { access: 'old', refresh: 'r1', expiresAt: 0 };
  let refreshes = 0;
  let helixCalls = 0;
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/oauth2/token')) {
      refreshes++;
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      assert.equal(body.grant_type, 'refresh_token');
      assert.equal(body.client_secret, undefined);
      return reply(200, { access_token: `a${refreshes}`, refresh_token: `r${refreshes + 1}`, expires_in: 14400 });
    }
    helixCalls++;
    if (opts.headers.Authorization === 'Bearer a1' && helixCalls === 3) return reply(401, {});
    return reply(200, { data: [{ id: '42', user_id: '42' }] });
  };
  const client = social.createTwitchClient({ clientId: 'c', getTokens: () => tokens, saveTokens: (t) => (tokens = t), fetchImpl, now: () => 1000 });
  await Promise.all([client.streams(['42']), client.streams(['42'])]);
  assert.equal(refreshes, 1, 'one refresh for two calls at once (refresh tokens work only once)');
  assert.equal(tokens.refresh, 'r2');
  await client.users(['pixel']);
  assert.equal(refreshes, 2, 'a 401 refreshes and retries');

  const expired = social.createTwitchClient({ clientId: 'c', getTokens: () => ({ access: 'x', refresh: 'gone', expiresAt: 0 }), saveTokens: () => {}, fetchImpl: async () => reply(400, { message: 'Invalid refresh token' }) });
  await assert.rejects(expired.me(), /Log in with Twitch again/);
});
