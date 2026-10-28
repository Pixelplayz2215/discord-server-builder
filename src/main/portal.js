// Client for a mod portal (see server/ and docs/MOD-PORTAL.md). Moderators sign in with Discord
// in their browser; this app never sees the bot token, only a session for that portal.
const crypto = require('crypto');
const { shell } = require('electron');

const POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let activeSignIn = null;

function normalizePortalUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Enter the mod portal address your server owner gave you (it starts with https://).');
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('The mod portal address must start with https://');
  return url.origin;
}

async function call(portalUrl, route, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(portalUrl + route, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      // Free hosts can take most of a minute to wake up.
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    throw new Error(`Can't reach the mod portal (${err.cause?.code || err.name}). If it was asleep, try again in a minute.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `The mod portal returned HTTP ${res.status}.`), { status: res.status, code: data.code ?? null });
  return data;
}

// Opens Discord's sign-in page in the browser and waits for the portal to confirm it.
async function signIn(rawUrl) {
  const portalUrl = normalizePortalUrl(rawUrl);
  const state = { cancelled: false };
  activeSignIn = state;
  try {
    await call(portalUrl, '/health');
    const id = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await shell.openExternal(`${portalUrl}/auth/login?id=${id}&challenge=${challenge}`);

    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      if (state.cancelled) throw new Error('Sign-in cancelled.');
      const result = await call(portalUrl, '/auth/poll', { method: 'POST', body: { id, verifier } });
      if (result.token) {
        const me = await call(portalUrl, '/api/me', { token: result.token });
        return { portalUrl, token: result.token, me };
      }
    }
    throw new Error('Sign-in timed out. Try again.');
  } finally {
    if (activeSignIn === state) activeSignIn = null;
  }
}

function cancelSignIn() {
  if (activeSignIn) activeSignIn.cancelled = true;
}

// The account record saved for a signed-in moderator (the session itself is stored encrypted).
const modProfile = (portalUrl, me) => ({
  type: 'mod',
  id: me.user.id,
  username: me.user.username,
  global_name: me.user.global_name || null,
  avatar: me.user.avatar || null,
  portalUrl,
  portalBot: me.bot,
  checkedAt: Date.now(),
});

module.exports = { call, signIn, cancelSignIn, modProfile, normalizePortalUrl };
