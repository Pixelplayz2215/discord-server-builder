// Pixel's Sysbot (optional): keeps a trade bot's basics going while its PC is off. The Sysbot checks in
// here every 30 seconds while it runs, signed with its own bot token. When the check-ins stop (a power cut,
// no internet) the portal posts the bot's offline status report and pings its roles, then connects as that
// bot and answers /status, /bot status, /ping, /help and /echo announce; every other command says the
// trade bot is offline. When the Sysbot closes normally it says goodbye: it posts its own report and the
// portal only answers commands. The moment the Sysbot is back it takes over again.
// Needs SYSBOT_BOT_TOKEN, the Sysbot's own bot token (not this portal's). Without it none of this runs.
const crypto = require('crypto');
const { DiscordRest } = require('../src/main/discord');
const { PresenceConnection } = require('../src/main/gateway');

const GRACE_MS = 3 * 60 * 1000; // silent this long (without saying goodbye) means its PC is off
const WATCH_MS = 15 * 1000;
const ANSWER_DELAY_MS = 10 * 1000; // after a goodbye, the Sysbot's own connection closes first
const PING_MS = 10 * 60 * 1000; // while answering, so Render's free plan doesn't put the portal to sleep
const OWNERS_MS = 10 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY = 512 * 1024; // a check-in can carry the STOP picture
const MAX_PICTURE = 256 * 1024;
const PICTURE = 'status.png';
const EPHEMERAL = 64;
const RED = 0xe74c3c;
const P = { ADMINISTRATOR: 1n << 3n, MANAGE_GUILD: 1n << 5n };
const ANSWERED = ['/status', '/bot status', '/ping', '/help', '/echo announce'];

/* ---------- Signed check-ins ---------- */
const keyFor = (token) => crypto.createHmac('sha256', String(token)).update('sysbot-portal').digest();
const signature = (token, body, time) => crypto.createHmac('sha256', keyFor(token)).update(`${time}.${body}`).digest('hex');

// Headers for a check-in; body is the exact string sent. The Sysbot signs the same way (StatusPortal.cs).
function signedHeaders(token, body, now = Date.now()) {
  return { 'Content-Type': 'application/json', 'X-Sysbot-Time': String(now), 'X-Sysbot-Signature': signature(token, body, now) };
}

function checkSigned(token, body, headers, now = Date.now()) {
  const time = Number(headers['x-sysbot-time']);
  const given = String(headers['x-sysbot-signature'] || '');
  if (!Number.isFinite(time) || Math.abs(now - time) > MAX_SKEW_MS || !/^[0-9a-f]{64}$/.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(signature(token, body, time), 'hex'));
}

/* ---------- What a check-in says ---------- */
const ids = (list, max = 25) => (Array.isArray(list) ? list.map(String).filter((id) => /^\d{15,21}$/.test(id)).slice(0, max) : []);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function readCheckin(body) {
  const report = body.report || {};
  const messages = {};
  for (const [channel, message] of Object.entries(report.messages || {})) if (/^\d{15,21}$/.test(channel) && /^\d{15,21}$/.test(String(message))) messages[channel] = String(message);
  const announce = body.announce || {};
  const status = body.channelStatus || {};
  return {
    event: ['checkin', 'claim', 'goodbye'].includes(body.event) ? body.event : 'checkin',
    online: body.online === true,
    botName: text(body.botName, 80) || 'The bot',
    report: { channels: ids(report.channels), roles: ids(report.roles), messages },
    announce: {
      channels: ids(announce.channels),
      colors: (Array.isArray(announce.colors) ? announce.colors : []).map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, 20),
      thumbnails: (Array.isArray(announce.thumbnails) ? announce.thumbnails : []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).map((u) => u.slice(0, 500)).slice(0, 20),
    },
    channelStatus: status.on === true ? { channels: ids(status.channels), online: text(status.online, 16), offline: text(status.offline, 16) } : null,
    picture: typeof body.picture === 'string' && body.picture ? Buffer.from(body.picture, 'base64') : null,
    offlineSeen: Number(body.offlineSeen) || 0,
  };
}

// rest: the Sysbot's bot (not the portal's). connect(onState, onEvent): its gateway connection (tests pass a fake).
function createSysbot({ token, publicUrl = '', rest = new DiscordRest(token), connect = (onState, onEvent) => new PresenceConnection(token, onState, onEvent), fetchImpl = fetch, now = Date.now, graceMs = GRACE_MS, watchMs = WATCH_MS, answerDelayMs = ANSWER_DELAY_MS, log = console }) {
  let last = null; // the latest check-in, with .at
  let picture = null;
  let closed = false; // it said goodbye
  let offline = null; // { at, messages }: the offline report the portal posted, until the Sysbot has seen it
  let posting = null;
  let conn = null;
  let gateway = 'off';
  let answerTimer = null;
  let pingTimer = null;
  let watchTimer = null;
  let owners = null;

  const away = () => !!last && (closed || now() - last.at > graceMs);
  const seconds = (ms) => Math.floor(ms / 1000);

  /* ---------- Answering as the bot ---------- */
  function answer() {
    if (conn || !away()) return;
    conn = connect(
      (state, detail) => {
        gateway = state;
        if (state === 'error') log.error(`Sysbot: its bot couldn't connect: ${detail}`);
      },
      (type, data) => {
        if (type === 'INTERACTION_CREATE') respond(data).catch((err) => log.error('Sysbot: answering a command failed:', err.message));
      },
    );
    conn.start({ status: 'dnd', text: 'Trade bot offline' });
    if (publicUrl && !pingTimer) pingTimer = setInterval(() => fetchImpl(`${publicUrl}/health`).catch(() => {}), PING_MS);
    log.log(`Sysbot: answering for ${last.botName} while its PC is ${closed ? 'closed' : 'offline'}.`);
  }

  function release() {
    clearTimeout(answerTimer);
    answerTimer = null;
    clearInterval(pingTimer);
    pingTimer = null;
    if (!conn) return;
    conn.stop();
    conn = null;
    gateway = 'off';
    log.log(`Sysbot: ${last?.botName || 'its bot'} is back; it answers for itself again.`);
  }

  const reply = (interaction, data) => rest.request('POST', `/interactions/${interaction.id}/${interaction.token}/callback`, { body: { type: 4, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...data } } });

  async function ownerIds() {
    if (!owners || now() - owners.at > OWNERS_MS) {
      const app = await rest.request('GET', '/applications/@me');
      // For a team's bot, Discord's "owner" is a placeholder account: the team's owner and its admins count instead.
      const list = app.team ? [app.team.owner_user_id, ...(app.team.members || []).filter((m) => m.role === 'admin' && m.membership_state === 2).map((m) => m.user.id)] : [app.owner?.id];
      owners = { at: now(), ids: new Set(list.filter(Boolean).map(String)) };
    }
    return owners.ids;
  }

  const userOf = (interaction) => interaction.member?.user || interaction.user || {};
  const canManage = (interaction) => (BigInt(interaction.member?.permissions || 0) & (P.ADMINISTRATOR | P.MANAGE_GUILD)) !== 0n;

  function statusEmbed() {
    const since = `<t:${seconds(last.at)}:R>`;
    return {
      title: `${last.botName} is offline`,
      description: closed
        ? `The trade bot was closed ${since}. You'll see a GO status report when it's back.`
        : `The trade bot's PC stopped checking in ${since}, so trades can't run right now. You'll see a GO status report when it's back.`,
      color: RED,
      footer: { text: 'Answered by its 24/7 portal' },
    };
  }

  async function announce(interaction, message) {
    const look = last.announce;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const embed = {
      title: 'Important Announcement!',
      description: `## ${message}\n\n**Sent: <t:${seconds(now())}:F>**`,
      color: look.colors.length ? pick(look.colors) : 0x9b59b6,
      ...(look.thumbnails.length ? { thumbnail: { url: pick(look.thumbnails) } } : {}),
    };
    let sent = 0;
    for (const channel of look.channels) {
      try {
        await rest.request('POST', `/channels/${channel}/messages`, { body: { embeds: [embed], allowed_mentions: { parse: [] } } });
        sent++;
      } catch (err) {
        log.error(`Sysbot: the announcement couldn't go to channel ${channel}: ${err.message}`);
      }
    }
    const content = !look.channels.length ? 'No announcement channels are set up.' : sent ? `📣 Announcement sent to ${sent} channel${sent === 1 ? '' : 's'}.` : "📣 The announcement couldn't be posted in any announcement channel.";
    await rest.request('PATCH', `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { body: { content } });
  }

  async function respond(interaction) {
    if (interaction.type === 4) return rest.request('POST', `/interactions/${interaction.id}/${interaction.token}/callback`, { body: { type: 8, data: { choices: [] } } });
    const name = interaction.type === 2 ? interaction.data?.name : null;
    const sub = interaction.data?.options?.[0]?.type === 1 ? interaction.data.options[0] : null;
    const command = sub ? `/${name} ${sub.name}` : `/${name}`;
    const offlineNote = `⏸️ ${last.botName}'s trade bot is offline right now${name ? `, so ${command} can't run` : ''}. You'll see a GO status report when it's back.`;

    if (command === '/ping') return reply(interaction, { content: `🏓 Pong! ${last.botName}'s trade bot is offline, so its 24/7 portal is answering.` });
    if (command === '/status') return reply(interaction, { embeds: [statusEmbed()] });
    if (command === '/bot status') {
      if (!canManage(interaction) && !(await ownerIds()).has(String(userOf(interaction).id))) return reply(interaction, { content: 'You need Manage Server for this.' });
      return reply(interaction, { embeds: [statusEmbed()] });
    }
    if (command === '/help') {
      return reply(interaction, { content: `${last.botName}'s trade bot is offline right now. Until it's back, these still work: ${ANSWERED.map((c) => `\`${c}\``).join(', ')} (owner only).` });
    }
    if (command === '/echo announce') {
      if (!(await ownerIds()).has(String(userOf(interaction).id))) return reply(interaction, { content: "Only the bot's owner can use this command." });
      const message = text(sub.options?.find((o) => o.name === 'message')?.value, 1800);
      if (!message) return reply(interaction, { content: 'Type what to announce.' });
      await rest.request('POST', `/interactions/${interaction.id}/${interaction.token}/callback`, { body: { type: 5, data: { flags: EPHEMERAL } } });
      return announce(interaction, message);
    }
    return reply(interaction, { content: offlineNote });
  }

  /* ---------- The offline report ---------- */
  async function postOffline() {
    const posted = { at: now(), messages: {} };
    const report = last.report;
    const ping = report.roles.map((id) => `<@&${id}>`).join(' ');
    const embed = {
      title: 'Bot Status Report',
      description: `**Status**: ${last.botName} is Offline!`,
      color: RED,
      timestamp: new Date(now()).toISOString(),
      footer: { text: "Its PC stopped checking in, so the 24/7 portal posted this" },
      ...(picture ? { thumbnail: { url: `attachment://${PICTURE}` } } : {}),
    };
    for (const channel of report.channels) {
      const previous = report.messages[channel];
      if (previous) await rest.request('DELETE', `/channels/${channel}/messages/${previous}`).catch(() => {});
      try {
        const body = { content: ping || undefined, embeds: [embed], allowed_mentions: { parse: [], roles: report.roles } };
        const message = await rest.request('POST', `/channels/${channel}/messages`, picture ? { body, files: [{ name: PICTURE, data: picture, type: 'image/png' }] } : { body });
        posted.messages[channel] = message.id;
      } catch (err) {
        log.error(`Sysbot: the offline report couldn't go to channel ${channel}: ${err.message}`);
      }
    }
    offline = posted;
    log.log(`Sysbot: ${last.botName}'s PC stopped checking in; posted its offline report in ${Object.keys(posted.messages).length} channel(s).`);
    // Not waited for: Discord allows two renames per channel every 10 minutes, and a check-in waits for the report.
    markChannels().catch((err) => log.error('Sysbot: marking channels offline failed:', err.message));
  }

  // Like the Sysbot does: its trade channels get the offline emoji at the front of their names.
  async function markChannels() {
    const status = last.channelStatus;
    if (!status?.offline) return;
    for (const id of status.channels) {
      try {
        const channel = await rest.request('GET', `/channels/${id}`);
        let name = channel.name;
        for (const emoji of [status.online, status.offline]) if (emoji && name.startsWith(emoji)) name = name.slice(emoji.length).trim();
        if (`${status.offline}${name}` !== channel.name) await rest.request('PATCH', `/channels/${id}`, { body: { name: `${status.offline}${name}` } });
      } catch (err) {
        log.error(`Sysbot: couldn't mark channel ${id} offline: ${err.message}`);
      }
    }
  }

  function watch() {
    if (!last || closed || now() - last.at <= graceMs) return;
    if (last.online && !offline && !posting) {
      posting = postOffline()
        .catch((err) => log.error('Sysbot: posting the offline report failed:', err.message))
        .finally(() => (posting = null));
    }
    answer();
  }

  /* ---------- Check-ins ---------- */
  async function receive(raw, headers) {
    const body = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (!checkSigned(token, body, headers, now())) return { status: 401, body: { error: "That check-in wasn't signed with this portal's SYSBOT_BOT_TOKEN." } };
    let checkin;
    try {
      checkin = readCheckin(JSON.parse(body));
    } catch {
      return { status: 400, body: { error: 'Invalid JSON.' } };
    }
    if (checkin.picture && checkin.picture.length <= MAX_PICTURE) picture = checkin.picture;
    if (offline && checkin.offlineSeen === offline.at) offline = null;
    last = { ...checkin, picture: undefined, at: now() };
    if (checkin.event === 'goodbye') {
      closed = true;
      clearTimeout(answerTimer);
      answerTimer = setTimeout(answer, answerDelayMs);
    } else {
      closed = false;
      release();
      if (posting) await posting; // so the Sysbot hears about a report that was just being posted
    }
    return { status: 200, body: { ok: true, hasPicture: !!picture, offlinePosted: offline } };
  }

  function start() {
    if (!watchTimer) watchTimer = setInterval(watch, watchMs);
  }

  function close() {
    clearInterval(watchTimer);
    watchTimer = null;
    release();
  }

  const status = () => ({ checkedInAt: last?.at ?? null, closed, answering: !!conn, gateway, offlinePosted: offline });

  return { receive, start, close, status, watch, MAX_BODY };
}

module.exports = { createSysbot, signedHeaders, checkSigned, GRACE_MS };
