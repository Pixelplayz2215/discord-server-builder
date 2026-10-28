// "Sign in with Discord" for the desktop app, plus signed session tokens.
//
// Flow (no local web server needed in the app):
// 1. The app makes a random login id and a secret verifier, then opens
//    /auth/login?id=<id>&challenge=<sha256(verifier)> in the browser.
// 2. The mod approves on Discord; /auth/callback learns who they are and parks it under the id.
// 3. The app polls /auth/poll with the id and the verifier, and receives a session token.
// Only the app knows the verifier, so a leaked login URL can't be used to claim the session.
const crypto = require('crypto');

const DISCORD_API = 'https://discord.com/api/v10';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createSessions(secret, days) {
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue(user) {
      const payload = b64url(JSON.stringify({ ...user, exp: Date.now() + days * 86400000 }));
      return `${payload}.${sign(payload)}`;
    },
    verify(token) {
      const [payload, signature] = String(token || '').split('.');
      if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.exp > Date.now() ? data : null;
      } catch {
        return null;
      }
    },
  };
}

function createAuth(config, { fetchImpl = fetch } = {}) {
  const sessions = createSessions(config.sessionSecret, config.sessionDays);
  const pending = new Map(); // id -> { challenge, created, user }

  const prune = () => {
    const now = Date.now();
    for (const [id, entry] of pending) if (now - entry.created > LOGIN_TTL_MS) pending.delete(id);
  };

  // Step 1: remember the challenge and send the browser to Discord.
  function loginUrl(id, challenge) {
    prune();
    if (!ID_PATTERN.test(id || '') || !ID_PATTERN.test(challenge || '')) throw Object.assign(new Error('Invalid login link.'), { status: 400 });
    if (pending.size >= MAX_PENDING) throw Object.assign(new Error('Too many sign-ins in progress. Try again in a few minutes.'), { status: 429 });
    pending.set(id, { challenge, created: Date.now(), user: null });
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: 'identify',
      state: id,
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  // Step 2: Discord sends the mod back here with a one-time code.
  async function handleCallback(code, state) {
    prune();
    const entry = pending.get(state);
    if (!entry || !code) throw Object.assign(new Error('This sign-in link expired. Start again from the app.'), { status: 400 });
    const tokenRes = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
    });
    if (!tokenRes.ok) throw Object.assign(new Error('Discord rejected the sign-in. Try again.'), { status: 502 });
    const { access_token: accessToken } = await tokenRes.json();
    const userRes = await fetchImpl(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!userRes.ok) throw Object.assign(new Error('Could not read your Discord profile.'), { status: 502 });
    const user = await userRes.json();
    entry.user = { id: user.id, username: user.username, global_name: user.global_name || null, avatar: user.avatar || null };
    return entry.user;
  }

  // Step 3: the app trades its verifier for a session once the browser part is done.
  function poll(id, verifier) {
    prune();
    const entry = pending.get(id);
    if (!entry) throw Object.assign(new Error('Sign-in expired. Start again.'), { status: 410 });
    if (!safeEqual(sha256(String(verifier || '')), entry.challenge)) throw Object.assign(new Error('Invalid sign-in.'), { status: 403 });
    if (!entry.user) return { pending: true };
    pending.delete(id);
    return { token: sessions.issue(entry.user), user: entry.user };
  }

  return { loginUrl, handleCallback, poll, sessions };
}

module.exports = { createAuth, createSessions, sha256 };
