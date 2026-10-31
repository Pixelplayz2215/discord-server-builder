// Minimal Discord REST client (API v10) with per-route rate-limit handling.
const API = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://pixelplayz.org, 1.0.0) DiscordServerBuilder';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FRIENDLY = {
  10003: 'Unknown channel.',
  10004: 'Unknown server.',
  10007: 'Unknown member — they may have left the server.',
  10011: 'Unknown role.',
  10013: 'Unknown user.',
  10026: 'That user is not banned.',
  30005: 'This server has hit the maximum number of roles (250).',
  30013: 'This server has hit the maximum number of channels (500).',
  50001: 'Missing Access — the bot cannot see this.',
  50013: 'Missing Permissions — give the bot Administrator or move its role higher.',
  50024: 'Cannot do that on this channel type.',
  50034: 'Messages older than 14 days cannot be bulk deleted.',
  50074: 'Discord will not delete a channel required for Community servers (rules / updates).',
};

function flattenErrors(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj || {})) {
    if (key === '_errors') out.push(`${prefix || 'body'}: ${value.map((e) => e.message).join(', ')}`);
    else if (value && typeof value === 'object') out.push(...flattenErrors(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

class DiscordError extends Error {
  constructor(status, body) {
    let message;
    if (status === 401) message = 'Invalid bot token (401 Unauthorized).';
    else message = FRIENDLY[body?.code] || body?.message || `Discord returned HTTP ${status}.`;
    if (body?.code === 50035 && body.errors) message = `Invalid request — ${flattenErrors(body.errors).join('; ')}`;
    super(message);
    this.status = status;
    this.code = body?.code ?? 0;
  }
}

class DiscordRest {
  constructor(token) {
    this.token = token;
    this.buckets = new Map();
    this.globalUntil = 0;
  }

  // Rate limits are scoped per route + major parameter, so keep the first ID and collapse the rest.
  routeKey(method, path) {
    let seenMajor = false;
    const route = path.split('?')[0].replace(/\d{15,21}/g, (id) => {
      if (seenMajor) return ':id';
      seenMajor = true;
      return id;
    });
    return `${method} ${route}`;
  }

  // files: [{ name, data: Buffer, type }] sends the body as a multipart form with those files
  // attached (as attachments 0, 1, …), e.g. an image for a message.
  async request(method, path, { body, reason, query, files } = {}) {
    const key = this.routeKey(method, path);
    let url = API + path;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.set(k, String(v));
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = Math.max(this.globalUntil, this.buckets.get(key) || 0) - Date.now();
      if (wait > 0) await sleep(wait);

      const headers = { Authorization: `Bot ${this.token}`, 'User-Agent': USER_AGENT };
      let payload;
      if (files?.length) {
        // fetch sets the multipart Content-Type (with its boundary) itself.
        payload = new FormData();
        payload.append('payload_json', JSON.stringify({ ...body, attachments: files.map((f, id) => ({ id, filename: f.name })) }));
        files.forEach((f, i) => payload.append(`files[${i}]`, new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name));
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason.slice(0, 512));

      let res;
      try {
        res = await fetch(url, { method, headers, body: payload });
      } catch (err) {
        if (attempt < 2) {
          await sleep(1000);
          continue;
        }
        throw new Error(`Network error — ${err.cause?.code || err.message}`);
      }

      const remaining = res.headers.get('x-ratelimit-remaining');
      const resetAfter = parseFloat(res.headers.get('x-ratelimit-reset-after'));
      if (remaining === '0' && resetAfter) this.buckets.set(key, Date.now() + resetAfter * 1000);

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const ms = (data.retry_after ?? 1) * 1000 + 50;
        if (data.global) this.globalUntil = Date.now() + ms;
        else this.buckets.set(key, Date.now() + ms);
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 204) return null;

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { message: text.slice(0, 200) };
      }
      if (!res.ok) throw new DiscordError(res.status, data);
      return data;
    }
    throw new Error('Rate limited repeatedly by Discord — wait a moment and try again.');
  }
}

module.exports = { DiscordRest, DiscordError, sleep };
