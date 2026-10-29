// Mod portal for Discord Server Builder.
// Holds the bot token so moderators can use the desktop app by signing in with Discord instead.
// Mods only get moderation actions, and only those their own Discord permissions allow.
// No dependencies beyond Node 20+. Start with: node server/index.js
const http = require('http');
const { DiscordRest } = require('../src/main/discord');
const { fetchAllMembers, purgeMessages, setChannelLock } = require('../src/main/builder');
const { loadConfig } = require('./config');
const { createAuth } = require('./auth');
const { createGuard, auditReason } = require('./guard');
const { createInteractions, once } = require('./interactions');
const { createCases, caseFromCall, warnMember } = require('../src/main/cases');

const MAX_BODY = 64 * 1024;
const MAX_INTERACTION_BODY = 1024 * 1024;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function sendPage(res, status, title, message) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store',
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0c22;color:#fbf9fc;font:16px/1.5 system-ui,'Segoe UI',sans-serif}
main{max-width:440px;margin:24px;padding:32px;border-radius:16px;background:#1c173d;border:1px solid rgba(203,196,215,.15);text-align:center}
h1{font-size:22px;margin:0 0 8px;background:linear-gradient(90deg,#0bbfbc,#7f8cf0,#fc354c);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0;color:#b8aecb}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`);
}

// Small fixed-window limiter so one account or address can't hammer the bot.
function createLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      return;
    }
    if (++entry.count > limit) throw httpError(429, 'Slow down — too many requests. Try again in a minute.');
  };
}

// interactions is optional: without it the portal doesn't answer slash commands.
function createPortal({ config, rest, auth, guard, interactions, caseLog = createCases(rest, { botId: once(async () => (await rest.request('GET', '/users/@me')).id) }) }) {
  const limitUser = createLimiter(120, 60000);
  const limitIp = createLimiter(30, 60000);
  let botUser = null;

  const userLabel = async (id) => {
    const u = await rest.request('GET', `/users/${id}`).catch(() => null);
    return u ? u.global_name || u.username : id;
  };
  const snowflake = (value, what) => {
    if (!/^\d{15,21}$/.test(String(value))) throw httpError(400, `Invalid ${what}.`);
    return String(value);
  };

  // A ban, kick, timeout or unban a mod made in the app becomes a case, like the slash commands' ones.
  async function recordCall(user, call, reason) {
    const found = caseFromCall(call.method, call.path, call.body);
    if (!found) return;
    const actor = await guard.actorIn(found.guildId, user);
    await caseLog.record(actor.guild, actor.roles, {
      type: found.type,
      member: { id: found.memberId, label: await userLabel(found.memberId) },
      moderator: user,
      reason,
      duration: found.duration,
    });
  }

  const sessionUser = (req) => {
    const header = req.headers.authorization || '';
    const user = auth.sessions.verify(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!user) throw httpError(401, 'Your sign-in expired. Sign in with Discord again.');
    limitUser(user.id);
    return user;
  };

  const channelGuild = async (channelId) => {
    if (!/^\d{15,21}$/.test(String(channelId))) throw httpError(400, 'Invalid channel.');
    const channel = await rest.request('GET', `/channels/${channelId}`);
    if (!channel.guild_id) throw httpError(400, 'That channel is not in a server.');
    return channel.guild_id;
  };

  const api = {
    'GET /api/me': async (req) => {
      const user = sessionUser(req);
      botUser ??= await rest.request('GET', '/users/@me');
      return { user, bot: { id: botUser.id, username: botUser.username, global_name: botUser.global_name || null, avatar: botUser.avatar } };
    },

    'POST /api/discord': async (req) => {
      const user = sessionUser(req);
      const request = await readJson(req);
      const call = await guard.authorize(user, request);
      if (call.special === 'guilds') return guard.modGuilds(user);
      const result = await rest.request(call.method, call.path, { query: call.query, body: call.body, reason: call.reason });
      // Recorded in the background so the app isn't kept waiting; bulk raid actions opt out.
      if (!request.noCase) recordCall(user, call, typeof request.reason === 'string' ? request.reason.slice(0, 400) : '').catch((err) => console.error('Recording a case failed:', err.message));
      return result;
    },

    'POST /api/cases': async (req) => {
      const user = sessionUser(req);
      const { guildId, userId } = await readJson(req);
      await guard.actorIn(snowflake(guildId, 'server'), user);
      return caseLog.list({ id: String(guildId) }, snowflake(userId, 'user'));
    },

    'POST /api/warn': async (req) => {
      const user = sessionUser(req);
      const { guildId, userId, reason } = await readJson(req);
      const actor = await guard.actorIn(snowflake(guildId, 'server'), user);
      const memberId = snowflake(userId, 'user');
      await guard.requireTarget(actor, memberId);
      const member = await rest.request('GET', `/guilds/${actor.guild.id}/members/${memberId}`).catch(() => null);
      if (!member) throw httpError(400, "They aren't in this server.");
      if (member.user.bot) throw httpError(400, "Bots can't be warned.");
      const text = String(reason || '').trim().slice(0, 400);
      if (!text) throw httpError(400, 'Give a reason for the warning.');
      return warnMember(rest, caseLog, {
        guild: actor.guild,
        roles: actor.roles,
        member: { id: memberId, label: member.nick || member.user.global_name || member.user.username },
        moderator: user,
        reason: text,
      });
    },

    'POST /api/members-all': async (req) => {
      const user = sessionUser(req);
      const { guildId, max } = await readJson(req);
      await guard.actorIn(String(guildId), user);
      return fetchAllMembers(rest, String(guildId), Math.min(Math.max(1, Number(max) || 10000), 10000));
    },

    'POST /api/purge': async (req) => {
      const user = sessionUser(req);
      const { channelId, count, reason } = await readJson(req);
      const actor = await guard.actorIn(await channelGuild(channelId), user);
      guard.requirePermission(actor, guard.P.MANAGE_MESSAGES);
      return purgeMessages(rest, String(channelId), Math.min(Math.max(1, Number(count) || 0), 1000), auditReason(reason, user));
    },

    'POST /api/lock': async (req) => {
      const user = sessionUser(req);
      const { guildId, channelId, locked, reason } = await readJson(req);
      const realGuild = await channelGuild(channelId);
      if (realGuild !== String(guildId)) throw httpError(400, 'That channel is not in this server.');
      const actor = await guard.actorIn(realGuild, user);
      guard.requirePermission(actor, guard.P.MANAGE_CHANNELS);
      return setChannelLock(rest, realGuild, String(channelId), !!locked, auditReason(reason, user));
    },
  };

  async function handle(req, res) {
    const url = new URL(req.url, config.publicUrl);
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/') {
      return sendPage(res, 200, 'Mod portal is running', 'Moderators: open Discord Server Builder, choose "Sign in with Discord" and paste this page\'s address.');
    }

    if (req.method === 'GET' && url.pathname === '/auth/login') {
      try {
        limitIp(ip);
        const target = auth.loginUrl(url.searchParams.get('id'), url.searchParams.get('challenge'));
        res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
        return res.end();
      } catch (err) {
        return sendPage(res, err.status || 400, 'Sign-in failed', err.message);
      }
    }

    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      if (url.searchParams.get('error')) return sendPage(res, 200, 'Sign-in cancelled', 'You can close this tab and try again from the app.');
      try {
        const user = await auth.handleCallback(url.searchParams.get('code'), url.searchParams.get('state'));
        return sendPage(res, 200, `Signed in as ${user.global_name || user.username}`, 'You can close this tab and go back to Discord Server Builder.');
      } catch (err) {
        return sendPage(res, err.status || 500, 'Sign-in failed', err.message);
      }
    }

    if (req.method === 'POST' && url.pathname === '/auth/poll') {
      try {
        limitIp(`poll:${ip}`);
        const { id, verifier } = await readJson(req);
        return sendJson(res, 200, auth.poll(id, verifier));
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }

    // Slash commands, sent by Discord once the bot's Interactions Endpoint URL points here.
    if (req.method === 'POST' && url.pathname === '/interactions' && interactions) {
      try {
        const result = await interactions.receive(await readBody(req, MAX_INTERACTION_BODY), req.headers);
        sendJson(res, result.status, result.body);
        if (result.after) await result.after();
      } catch (err) {
        console.error('POST /interactions:', err);
        if (!res.headersSent) sendJson(res, err.status || 500, { error: 'Something went wrong.' });
      }
      return;
    }

    const route = api[`${req.method} ${url.pathname}`];
    if (!route) return sendJson(res, 404, { error: 'Not found.' });
    try {
      return sendJson(res, 200, await route(req));
    } catch (err) {
      // Discord's own errors carry a status and code; pass them through so the app can explain them.
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(`${req.method} ${url.pathname}:`, err);
      return sendJson(res, status, { error: err.message || 'Something went wrong.', code: err.code ?? null });
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
    });
  });
}

if (require.main === module) {
  const config = loadConfig();
  const rest = new DiscordRest(config.botToken);
  const guard = createGuard(rest);
  const caseLog = createCases(rest, { botId: once(async () => (await rest.request('GET', '/users/@me')).id) });
  const server = createPortal({ config, rest, auth: createAuth(config), guard, caseLog, interactions: createInteractions({ rest, guard, caseLog }) });
  server.listen(config.port, () => console.log(`Mod portal listening on port ${config.port} (${config.publicUrl})`));
}

module.exports = { createPortal };
