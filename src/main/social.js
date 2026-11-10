// Social alerts: posts in a Discord channel when a YouTube channel uploads (or starts a stream or
// premiere), when a Twitch channel goes live, when a GitHub account or repo publishes a release
// or a new repo, when a TikTok account posts a video, and when the owner's Instagram account posts.
// Checks run in the app, while it's open or in the tray.
// YouTube is read from each channel's public feed, which needs no login but is often down, or with
// an API key through the YouTube Data API. Twitch goes through its API with a token from "Log in with
// Twitch" (device-code sign-in, no client secret). GitHub is read from its public feeds (a repo's
// releases, or an account's public activity), which need no login and aren't rate limited like its API.
// TikTok is read from an account's creator embed (the page sites show its latest videos in), which
// needs no login. Instagram only lets an app see accounts that connected to it, so it goes through
// the Instagram API with a token the owner makes for their own account in Meta for Developers.
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
const GITHUB = 'https://github.com';
const GITHUB_EVERY_MS = 5 * 60 * 1000;
const GITHUB_UA = 'DiscordServerBuilder (social alerts)';
const TIKTOK = 'https://www.tiktok.com';
const TIKTOK_EVERY_MS = 10 * 60 * 1000; // TikTok's page isn't an API: read it gently
const INSTAGRAM_API = 'https://graph.instagram.com';
const INSTAGRAM_EVERY_MS = 5 * 60 * 1000;
const INSTAGRAM_POSTS = 15;
// Instagram tokens last 60 days and can be renewed once they're a day old. Each is renewed a week
// after it was made or last renewed (a failed try waits a day), so it never runs out while the app is used.
const INSTAGRAM_TOKEN_MS = 60 * 86400000;
const INSTAGRAM_RENEW_AFTER_MS = 7 * 86400000;
const INSTAGRAM_RENEW_RETRY_MS = 86400000;
// Videos older than this are never announced, so a PC that was off for a week doesn't post a backlog.
const CATCH_UP_MS = 2 * 86400000;
const MAX_SEEN = 60;
const COLORS = { youtube: 0xff0033, twitch: 0x9146ff, tiktok: 0x25f4ee, instagram: 0xdd2a7b };
// Which GitHub events an alert posts, unless set: releases, and new repos (an account only).
const GITHUB_EVENTS = { releases: true, repos: true };
// YouTube's feed sometimes answers 404 or a 5xx for a channel that exists, then works again moments
// later. A failed read is tried again after these waits, and an alert only shows a problem once this
// many checks in a row have failed (a missed video is still in the feed at the next check).
const FEED_RETRY_MS = [1500, 4000];
const FAILS_BEFORE_ERROR = 3;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_MESSAGES = {
  youtube: '**{name}** posted a new video: {url}',
  twitch: '**{name}** is live on Twitch! {title}',
  github: '**{name}** released **{title}**: {url}',
  githubRepo: 'New on GitHub: **{name}** {url}',
  tiktok: '**{name}** posted a new TikTok!',
  instagram: '**{name}** posted on Instagram!',
};

class TwitchLoginNeeded extends Error {}
// An Instagram token that's gone: shown on the alert at once, since checking again won't fix it.
class InstagramTokenProblem extends Error {}

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

/* ---------------- GitHub ---------------- */

// An account or repo from what the owner typed: a github.com link (any page in it), owner, or owner/repo.
function parseGitHubSource(input) {
  const text = String(input || '').trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '').replace(/^@/, '');
  const m = text.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:\/([A-Za-z0-9._-]{1,100}))?(?:[/?#]|$)/);
  if (!m) throw new Error('Paste a GitHub link, like github.com/you or github.com/you/repo.');
  const repo = m[2]?.replace(/\.git$/i, '');
  return repo && !/^(\.|\.\.)$/.test(repo) ? { owner: m[1], repo } : { owner: m[1], repo: null };
}

const githubFeedUrl = (source) => (source.kind === 'repo' ? `${GITHUB}/${source.id}/releases.atom` : `${GITHUB}/${source.id}.atom`);

async function fetchGitHubFeed(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': GITHUB_UA, Accept: 'application/atom+xml' } });
  } catch (err) {
    throw new Error(`Couldn't reach GitHub (${err.cause?.code || err.message}).`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
  return res.text();
}

// The entries of a GitHub Atom feed: { id, title, url, at }, and the feed's own page link.
function parseGitHubAtom(xml) {
  const tag = (src, name) => decode(src.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || '');
  const link = (src) => decode(src.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] || '');
  const head = xml.split('<entry>')[0];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({ id: tag(e, 'id'), title: tag(e, 'title'), url: link(e), author: tag(e, 'name'), at: Date.parse(tag(e, 'published') || tag(e, 'updated')) || 0 }));
  return { page: link(head), entries: entries.filter((e) => e.id) };
}

// A GitHub account or public repo to watch, checked by reading its feed.
async function resolveGitHubSource(input, fetchImpl) {
  const { owner, repo } = parseGitHubSource(input);
  const kind = repo ? 'repo' : 'user';
  const xml = await fetchGitHubFeed(repo ? `${GITHUB}/${owner}/${repo}/releases.atom` : `${GITHUB}/${owner}.atom`, fetchImpl);
  if (xml == null) throw new Error(repo ? `There's no public GitHub repo at github.com/${owner}/${repo}. Private repos can't be watched.` : `There's no GitHub account called ${owner}.`);
  // The name as GitHub writes it: a repo's feed links to it, an account's entries name it.
  const feed = parseGitHubAtom(xml);
  const page = feed.page.replace(/^https:\/\/github\.com\//, '').replace(/\/releases$/, '');
  const author = feed.entries.map((e) => e.author).find((a) => a.toLowerCase() === owner.toLowerCase());
  const id = repo ? (/^[^/]+\/[^/]+$/.test(page) ? page : `${owner}/${repo}`) : author || (/^[^/]+$/.test(page) ? page : owner);
  return { id, name: id, kind, url: `${GITHUB}/${id}`, avatar: `${GITHUB}/${id.split('/')[0]}.png?size=64` };
}

// What happened on GitHub, newest first: { id, kind: 'release'|'repo', repo, title, url, at }. A repo's
// feed has its releases; an account's has its public activity, of which releases and new (or newly
// public) repos are kept.
async function fetchGitHubEvents(source, fetchImpl) {
  const xml = await fetchGitHubFeed(githubFeedUrl(source), fetchImpl);
  if (xml == null) throw new Error(source.kind === 'repo' ? 'This repo is gone or private now.' : 'This GitHub account is gone.');
  const { entries } = parseGitHubAtom(xml);
  if (source.kind === 'repo') return entries.map((e) => ({ ...e, kind: 'release', repo: source.id }));
  const REPO = '([A-Za-z0-9-]+\\/[A-Za-z0-9._-]+)';
  const events = [];
  for (const e of entries) {
    let m;
    if ((m = e.title.match(new RegExp(` released (.+) at ${REPO}$`)))) events.push({ ...e, kind: 'release', title: m[1], repo: m[2] });
    else if ((m = e.title.match(new RegExp(` created a repository ${REPO}$`)) || e.title.match(new RegExp(` made ${REPO} public$`)))) events.push({ ...e, kind: 'repo', title: m[1], repo: m[1], url: e.url || `${GITHUB}/${m[1]}` });
  }
  return events;
}

// GitHub links unfurl into a preview card on their own, so the message is just text.
function githubMessage(alert, event) {
  const { prefix, allowed } = mentionFor(alert);
  const template = event.kind === 'repo' ? alert.repoMessage || DEFAULT_MESSAGES.githubRepo : alert.message || DEFAULT_MESSAGES.github;
  const text = fill(template, { name: event.repo.split('/').pop(), title: event.title, url: event.url, game: '' });
  return { content: (prefix + text).slice(0, 2000), allowed_mentions: allowed };
}

const githubEventsOf = (alert) => ({ ...GITHUB_EVENTS, ...alert.events, repos: alert.source?.kind === 'user' && (alert.events?.repos ?? GITHUB_EVENTS.repos) });

/* ---------------- TikTok and Instagram posts ---------------- */
// Posts from both are { id, title (the caption), url, at, image, kind? }, newest first.

// TikTok and Instagram links don't unfurl well in Discord, so their alerts bring a card of their own:
// "New TikTok" (or reel, or post) linking to it, with the caption and the cover picture.
function postCard({ color, author, profile, post, untitled, footer }) {
  const caption = String(post.title || '').trim();
  const embed = { author: { name: author.slice(0, 256), ...(profile ? { url: profile } : {}) }, title: untitled, url: post.url, color, footer: { text: footer } };
  if (caption) embed.description = caption.length > 350 ? `${caption.slice(0, 349)}…` : caption;
  if (post.at) embed.timestamp = new Date(post.at).toISOString();
  if (/^https:\/\//.test(post.image || '')) embed.image = { url: post.image };
  return embed;
}

function postMessage(alert, name, post, { platform, author, untitled }) {
  const { prefix, allowed } = mentionFor(alert);
  const text = fill(alert.message || DEFAULT_MESSAGES[platform], { name, title: post.title, url: post.url, game: '' });
  const card = postCard({ color: COLORS[platform], author, profile: alert.source?.url, post, untitled, footer: platform === 'tiktok' ? 'TikTok' : 'Instagram' });
  return { content: (prefix + text).slice(0, 2000), embeds: [card], allowed_mentions: allowed };
}

/* ---------------- TikTok ---------------- */

// An account from a profile link (or a video's link, which names the account), @name or name.
function parseTikTokName(input) {
  const text = String(input || '').trim();
  const fromLink = text.match(/tiktok\.com\/@([^/?#]+)/i)?.[1];
  if (!fromLink && /tiktok\.com\//i.test(text)) throw new Error("Paste the account's profile link, like tiktok.com/@name (a share link like vm.tiktok.com doesn't name the account).");
  const name = fromLink || text.replace(/^@/, '');
  if (!/^[A-Za-z0-9_.]{2,24}$/.test(name)) throw new Error('Enter a TikTok account, like tiktok.com/@name or @name.');
  return name.toLowerCase();
}

// A TikTok video's ID starts with the second it was posted (its top 32 bits).
function tiktokTime(id) {
  try {
    return Number(BigInt(String(id)) >> 32n) * 1000;
  } catch {
    return 0;
  }
}

// The data in an account's creator embed: { found, user: { id, name, avatar, private }, videos }.
// null when the page isn't one (TikTok sent something else).
function parseTikTokEmbed(html) {
  const json = String(html || '').match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let page;
  try {
    page = Object.entries(JSON.parse(json).source?.data || {}).find(([key]) => key.startsWith('/embed/@'))?.[1];
  } catch {
    return null;
  }
  if (!page) return null;
  const u = page.userInfo || {};
  if (page.isError || !u.uniqueId || !u.id) return { found: false, user: null, videos: [] };
  const user = { id: String(u.uniqueId).toLowerCase(), name: String(u.nickname || u.uniqueId), avatar: u.avatarThumbUrl || null, private: !!u.privateAccount };
  const videos = (page.videoList || [])
    .filter((v) => /^\d{15,25}$/.test(String(v.id)) && !v.privateItem)
    .map((v) => ({ id: String(v.id), title: String(v.desc || ''), url: `${TIKTOK}/@${v.authorUniqueId || user.id}/video/${v.id}`, at: tiktokTime(v.id), image: v.coverUrl || v.originCoverUrl || null }));
  return { found: true, user, videos };
}

// An account's latest videos. TikTok sometimes doesn't answer or sends another page, so it's tried
// again like YouTube's feed.
async function fetchTikTok(name, fetchImpl, { sleep = realSleep } = {}) {
  let problem = '';
  for (let attempt = 0; attempt <= FEED_RETRY_MS.length; attempt++) {
    if (attempt) await sleep(FEED_RETRY_MS[attempt - 1]);
    let res;
    let page;
    try {
      res = await fetchImpl(`${TIKTOK}/embed/@${encodeURIComponent(name)}`, { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' } });
      page = parseTikTokEmbed(await res.text());
    } catch (err) {
      problem = `couldn't reach TikTok: ${err.cause?.code || err.message}`;
      continue;
    }
    if (page?.found) return page;
    if (page) throw new Error(`There's no public TikTok account called @${name}.`);
    problem = res.ok ? 'it sent a page without the videos' : `HTTP ${res.status}`;
  }
  throw new Error(`TikTok isn't showing @${name}'s videos right now (${problem}). The app keeps checking and posts anything it missed.`);
}

async function resolveTikTokAccount(input, fetchImpl, options) {
  const { user } = await fetchTikTok(parseTikTokName(input), fetchImpl, options);
  if (user.private) throw new Error(`@${user.id} is a private account, so its videos can't be seen.`);
  return { id: user.id, login: user.id, name: user.name, url: `${TIKTOK}/@${user.id}`, avatar: user.avatar };
}

const tiktokMessage = (alert, name, video) => postMessage(alert, name || alert.source.name, video, { platform: 'tiktok', author: `${name || alert.source.name} on TikTok`, untitled: 'New TikTok' });

/* ---------------- Instagram ---------------- */

function instagramError(status, error = {}) {
  const code = Number(error.code) || 0;
  let err;
  if (code === 190 || status === 401) err = new InstagramTokenProblem("This Instagram token doesn't work any more (it ran out, or was removed in Meta for Developers). Make a new one and paste it under Accounts.");
  else if ([4, 17, 32, 613].includes(code) || status === 429) err = new Error('Instagram says the app checked too often. It tries again in a few minutes.');
  else if (code === 10 || code === 200) err = new InstagramTokenProblem("This token isn't allowed to read the account's posts. Make it under Use cases → Customize → API setup with Unified login, as the steps under Accounts say.");
  else err = new Error(`Instagram's API said: ${error.message || `HTTP ${status}`}`);
  return Object.assign(err, { code });
}

// A call to the Instagram API. The token goes in a header, not the address.
async function instagramApi(path, params, token, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${INSTAGRAM_API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Couldn't reach Instagram (${err.cause?.code || err.message}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && !body.error) return body;
  throw instagramError(res.status, body.error);
}

// Asks for some fields, or fewer if Instagram says one of them doesn't exist (error 100).
async function instagramFields(path, fields, fallback, params, token, fetchImpl) {
  try {
    return await instagramApi(path, { ...params, fields }, token, fetchImpl);
  } catch (err) {
    if (err.code !== 100) throw err;
    return instagramApi(path, { ...params, fields: fallback }, token, fetchImpl);
  }
}

// The account a pasted token belongs to: { id, username, name, avatar, type }.
async function checkInstagramToken(token, fetchImpl) {
  const value = String(token || '').trim();
  if (/^EAA/.test(value)) throw new Error("That's a Facebook token. Use the one from Use cases → Customize → API setup with Unified login (it starts with IG).");
  if (!/^[\w.|-]{40,1000}$/.test(value)) throw new Error("That doesn't look like an Instagram token. Copy the whole token from Meta for Developers.");
  let me;
  try {
    me = await instagramFields('me', 'user_id,username,name,account_type,profile_picture_url', 'user_id,username', {}, value, fetchImpl);
  } catch (err) {
    if (err instanceof InstagramTokenProblem) throw new Error("Instagram didn't accept that token. Make a new one (Use cases → Customize → API setup with Unified login → Generate token) and copy all of it.");
    throw err;
  }
  if (!me.username) throw new Error("Instagram didn't say which account that token is for.");
  return { id: String(me.user_id || me.id), username: me.username, name: me.name || me.username, avatar: me.profile_picture_url || null, type: me.account_type || '' };
}

// The account's latest posts: photos, carousels, videos and reels (stories aren't included).
async function fetchInstagramPosts(token, fetchImpl) {
  const basic = 'id,caption,media_type,permalink,thumbnail_url,media_url,timestamp';
  const body = await instagramFields('me/media', `${basic},media_product_type`, basic, { limit: String(INSTAGRAM_POSTS) }, token, fetchImpl);
  return (body.data || [])
    .filter((m) => m.id && /^https:\/\//.test(m.permalink || ''))
    .map((m) => {
      const picture = m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null); // a carousel's first item could be a video
      return {
        id: String(m.id),
        title: String(m.caption || ''),
        url: m.permalink,
        at: Date.parse(String(m.timestamp || '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) || 0, // "+0000" → "+00:00"
        image: picture && !/\.mp4(\?|$)/i.test(picture) ? picture : null,
        kind: m.media_product_type === 'REELS' || /\/reels?\//.test(m.permalink) ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : m.media_type === 'VIDEO' ? 'video' : 'photo',
      };
    });
}

// A token renewed for another 60 days: { token, renewedAt, expiresAt }. Needs no app secret.
async function renewInstagramToken(token, fetchImpl, now = Date.now()) {
  const res = await fetchImpl(`${INSTAGRAM_API}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw instagramError(res.status, body.error);
  return { token: body.access_token, renewedAt: now, expiresAt: now + (Number(body.expires_in) || INSTAGRAM_TOKEN_MS / 1000) * 1000 };
}

// A newly pasted token: assumed to be fresh, so it lasts 60 days from now until it's renewed.
const newInstagramToken = (token, now = Date.now()) => ({ token: String(token).trim(), renewedAt: now, expiresAt: now + INSTAGRAM_TOKEN_MS });

// Reads a connected account's posts with its saved token ({ token, renewedAt, expiresAt, triedAt }),
// renewing the token when it's due. getToken/saveToken keep the tokens encrypted elsewhere.
function createInstagramClient({ getToken, saveToken, fetchImpl, now = Date.now }) {
  const renewing = new Map();
  async function tokenFor(accountId) {
    const record = getToken(accountId);
    if (!record?.token) throw new InstagramTokenProblem("This Instagram account isn't connected. Connect it under Accounts.");
    if (record.expiresAt <= now()) throw new InstagramTokenProblem('This Instagram token ran out. Make a new one in Meta for Developers and paste it under Accounts.');
    if (now() - record.renewedAt < INSTAGRAM_RENEW_AFTER_MS || now() - (record.triedAt || 0) < INSTAGRAM_RENEW_RETRY_MS) return record.token;
    if (!renewing.has(accountId)) {
      const renewal = renewInstagramToken(record.token, fetchImpl, now())
        .then(
          (next) => {
            saveToken(accountId, next);
            return next.token;
          },
          () => {
            // Keep the old token; it still works until it runs out, and renewing is tried again tomorrow.
            saveToken(accountId, { ...record, triedAt: now() });
            return record.token;
          },
        )
        .finally(() => renewing.delete(accountId));
      renewing.set(accountId, renewal);
    }
    return renewing.get(accountId);
  }
  return { posts: async (accountId) => fetchInstagramPosts(await tokenFor(accountId), fetchImpl) };
}

const INSTAGRAM_UNTITLED = { reel: 'New reel', video: 'New video', carousel: 'New post', photo: 'New post' };
const instagramMessage = (alert, name, post) => postMessage(alert, name || alert.source.name, post, { platform: 'instagram', author: `@${alert.source.login || alert.source.name} on Instagram`, untitled: INSTAGRAM_UNTITLED[post.kind] || 'New post' });

/* ---------------- Watcher ---------------- */

// alerts: [{ id, botId, guildId, channelId, platform: 'youtube'|'twitch'|'github'|'tiktok'|'instagram', source: { id, name, login?, url, kind? },
//   message, repoMessage?, events?, mention, shorts, enabled, createdAt, state: { seen, live, checkedAt, error, lastPostAt } }]
// post(alert, message) sends to Discord; updateState(id, state) saves an alert's state.
// getInstagram() gives the client for connected Instagram accounts (createInstagramClient), if any.
function createSocialWatcher({ getAlerts, updateState, post, getTwitch, getInstagram = () => null, fetchImpl, now = Date.now, sleep = realSleep, youtubeKey = () => '' }) {
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

  // GitHub: each account or repo's feed every 5 minutes; new releases and repos, oldest first.
  async function checkGitHub(alerts) {
    const bySource = new Map();
    for (const a of alerts) if (now() - (a.state?.checkedAt || 0) >= GITHUB_EVERY_MS) bySource.set(`${a.source.kind}:${a.source.id}`, [...(bySource.get(`${a.source.kind}:${a.source.id}`) || []), a]);
    for (const group of bySource.values()) {
      let events;
      try {
        events = await fetchGitHubEvents(group[0].source, fetchImpl);
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
        const wanted = githubEventsOf(a);
        const fresh = events.filter((e) => !seen.has(e.id) && e.at >= since && (e.kind === 'repo' ? wanted.repos : wanted.releases)).reverse(); // oldest first
        for (const e of fresh) await send(a, githubMessage(a, e), state);
        state.seen = [...new Set([...events.map((e) => e.id), ...seen])].slice(0, MAX_SEEN);
        updateState(a.id, state);
      }
    }
  }

  // TikTok and Instagram: each account's latest posts every `every` ms (alerts on the same account
  // share a read); new ones are posted oldest first. read(accountId) gives { name, posts }.
  async function checkPosts(alerts, every, read, message) {
    const byAccount = new Map();
    for (const a of alerts) if (now() - (a.state?.checkedAt || 0) >= every) byAccount.set(a.source.id, [...(byAccount.get(a.source.id) || []), a]);
    for (const [accountId, group] of byAccount) {
      let found;
      try {
        found = await read(accountId);
      } catch (err) {
        for (const a of group) {
          const failures = (a.state?.failures || 0) + 1;
          const show = failures >= FAILS_BEFORE_ERROR || err instanceof InstagramTokenProblem;
          updateState(a.id, { ...a.state, checkedAt: now(), failures, error: show ? err.message : a.state?.error || null });
        }
        continue;
      }
      for (const a of group) {
        const state = { ...a.state, checkedAt: now(), error: null, failures: 0 };
        const seen = new Set(state.seen || []);
        const since = Math.max(a.createdAt || 0, now() - CATCH_UP_MS);
        const fresh = found.posts.filter((p) => !seen.has(p.id) && p.at >= since).sort((x, y) => x.at - y.at);
        for (const p of fresh) await send(a, message(a, found.name, p), state);
        state.seen = [...new Set([...found.posts.map((p) => p.id), ...seen])].slice(0, MAX_SEEN);
        updateState(a.id, state);
      }
    }
  }

  const readTikTok = async (name) => {
    const page = await fetchTikTok(name, fetchImpl, { sleep });
    return { name: page.user.name, posts: page.videos };
  };

  const readInstagram = async (accountId) => {
    const instagram = getInstagram();
    if (!instagram) throw new InstagramTokenProblem("This Instagram account isn't connected. Connect it under Accounts.");
    return { name: '', posts: await instagram.posts(accountId) };
  };

  async function tick() {
    if (running) return;
    running = true;
    try {
      const alerts = getAlerts().filter((a) => a.enabled !== false);
      await checkYouTube(alerts.filter((a) => a.platform === 'youtube'));
      await checkTwitch(alerts.filter((a) => a.platform === 'twitch'));
      await checkGitHub(alerts.filter((a) => a.platform === 'github'));
      await checkPosts(alerts.filter((a) => a.platform === 'tiktok'), TIKTOK_EVERY_MS, readTikTok, tiktokMessage);
      await checkPosts(alerts.filter((a) => a.platform === 'instagram'), INSTAGRAM_EVERY_MS, readInstagram, instagramMessage);
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
  parseGitHubSource,
  parseGitHubAtom,
  resolveGitHubSource,
  fetchGitHubEvents,
  githubMessage,
  githubEventsOf,
  parseTikTokName,
  parseTikTokEmbed,
  tiktokTime,
  fetchTikTok,
  resolveTikTokAccount,
  tiktokMessage,
  checkInstagramToken,
  fetchInstagramPosts,
  renewInstagramToken,
  newInstagramToken,
  createInstagramClient,
  instagramMessage,
  mentionFor,
  TwitchLoginNeeded,
  InstagramTokenProblem,
  DEFAULT_MESSAGES,
};
