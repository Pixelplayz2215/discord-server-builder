// Social alerts: posts in a Discord channel when a YouTube channel uploads (or starts a stream or
// premiere) and when a Twitch channel goes live. Checks run in the app, while it's open or in the tray.
// YouTube is read from each channel's public feed, which needs no login but is often down, or with
// an API key through the YouTube Data API. Twitch goes through its API with a token from "Log in with
// Twitch" (device-code sign-in, no client secret).
// No Electron here, so it can be tested with a fake fetch.

const YT_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_KEY_CHECK_CHANNEL = 'UCBR8-60-B28hp2BmDPdntcQ'; // YouTube's own channel, to test a key on
const YT_VIDEOS = 15; // the latest uploads read per check, as many as the feed has
const TWITCH_AUTH = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const YOUTUBE_EVERY_MS = 5 * 60 * 1000;
const TWITCH_EVERY_MS = 60 * 1000;
// Videos older than this are never announced, so a PC that was off for a week doesn't post a backlog.
const CATCH_UP_MS = 2 * 86400000;
const MAX_SEEN = 60;
const COLORS = { youtube: 0xff0033, twitch: 0x9146ff };
// YouTube's feed sometimes answers 404 or a 5xx for a channel that exists, then works again moments
// later. A failed read is tried again after these waits, and an alert only shows a problem once this
// many checks in a row have failed (a missed video is still in the feed at the next check).
const FEED_RETRY_MS = [1500, 4000];
const FAILS_BEFORE_ERROR = 3;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_MESSAGES = {
  youtube: '**{name}** posted a new video: {url}',
  twitch: '**{name}** is live on Twitch! {title}',
};

class TwitchLoginNeeded extends Error {}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s || '').replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\da-f]+));/gi, (_, name, dec, hex) => (name ? ENTITIES[name] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16))));

/* ---------------- YouTube ---------------- */

function parseYouTubeFeed(xml) {
  const tag = (src, name) => decode(src.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || '');
  const head = xml.split('<entry>')[0];
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, entry]) => {
      const url = decode(entry.match(/<link rel="alternate" href="([^"]+)"/)?.[1] || '');
      return {
        id: tag(entry, 'yt:videoId'),
        title: tag(entry, 'title'),
        url,
        published: tag(entry, 'published'),
        thumbnail: decode(entry.match(/<media:thumbnail url="([^"]+)"/)?.[1] || ''),
        isShort: /\/shorts\//.test(url),
      };
    })
    .filter((v) => v.id);
  const author = head.match(/<author>([\s\S]*?)<\/author>/)?.[1] || '';
  return { name: tag(author, 'name') || tag(head, 'title'), videos };
}

async function fetchYouTubeFeed(channelId, fetchImpl, { sleep = realSleep } = {}) {
  let problem = '';
  for (let attempt = 0; attempt <= FEED_RETRY_MS.length; attempt++) {
    if (attempt) await sleep(FEED_RETRY_MS[attempt - 1]);
    let res;
    try {
      res = await fetchImpl(YT_FEED + channelId, { headers: { 'User-Agent': BROWSER_UA } });
    } catch (err) {
      problem = `couldn't reach YouTube: ${err.message}`;
      continue;
    }
    if (res.ok) return parseYouTubeFeed(await res.text());
    problem = `HTTP ${res.status}`;
    if (res.status !== 404 && res.status !== 429 && res.status < 500) break; // trying again won't change it
  }
  throw new Error(`YouTube's video feed for this channel isn't answering right now (${problem}). The app keeps checking and posts anything it missed. To check through YouTube's API instead, add a YouTube API key under Accounts.`);
}

// A call to the YouTube Data API. The key goes in a header, not the address.
async function youtubeApi(path, params, apiKey, fetchImpl) {
  const res = await fetchImpl(`${YT_API}/${path}?${new URLSearchParams(params)}`, { headers: { 'X-Goog-Api-Key': apiKey, Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const reasons = [body.error?.errors?.[0]?.reason, ...(body.error?.details || []).map((d) => d.reason)].filter(Boolean).join(' ');
  const said = body.error?.message || `HTTP ${res.status}`;
  let message = `YouTube's API said: ${said}`;
  if (/API_KEY_INVALID|keyInvalid/.test(reasons) || /API key not valid/i.test(said)) message = "That YouTube API key isn't valid. Copy it again from Google Cloud → Credentials.";
  else if (/accessNotConfigured|SERVICE_DISABLED/.test(reasons)) message = 'Turn on "YouTube Data API v3" for your Google Cloud project (APIs & Services → Library), wait a minute, then try again.';
  else if (/quotaExceeded|dailyLimitExceeded|RATE_LIMIT_EXCEEDED/.test(reasons)) message = "Your YouTube API key has used up today's free quota. It resets at midnight Pacific time.";
  else if (/API_KEY_\w*BLOCKED|forbidden/.test(reasons)) message = "Your YouTube API key isn't allowed to call the YouTube Data API. In Google Cloud → Credentials, let the key use YouTube Data API v3, with no website or IP address limits.";
  throw Object.assign(new Error(message), { status: res.status, reasons });
}

// Checks a key works before it's saved.
async function checkYouTubeKey(apiKey, fetchImpl) {
  await youtubeApi('channels', { part: 'id', id: YT_KEY_CHECK_CHANNEL }, apiKey, fetchImpl);
}

// A channel's latest public uploads, from its uploads playlist ("UU" + the channel ID's rest).
// The API doesn't say which ones are Shorts, so isShort is null until isYouTubeShort is asked.
async function fetchYouTubeApiVideos(channelId, apiKey, fetchImpl) {
  let body;
  try {
    body = await youtubeApi('playlistItems', { part: 'snippet,contentDetails,status', playlistId: `UU${channelId.slice(2)}`, maxResults: String(YT_VIDEOS) }, apiKey, fetchImpl);
  } catch (err) {
    if (/playlistNotFound/.test(err.reasons || '')) return { name: '', videos: [] }; // no uploads yet
    throw err;
  }
  const items = (body.items || []).filter((i) => i.status?.privacyStatus === 'public' && i.contentDetails?.videoId);
  return {
    name: items[0]?.snippet?.channelTitle || '',
    videos: items.map((i) => {
      const t = i.snippet.thumbnails || {};
      return {
        id: i.contentDetails.videoId,
        title: i.snippet.title || '',
        url: `https://www.youtube.com/watch?v=${i.contentDetails.videoId}`,
        published: i.contentDetails.videoPublishedAt || i.snippet.publishedAt || '',
        thumbnail: (t.maxres || t.high || t.medium || t.default)?.url || '',
        isShort: null,
      };
    }),
  };
}

// A Short opens at /shorts/<id>; any other video is sent on to /watch from there.
async function isYouTubeShort(videoId, fetchImpl) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/shorts/${videoId}`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': BROWSER_UA, Cookie: 'SOCS=CAI' } });
    return res.status === 200;
  } catch {
    return false;
  }
}

// A channel's latest videos: through the API when there's a key, otherwise from the public feed.
function fetchYouTubeVideos(channelId, { apiKey, fetchImpl, sleep } = {}) {
  return apiKey ? fetchYouTubeApiVideos(channelId, apiKey, fetchImpl) : fetchYouTubeFeed(channelId, fetchImpl, { sleep });
}

async function fetchChannelPage(page, fetchImpl) {
  // The cookie skips YouTube's cookie-consent page, which some regions show first.
  const res = await fetchImpl(page, { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en', Cookie: 'SOCS=CAI' } });
  if (!res.ok) throw new Error(res.status === 404 ? "There's no YouTube channel at that link." : `YouTube returned HTTP ${res.status}.`);
  return res.text();
}

const channelPageName = (html) => decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || '').trim();

// Accepts a channel link (/channel/UC…, /@handle, /c/name or /user/name), an @handle or a UC… ID.
async function resolveYouTubeChannel(input, fetchImpl, options) {
  const text = String(input || '').trim();
  let id = text.match(/(?:^|\/channel\/)(UC[\w-]{22})(?=[/?#]|$)/)?.[1] || null;
  let name = '';
  if (!id) {
    let page = null;
    if (/^@[\w.-]{3,100}$/.test(text)) page = `https://www.youtube.com/${text}`;
    else {
      try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        const path = url.pathname.match(/^\/(@[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/)?.[0];
        if (/(^|\.)youtube\.com$/i.test(url.hostname) && path) page = `https://www.youtube.com${path}`;
      } catch {
        // not a link
      }
    }
    if (!page) throw new Error('Paste a YouTube channel link, like https://www.youtube.com/@name.');
    const html = await fetchChannelPage(page, fetchImpl);
    id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/))?.[1];
    if (!id) throw new Error("Couldn't find that channel on YouTube.");
    name = channelPageName(html);
  }
  if (!name && options?.apiKey) {
    const found = await youtubeApi('channels', { part: 'snippet', id }, options.apiKey, fetchImpl);
    if (!found.items?.length) throw new Error("There's no YouTube channel at that link.");
    name = found.items[0].snippet?.title || '';
  }
  if (!name) {
    try {
      name = (await fetchYouTubeFeed(id, fetchImpl, options)).name;
    } catch (err) {
      // The feed is having a moment: the channel's own page still shows it exists, and its name.
      name = channelPageName(await fetchChannelPage(`https://www.youtube.com/channel/${id}`, fetchImpl));
      if (!name) throw err;
    }
  }
  return { id, name: name || id, url: `https://www.youtube.com/channel/${id}` };
}

/* ---------------- Twitch ---------------- */

async function twitchForm(path, params, fetchImpl) {
  const res = await fetchImpl(`${TWITCH_AUTH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const tokensFrom = (data, now) => ({ access: data.access_token, refresh: data.refresh_token, expiresAt: now + (Number(data.expires_in) || 14400) * 1000 });

// Step 1 of "Log in with Twitch": Twitch gives a short code the user confirms at twitch.tv/activate.
// Checking whether a channel is live needs no scopes; if Twitch insists on one, the least sensitive
// read scope is asked for instead.
const FALLBACK_SCOPE = 'user:read:follows';

async function twitchStartLogin(clientId, fetchImpl, now = Date.now()) {
  let scopes = '';
  let res = await twitchForm('device', { client_id: clientId, scopes }, fetchImpl);
  if (!res.ok && /scope/i.test(String(res.data.message || ''))) {
    scopes = FALLBACK_SCOPE;
    res = await twitchForm('device', { client_id: clientId, scopes }, fetchImpl);
  }
  if (!res.ok) {
    const message = String(res.data.message || '');
    if (/client/i.test(message)) throw new Error('Twitch rejected the Client ID. Check it was copied correctly and that the app\'s Client Type is "Public".');
    throw new Error(`Twitch couldn't start the login (${message || `HTTP ${res.status}`}).`);
  }
  const d = res.data;
  return { deviceCode: d.device_code, userCode: d.user_code, verificationUri: d.verification_uri, interval: Number(d.interval) || 5, expiresAt: now + (Number(d.expires_in) || 1800) * 1000, scopes };
}

// Step 2: wait until the user approves (or declines, or the code expires).
async function twitchFinishLogin(clientId, login, fetchImpl, { sleep, cancelled = () => false, now = Date.now }) {
  let interval = login.interval;
  while (now() < login.expiresAt) {
    await sleep(interval * 1000);
    if (cancelled()) throw new Error('Twitch login cancelled.');
    const res = await twitchForm('token', { client_id: clientId, scopes: login.scopes || '', device_code: login.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, fetchImpl);
    if (res.ok && res.data.access_token) return tokensFrom(res.data, now());
    const message = String(res.data.message || '');
    if (message === 'authorization_pending') continue;
    if (message === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new Error(/denied/i.test(message) ? 'The Twitch login was declined.' : `The Twitch login failed (${message || `HTTP ${res.status}`}).`);
  }
  throw new Error('The Twitch code expired. Press Log in with Twitch to get a new one.');
}

// Refresh tokens work once and expire 30 days after they're made, so each new one is saved at once.
async function twitchRefresh(clientId, refreshToken, fetchImpl, now = Date.now()) {
  const res = await twitchForm('token', { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, fetchImpl);
  if (res.ok && res.data.access_token) return tokensFrom(res.data, now);
  throw new TwitchLoginNeeded('The Twitch login expired. Log in with Twitch again.');
}

// Helix API calls with a token that refreshes itself. getTokens/saveTokens keep the tokens encrypted elsewhere.
function createTwitchClient({ clientId, getTokens, saveTokens, fetchImpl, now = Date.now }) {
  let refreshing = null;

  async function accessToken(force = false) {
    const tokens = getTokens();
    if (!tokens?.refresh) throw new TwitchLoginNeeded('Log in with Twitch first.');
    if (!force && tokens.expiresAt - now() > 60000) return tokens.access;
    refreshing ??= twitchRefresh(clientId, tokens.refresh, fetchImpl, now())
      .then((next) => {
        saveTokens(next);
        return next;
      })
      .finally(() => {
        refreshing = null;
      });
    return (await refreshing).access;
  }

  async function helix(path, retried = false) {
    const res = await fetchImpl(HELIX + path, { headers: { Authorization: `Bearer ${await accessToken(retried)}`, 'Client-Id': clientId } });
    if (res.status === 401 && !retried) return helix(path, true);
    if (res.status === 401) throw new TwitchLoginNeeded('The Twitch login stopped working. Log in with Twitch again.');
    if (!res.ok) throw new Error(`Twitch returned HTTP ${res.status}.`);
    return res.json();
  }

  const query = (key, values) => values.map((v) => `${key}=${encodeURIComponent(v)}`).join('&');
  return {
    me: async () => (await helix('/users')).data[0],
    users: async (logins) => (await helix(`/users?${query('login', logins)}`)).data,
    streams: async (userIds) => {
      const live = [];
      for (let i = 0; i < userIds.length; i += 100) live.push(...(await helix(`/streams?first=100&${query('user_id', userIds.slice(i, i + 100))}`)).data);
      return live;
    },
  };
}

/* ---------------- Messages ---------------- */

const fill = (template, vars) => String(template).replace(/\{(name|title|url|game)\}/g, (_, key) => vars[key] ?? '');

// The ping in front of the message, and the allowed_mentions that let it actually ping.
function mentionFor(alert) {
  if (alert.mention === 'everyone' || alert.mention === 'here') return { prefix: `@${alert.mention} `, allowed: { parse: ['everyone'] } };
  if (/^\d{15,21}$/.test(String(alert.mention || ''))) return { prefix: `<@&${alert.mention}> `, allowed: { parse: [], roles: [String(alert.mention)] } };
  return { prefix: '', allowed: { parse: [] } };
}

// YouTube links unfurl into a playable preview on their own, so the message is just text.
function youtubeMessage(alert, channelName, video) {
  const { prefix, allowed } = mentionFor(alert);
  const text = fill(alert.message || DEFAULT_MESSAGES.youtube, { name: channelName, title: video.title, url: video.url, game: '' });
  return { content: (prefix + text).slice(0, 2000), allowed_mentions: allowed };
}

function twitchMessage(alert, stream, now = Date.now()) {
  const { prefix, allowed } = mentionFor(alert);
  const url = `https://www.twitch.tv/${stream.user_login}`;
  const text = fill(alert.message || DEFAULT_MESSAGES.twitch, { name: stream.user_name, title: stream.title, url, game: stream.game_name || '' });
  const fields = [];
  if (stream.game_name) fields.push({ name: 'Playing', value: stream.game_name.slice(0, 1024), inline: true });
  if (stream.viewer_count != null) fields.push({ name: 'Viewers', value: String(stream.viewer_count), inline: true });
  const embed = {
    author: { name: `${stream.user_name} is live on Twitch`, url },
    title: (stream.title || `${stream.user_name} is live`).slice(0, 256),
    url,
    color: COLORS.twitch,
    fields,
    timestamp: stream.started_at || new Date(now).toISOString(),
  };
  // The time on the end stops Discord showing an old cached preview image.
  if (stream.thumbnail_url) embed.image = { url: `${stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Math.floor(now / 60000)}` };
  return { content: (prefix + text).slice(0, 2000), embeds: [embed], allowed_mentions: allowed };
}

/* ---------------- Watcher ---------------- */

// alerts: [{ id, botId, guildId, channelId, platform: 'youtube'|'twitch', source: { id, name, login?, url },
//   message, mention, shorts, enabled, createdAt, state: { seen, live, checkedAt, error, lastPostAt } }]
// post(alert, message) sends to Discord; updateState(id, state) saves an alert's state.
function createSocialWatcher({ getAlerts, updateState, post, getTwitch, fetchImpl, now = Date.now, sleep = realSleep, youtubeKey = () => '' }) {
  let running = false;
  let twitchCheckedAt = 0;

  const send = async (alert, message, state) => {
    try {
      await post(alert, message);
      state.lastPostAt = now();
      state.error = null;
    } catch (err) {
      state.error = `Couldn't post in Discord: ${err.message}`;
    }
  };

  async function checkYouTube(alerts) {
    const byChannel = new Map();
    for (const a of alerts) if (now() - (a.state?.checkedAt || 0) >= YOUTUBE_EVERY_MS) byChannel.set(a.source.id, [...(byChannel.get(a.source.id) || []), a]);
    for (const [channelId, group] of byChannel) {
      let feed;
      try {
        feed = await fetchYouTubeVideos(channelId, { apiKey: youtubeKey(), fetchImpl, sleep });
      } catch (err) {
        for (const a of group) {
          const failures = (a.state?.failures || 0) + 1;
          updateState(a.id, { ...a.state, checkedAt: now(), failures, error: failures >= FAILS_BEFORE_ERROR ? err.message : a.state?.error || null });
        }
        continue;
      }
      for (const a of group) {
        const state = { ...a.state, checkedAt: now(), error: null, failures: 0 };
        const seen = new Set(state.seen || []);
        const since = Math.max(a.createdAt || 0, now() - CATCH_UP_MS);
        const fresh = feed.videos.filter((v) => !seen.has(v.id) && Date.parse(v.published) >= since).reverse(); // oldest first
        for (const v of fresh) {
          // Only new videos are asked about, once each (alerts on the same channel share the answer).
          if (a.shorts === false && (v.isShort ??= await isYouTubeShort(v.id, fetchImpl))) continue;
          await send(a, youtubeMessage(a, feed.name || a.source.name, v), state);
        }
        state.seen = [...new Set([...feed.videos.map((v) => v.id), ...seen])].slice(0, MAX_SEEN);
        updateState(a.id, state);
      }
    }
  }

  async function checkTwitch(alerts) {
    if (!alerts.length || now() - twitchCheckedAt < TWITCH_EVERY_MS) return;
    twitchCheckedAt = now();
    const twitch = getTwitch();
    let live;
    try {
      if (!twitch) throw new TwitchLoginNeeded('Log in with Twitch to check these channels.');
      live = new Map((await twitch.streams([...new Set(alerts.map((a) => a.source.id))])).map((s) => [s.user_id, s]));
    } catch (err) {
      for (const a of alerts) updateState(a.id, { ...a.state, checkedAt: now(), error: err.message });
      return;
    }
    for (const a of alerts) {
      const stream = live.get(a.source.id);
      const state = { ...a.state, checkedAt: now(), error: null };
      // The first check only notes whether they're live, so adding an alert mid-stream doesn't post.
      if (a.state?.live === undefined) state.live = stream?.id || null;
      else if (stream && stream.id !== a.state.live) {
        state.live = stream.id;
        await send(a, twitchMessage(a, stream, now()), state);
      } else if (!stream) state.live = null;
      updateState(a.id, state);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const alerts = getAlerts().filter((a) => a.enabled !== false);
      await checkYouTube(alerts.filter((a) => a.platform === 'youtube'));
      await checkTwitch(alerts.filter((a) => a.platform === 'twitch'));
    } finally {
      running = false;
    }
  }

  return { tick };
}

module.exports = {
  parseYouTubeFeed,
  fetchYouTubeFeed,
  fetchYouTubeVideos,
  checkYouTubeKey,
  isYouTubeShort,
  resolveYouTubeChannel,
  twitchStartLogin,
  twitchFinishLogin,
  twitchRefresh,
  createTwitchClient,
  createSocialWatcher,
  youtubeMessage,
  twitchMessage,
  mentionFor,
  TwitchLoginNeeded,
  DEFAULT_MESSAGES,
};
