// Announcements: messages built in the app (text with an optional ping, a card with images and
// fields, and link buttons), sent now or on a schedule (once, or every day, week or month in the PC's
// local time), and edited in place later. Scheduled ones go out while the app is open or in the tray.
// One missed by less than an hour (the app was closed) is still sent; an older one-off is marked
// missed for you to send, and a repeating one moves on to its next time. No Electron here.

const REPEATS = ['once', 'daily', 'weekly', 'monthly'];
const LATE_LIMIT_MS = 60 * 60 * 1000;
const LIMITS = { content: 2000, name: 80, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, embedTotal: 6000, buttons: 5, label: 80 };
const IMAGE_FILE = /^[\w-]{1,80}\.(png|jpe?g|gif|webp)$/i;

const problem = (message) => Object.assign(new Error(message), { status: 400 });
const isId = (v) => /^\d{15,21}$/.test(String(v || ''));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const url = (v, what) => {
  const s = str(v, 2048);
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw problem(`The ${what} must be a web address starting with https://.`);
  return s;
};

// Checks and tidies an announcement from the app.
function normalize(input, now = Date.now()) {
  const e = input?.embed || {};
  const fields = (Array.isArray(e.fields) ? e.fields : [])
    .map((f) => ({ name: str(f?.name, LIMITS.fieldName), value: str(f?.value, LIMITS.fieldValue), inline: !!f?.inline }))
    .filter((f) => f.name || f.value)
    .slice(0, LIMITS.fields);
  const color = Number(e.color);
  const embed = {
    on: !!e.on,
    title: str(e.title, LIMITS.title),
    url: url(e.url, 'title link'),
    description: str(e.description, LIMITS.description),
    color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : 0x7f8cf0,
    author: { name: str(e.author?.name, LIMITS.author), icon: url(e.author?.icon, 'author picture') },
    image: url(e.image, 'image'),
    imageFile: IMAGE_FILE.test(String(e.imageFile || '')) ? String(e.imageFile) : '',
    thumbnail: url(e.thumbnail, 'thumbnail'),
    footer: str(e.footer, LIMITS.footer),
    timestamp: !!e.timestamp,
    fields,
  };
  const buttons = (Array.isArray(input?.buttons) ? input.buttons : [])
    .map((b) => ({ label: str(b?.label, LIMITS.label), url: url(b?.url, 'button link') }))
    .filter((b) => b.label || b.url)
    .slice(0, LIMITS.buttons);
  if (buttons.some((b) => !b.label || !b.url)) throw problem('Every button needs its text and a link.');
  const ping = ['none', 'everyone', 'here'].includes(input?.ping) || isId(input?.ping) ? String(input.ping) : 'none';
  const content = str(input?.content, LIMITS.content);
  const hasEmbed = embed.on && (embed.title || embed.description || embed.image || embed.imageFile || embed.fields.length || embed.author.name || embed.footer || embed.thumbnail);
  if (!content && !hasEmbed && !embed.imageFile) throw problem('Write a message, or turn on the card and fill it in.');
  const embedLength = embed.title.length + embed.description.length + embed.footer.length + embed.author.name.length + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  if (embed.on && embedLength > LIMITS.embedTotal) throw problem(`A card can hold ${LIMITS.embedTotal.toLocaleString('en-US')} characters in all; this one has ${embedLength.toLocaleString('en-US')}.`);

  const s = input?.schedule || {};
  const schedule = { on: !!s.on, at: Number(s.at) || 0, repeat: REPEATS.includes(s.repeat) ? s.repeat : 'once', nextAt: null };
  if (schedule.on) {
    if (!schedule.at) throw problem('Pick the date and time to send it.');
    if (schedule.at > now) schedule.nextAt = schedule.at;
    else if (schedule.repeat === 'once') throw problem('That time has already passed. Pick a time in the future.');
    else schedule.nextAt = nextRun(schedule, now);
  }
  return {
    id: input?.id ? String(input.id) : null,
    guildId: isId(input?.guildId) ? String(input.guildId) : '',
    guildName: str(input?.guildName, 100),
    channelId: isId(input?.channelId) ? String(input.channelId) : '',
    channelName: str(input?.channelName, 100),
    name: str(input?.name, LIMITS.name) || embed.title.slice(0, LIMITS.name) || content.split('\n')[0].slice(0, LIMITS.name) || 'Announcement',
    ping,
    pingName: str(input?.pingName, 100),
    content,
    embed,
    buttons,
    schedule,
  };
}

// The next time a repeating schedule is due after `after`, counted from its first time so a
// monthly post on the 31st comes back on the 31st (or the month's last day).
function nextRun(schedule, after) {
  const first = new Date(schedule.at);
  if (schedule.repeat === 'once') return schedule.at > after ? schedule.at : null;
  for (let n = 1; n < 100000; n++) {
    const d = new Date(first);
    if (schedule.repeat === 'daily') d.setDate(first.getDate() + n);
    else if (schedule.repeat === 'weekly') d.setDate(first.getDate() + 7 * n);
    else {
      d.setDate(1);
      d.setMonth(first.getMonth() + n);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(first.getDate(), last));
    }
    if (d.getTime() > after) return d.getTime();
  }
  return null;
}

// The message to post. image: { name, data, type } for a picture picked from the PC, else null.
function buildMessage(a, image = null, now = Date.now()) {
  const ping = a.ping === 'everyone' ? '@everyone' : a.ping === 'here' ? '@here' : isId(a.ping) ? `<@&${a.ping}>` : '';
  const content = [ping, a.content].filter(Boolean).join(' ').slice(0, LIMITS.content);
  const allowed = a.ping === 'everyone' || a.ping === 'here' ? { parse: ['everyone'] } : isId(a.ping) ? { parse: [], roles: [a.ping] } : { parse: [] };
  const body = { content, embeds: [], components: [], allowed_mentions: allowed };
  const files = image ? [{ name: image.name, data: image.data, type: image.type }] : undefined;
  const e = a.embed;
  if (e.on) {
    const embed = { color: e.color };
    if (e.title) embed.title = e.title;
    if (e.url && e.title) embed.url = e.url;
    if (e.description) embed.description = e.description;
    if (e.author.name) embed.author = e.author.icon ? { name: e.author.name, icon_url: e.author.icon } : { name: e.author.name };
    if (image) embed.image = { url: `attachment://${image.name}` };
    else if (e.image) embed.image = { url: e.image };
    if (e.thumbnail) embed.thumbnail = { url: e.thumbnail };
    if (e.footer) embed.footer = { text: e.footer };
    if (e.timestamp) embed.timestamp = new Date(now).toISOString();
    if (e.fields.length) embed.fields = e.fields.map((f) => ({ name: f.name || '​', value: f.value || '​', inline: f.inline }));
    body.embeds.push(embed);
  }
  if (a.buttons.length) body.components.push({ type: 1, components: a.buttons.map((b) => ({ type: 2, style: 5, label: b.label, url: b.url })) });
  return { body, files };
}

// Sends what's due. list(): the scheduled announcements; send(a): posts one and resolves to its
// message; update(a, patch): saves what happened.
function createScheduler({ list, send, update, now = Date.now, lateLimitMs = LATE_LIMIT_MS }) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const a of list()) {
        const s = a.schedule;
        if (!s?.on || !s.nextAt || now() < s.nextAt) continue;
        const late = now() - s.nextAt > lateLimitMs;
        if (late && s.repeat === 'once') {
          update(a, { schedule: { ...s, on: false, nextAt: null }, missedAt: s.nextAt, problem: null });
          continue;
        }
        if (late) {
          update(a, { schedule: { ...s, nextAt: nextRun(s, now()) }, missedAt: s.nextAt });
          continue;
        }
        const after = s.repeat === 'once' ? { ...s, on: false, nextAt: null } : { ...s, nextAt: nextRun(s, now()) };
        try {
          const message = await send(a);
          update(a, { schedule: after, lastSentAt: now(), lastMessageId: message.id, lastChannelId: a.channelId, missedAt: null, problem: null });
        } catch (err) {
          update(a, { schedule: after, problem: `Couldn't send it on time: ${err.message}` });
        }
      }
    } finally {
      running = false;
    }
  }
  return { tick };
}

module.exports = { normalize, nextRun, buildMessage, createScheduler, REPEATS, LIMITS, LATE_LIMIT_MS };
