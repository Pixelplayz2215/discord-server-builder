// Tickets: a panel message with an "open a ticket" button. Pressing it gives the member a private
// channel that only they, your support roles (and admins) and the bot can see. A message there tells
// them what to write, with a Claim button for staff and a Close button. Closing saves the whole
// conversation, images included, as a transcript in your ticket log channel, then deletes the channel.
//
// The buttons are answered by the mod portal when the bot's interactions go there, otherwise by the
// app over its gateway connection. So the portal can read them, each panel's settings live in
// Discord: a JSON file on a message in the log channel, named by the buttons' custom IDs
// (tk:<action>:<log channel>:<settings message>). A ticket channel's topic says whose it is and who
// claimed it. No Electron here.
const crypto = require('crypto');

const SETTINGS_FILE = 'ticket-settings.json';
const STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 };
const ACTIONS = ['open', 'claim', 'close', 'closeask', 'closing'];
const P = { ADMINISTRATOR: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, ADD_REACTIONS: 1n << 6n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n };
const MEMBER_ALLOW = P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY | P.ADD_REACTIONS;
// Discord refuses to grant what the bot doesn't hold itself, so it only asks for what members get.
// Deleting the ticket later uses its server-wide Manage Channels.
const BOT_ALLOW = MEMBER_ALLOW;
const LOG_READ = P.VIEW | P.HISTORY;
const CACHE_MS = 60000;
const CLOSE_DELAY_MS = 5000;
const MAX_TRANSCRIPT_MESSAGES = 3000;
// Images are copied into the transcript, since Discord's attachment links stop working after a day.
// Kept under Discord's 10 MB upload limit (the copies grow by a third when written into the page).
const IMAGE_BUDGET = 6 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

const DEFAULTS = {
  panel: {
    channelId: '',
    channelName: '',
    style: 'embed',
    title: 'Need help?',
    text: 'Press the button below to open a support ticket. Only you and our staff can see it.',
    color: 0x7f8cf0,
    button: { label: 'Open a ticket', emoji: { name: '🎫' }, style: 'primary' },
  },
  ticket: {
    title: 'Thanks for reaching out, {user}!',
    text: 'Write a short description of your issue below, and add screenshots if they help. A moderator or the owner will be with you soon.',
    color: 0x0bbfbc,
  },
  categoryId: '',
  categoryName: '',
  logChannelId: '',
  logChannelName: '',
  supportRoles: [],
  pingSupport: true,
  namePrefix: 'ticket',
  userCanClose: true,
  askReason: true,
};
const LIMITS = { title: 256, panelText: 2000, ticketText: 1500, label: 80, prefix: 20 };

const problem = (message) => Object.assign(new Error(message), { status: 400 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isId = (v) => /^\d{15,21}$/.test(String(v || ''));
const str = (v, max, fallback) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const colorOf = (v, fallback) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 0xffffff ? Number(v) : fallback);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const nameOf = (u) => u?.global_name || u?.username || 'someone';

/* ---------- Settings ---------- */

function cleanEmoji(e) {
  if (!e || (!e.id && !e.name)) return null;
  if (e.id) return isId(e.id) ? { id: String(e.id), name: String(e.name || 'emoji').replace(/[^\w]/g, '').slice(0, 32) || 'emoji', animated: !!e.animated } : null;
  return { name: String(e.name).trim().slice(0, 32) };
}

// Checks and tidies a panel's settings from the app.
function normalizeSettings(input) {
  const d = DEFAULTS;
  const p = input?.panel || {};
  const t = input?.ticket || {};
  const roles = [...new Set((Array.isArray(input?.supportRoles) ? input.supportRoles : []).map(String).filter(isId))].slice(0, 25);
  const label = str(p.button?.label, LIMITS.label, d.panel.button.label).trim();
  return {
    id: input?.id ? String(input.id) : null,
    guildId: isId(input?.guildId) ? String(input.guildId) : '',
    guildName: str(input?.guildName, 100, ''),
    panel: {
      channelId: isId(p.channelId) ? String(p.channelId) : '',
      channelName: str(p.channelName, 100, ''),
      style: p.style === 'text' ? 'text' : 'embed',
      title: str(p.title, LIMITS.title, d.panel.title).trim(),
      text: str(p.text, LIMITS.panelText, d.panel.text).trim(),
      color: colorOf(p.color, d.panel.color),
      button: { label: label || d.panel.button.label, emoji: p.button && 'emoji' in p.button ? cleanEmoji(p.button.emoji) : d.panel.button.emoji, style: STYLES[p.button?.style] ? p.button.style : 'primary' },
    },
    ticket: { title: str(t.title, LIMITS.title, d.ticket.title).trim(), text: str(t.text, LIMITS.ticketText, d.ticket.text).trim(), color: colorOf(t.color, d.ticket.color) },
    categoryId: isId(input?.categoryId) ? String(input.categoryId) : '',
    categoryName: str(input?.categoryName, 100, ''),
    logChannelId: isId(input?.logChannelId) ? String(input.logChannelId) : '',
    logChannelName: str(input?.logChannelName, 100, ''),
    supportRoles: roles,
    pingSupport: input?.pingSupport !== false,
    namePrefix: slug(str(input?.namePrefix, LIMITS.prefix, d.namePrefix)) || d.namePrefix,
    userCanClose: input?.userCanClose !== false,
    askReason: input?.askReason !== false,
  };
}

// What the buttons need, kept in the log channel for the portal to read.
function settingsFile(s) {
  const { guildId, categoryId, logChannelId, supportRoles, pingSupport, namePrefix, userCanClose, askReason, ticket } = s;
  return Buffer.from(JSON.stringify({ v: 1, guildId, categoryId, logChannelId, supportRoles, pingSupport, namePrefix, userCanClose, askReason, ticket }, null, 2));
}

const settingsNote = (s) => `⚙️ **Ticket settings** for the panel in <#${s.panel.channelId}>. The bot reads them when someone opens, claims or closes a ticket. Change them in Discord Server Builder, and keep this message.`;

/* ---------- Messages ---------- */

const customId = (action, ref) => `tk:${action}:${ref.logChannelId}:${ref.settingsId}`;
function parseCustomId(id) {
  const m = String(id || '').match(/^tk:([a-z]+):(\d{15,21}):(\d{15,21})$/);
  return m && ACTIONS.includes(m[1]) ? { action: m[1], logChannelId: m[2], settingsId: m[3] } : null;
}

const fill = (text, vars) => String(text || '').replace(/\{(user|mention|server)\}/g, (_, k) => vars[k] ?? '');

// The panel members press to open a ticket.
function panelMessage(s, ref) {
  const b = s.panel.button;
  const button = { type: 2, style: STYLES[b.style], label: b.label, custom_id: customId('open', ref) };
  if (b.emoji) button.emoji = b.emoji;
  const components = [{ type: 1, components: [button] }];
  if (s.panel.style === 'text') return { content: [s.panel.title ? `**${s.panel.title}**` : '', s.panel.text].filter(Boolean).join('\n').slice(0, 2000) || '​', embeds: [], components, allowed_mentions: { parse: [] } };
  const embed = { color: s.panel.color, description: s.panel.text || 'Press the button below to open a ticket.' };
  if (s.panel.title) embed.title = s.panel.title;
  return { content: '', embeds: [embed], components, allowed_mentions: { parse: [] } };
}

function ticketButtons(s, ref, claimedBy = null) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: claimedBy ? 2 : 3, label: claimedBy ? `Claimed by ${claimedBy.slice(0, 60)}` : 'Claim', emoji: { name: '🙋' }, custom_id: customId('claim', ref), disabled: !!claimedBy },
        { type: 2, style: 4, label: 'Close', emoji: { name: '🔒' }, custom_id: customId(s.askReason ? 'closeask' : 'close', ref) },
      ],
    },
  ];
}

// The first message in a ticket: who opened it, what to write, and the buttons.
function ticketMessage(s, user, serverName, ref) {
  const vars = { user: nameOf(user), mention: `<@${user.id}>`, server: serverName || 'the server' };
  const ping = s.pingSupport ? s.supportRoles : [];
  return {
    content: [`<@${user.id}>`, ...ping.map((r) => `<@&${r}>`)].join(' '),
    embeds: [{ color: s.ticket.color, title: fill(s.ticket.title, vars).slice(0, 256) || undefined, description: fill(s.ticket.text, vars).slice(0, 4096) || 'Tell us what you need help with.', fields: [{ name: 'Opened by', value: `<@${user.id}>`, inline: true }], timestamp: new Date().toISOString() }],
    components: ticketButtons(s, ref),
    allowed_mentions: { users: [user.id], roles: ping },
  };
}

// The ticket message once someone claimed it: their name on the button, and a field for it.
function claimedMessage(message, s, ref, staff) {
  const [embed = {}] = message?.embeds || [];
  const fields = (embed.fields || []).filter((f) => f.name !== 'Claimed by');
  return { embeds: [{ ...embed, fields: [...fields, { name: 'Claimed by', value: `<@${staff.id}>`, inline: true }] }], components: ticketButtons(s, ref, nameOf(staff)) };
}

const topicFor = (userId, claimedBy) => `🎫 Ticket for <@${userId}>${claimedBy ? ` · claimed by <@${claimedBy}>` : ''}. Close it with the button in the first message.`;
function parseTopic(topic) {
  const m = String(topic || '').match(/^🎫 Ticket for <@(\d{15,21})>(?: · claimed by <@(\d{15,21})>)?/);
  return m ? { userId: m[1], claimedBy: m[2] || null } : null;
}

// Staff: admins, anyone who can manage channels, and the support roles.
function isStaff(member, s) {
  const perms = BigInt(member?.permissions || 0);
  return (perms & (P.ADMINISTRATOR | P.MANAGE_CHANNELS)) !== 0n || (member?.roles || []).some((r) => s.supportRoles.includes(r));
}

/* ---------- Transcripts ---------- */

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const avatarUrl = (u) => (u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${u?.id ? Number((BigInt(u.id) >> 22n) % 6n) : 0}.png`);
const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

// Discord's markdown, enough to read a conversation: code, bold, italics, underline, strikethrough,
// mentions, custom emojis and links. Everything is escaped first, so nothing in a message can run.
function markdown(text, names) {
  const blocks = [];
  let s = escapeHtml(text);
  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${code.replace(/\n$/, '')}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    blocks.push(`<code>${code}</code>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/&lt;@!?(\d{15,21})&gt;/g, (_, id) => `<span class="mention">@${escapeHtml(names.users[id] || 'unknown user')}</span>`)
    .replace(/&lt;@&amp;(\d{15,21})&gt;/g, (_, id) => `<span class="mention">@${escapeHtml(names.roles[id] || 'unknown role')}</span>`)
    .replace(/&lt;#(\d{15,21})&gt;/g, (_, id) => `<span class="mention">#${escapeHtml(names.channels[id] || 'unknown channel')}</span>`)
    .replace(/&lt;(a?):(\w{2,32}):(\d{15,21})&gt;/g, (_, a, name, id) => `<img class="emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'png'}?size=48">`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre, url) => `${pre}<a href="${url}" rel="noreferrer noopener" target="_blank">${url}</a>`)
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

const TRANSCRIPT_CSS = `*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.4 "gg sans","Segoe UI",system-ui,sans-serif}
header{padding:24px 28px;background:#2b2d31;border-bottom:1px solid #1f2023}h1{margin:0 0 4px;font-size:20px;color:#f2f3f5}.sub{color:#b5bac1;font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:14px;font-size:13px}.meta b{display:block;color:#949ba4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.reason{margin-top:12px;padding:10px 12px;border-left:4px solid #fc354c;background:#232428;border-radius:4px}
main{padding:12px 0 32px}.group{display:flex;gap:14px;padding:8px 28px 2px}.group:hover{background:#2e3035}.avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0}
.who{display:flex;align-items:baseline;gap:8px}.name{font-weight:600;color:#f2f3f5}.bot{background:#5865f2;color:#fff;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px}.time{color:#949ba4;font-size:12px}
.msg{margin:2px 0;overflow-wrap:anywhere}.msg pre{background:#2b2d31;border:1px solid #1f2023;border-radius:4px;padding:8px;white-space:pre-wrap;font:13px Consolas,monospace}
code{background:#2b2d31;border-radius:3px;padding:1px 4px;font:13px Consolas,monospace}.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 2px}
.spoiler{background:#1e1f22;color:#1e1f22;border-radius:3px}.spoiler:hover{color:inherit}a{color:#00a8fc}.emoji{width:22px;height:22px;vertical-align:-5px}
.image{display:block;max-width:min(420px,100%);max-height:360px;border-radius:8px;margin-top:4px}.file{display:inline-block;margin-top:4px;padding:8px 12px;background:#2b2d31;border:1px solid #1f2023;border-radius:8px;font-size:13px}
.embed{margin-top:4px;max-width:520px;padding:8px 12px;background:#2b2d31;border-left:4px solid #4e5058;border-radius:4px}.embed .t{font-weight:600;color:#f2f3f5}.embed .f{margin-top:6px}.embed .f b{display:block;font-size:13px;color:#f2f3f5}
.note{color:#949ba4;font-size:12px;font-style:italic}footer{padding:16px 28px;color:#949ba4;font-size:12px;border-top:1px solid #1f2023}`;

// The transcript page. messages are oldest first; images maps an attachment URL to its copy (a data URL).
function buildTranscript({ guildName, channelName, messages, images = new Map(), names = { users: {}, roles: {}, channels: {} }, meta = {} }) {
  const parts = [];
  let last = null;
  for (const m of messages) {
    const author = m.author || {};
    names.users[author.id] ??= nameOf(author);
    for (const u of m.mentions || []) names.users[u.id] ??= nameOf(u);
  }
  for (const m of messages) {
    const author = m.author || {};
    const at = Date.parse(m.timestamp);
    // Messages from the same person within 7 minutes share one header, like in Discord.
    const sameGroup = last && last.author === author.id && at - last.at < 7 * 60000;
    if (!sameGroup) {
      if (last) parts.push('</div></div>');
      parts.push(`<div class="group"><img class="avatar" alt="" src="${avatarUrl(author)}"><div style="min-width:0;flex:1"><div class="who"><span class="name">${escapeHtml(nameOf(author))}</span>${author.bot ? '<span class="bot">APP</span>' : ''}<span class="time">${escapeHtml(when(m.timestamp))}</span></div>`);
    }
    last = { author: author.id, at };
    const body = [];
    if (m.content) body.push(`<div class="msg">${markdown(m.content, names)}</div>`);
    for (const a of m.attachments || []) {
      const isImage = /^image\//.test(a.content_type || '') || IMAGE_FILE.test(a.filename || '');
      const copy = images.get(a.url);
      if (isImage && copy) body.push(`<img class="image" alt="${escapeHtml(a.filename)}" src="${copy}">`);
      else if (isImage) body.push(`<div class="file">🖼️ ${escapeHtml(a.filename)} (${bytes(a.size || 0)}) <span class="note">too large to keep in the transcript</span></div>`);
      else body.push(`<div class="file">📎 ${escapeHtml(a.filename)} (${bytes(a.size || 0)})</div>`);
    }
    for (const e of m.embeds || []) {
      if (!e.title && !e.description && !(e.fields || []).length) continue;
      const color = Number.isInteger(e.color) ? `#${e.color.toString(16).padStart(6, '0')}` : '#4e5058';
      const fields = (e.fields || []).map((f) => `<div class="f"><b>${markdown(f.name, names)}</b>${markdown(f.value, names)}</div>`).join('');
      body.push(`<div class="embed" style="border-left-color:${color}">${e.title ? `<div class="t">${markdown(e.title, names)}</div>` : ''}${e.description ? `<div>${markdown(e.description, names)}</div>` : ''}${fields}</div>`);
    }
    if (!body.length && m.sticker_items?.length) body.push(`<div class="note">Sticker: ${escapeHtml(m.sticker_items.map((s) => s.name).join(', '))}</div>`);
    parts.push(body.join(''));
  }
  if (last) parts.push('</div></div>');

  const person = (id) => (id ? `@${escapeHtml(names.users[id] || id)}` : 'Nobody');
  const metaRows = [
    ['Opened by', person(meta.openerId)],
    ['Claimed by', person(meta.claimedBy)],
    ['Closed by', person(meta.closedBy)],
    ['Opened', escapeHtml(when(meta.openedAt))],
    ['Closed', escapeHtml(when(meta.closedAt))],
    ['Messages', String(messages.length)],
  ]
    .map(([label, value]) => `<div><b>${label}</b>${value}</div>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#${escapeHtml(channelName)} · ${escapeHtml(guildName)}</title><style>${TRANSCRIPT_CSS}</style></head>
<body><header><h1>#${escapeHtml(channelName)}</h1><div class="sub">Ticket transcript · ${escapeHtml(guildName)}</div><div class="meta">${metaRows}</div>${meta.reason ? `<div class="reason"><b>Reason for closing:</b> ${markdown(meta.reason, names)}</div>` : ''}</header>
<main>${parts.join('') || '<p class="note" style="padding:0 28px">No messages.</p>'}</main><footer>Saved by Discord Server Builder</footer></body></html>`;
}

// A link to a transcript on the mod portal, signed so only links the bot made work.
const transcriptSignature = (secret, channelId, messageId) => crypto.createHmac('sha256', secret).update(`transcript:${channelId}:${messageId}`).digest('base64url').slice(0, 32);
function checkTranscriptSignature(secret, channelId, messageId, signature) {
  const expected = Buffer.from(transcriptSignature(secret, channelId, messageId));
  const given = Buffer.from(String(signature || ''));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* ---------- Answering the buttons ---------- */

// rest: the bot's Discord client. botId: its user ID (or a function resolving to it).
// transcriptLink(logChannelId, messageId): a web link to a saved transcript, or null.
// interaction(i) returns null for interactions that aren't tickets, else { response, after }:
// the reply for Discord (sent within 3 seconds) and the work to do after it.
function createTickets({ rest, botId, fetchImpl = fetch, transcriptLink = () => null, closeDelayMs = CLOSE_DELAY_MS }) {
  const cache = new Map(); // `${log}:${settings}` -> { settings, expires }
  const myId = async () => (typeof botId === 'function' ? botId() : botId);

  async function settingsFor(ref) {
    const key = `${ref.logChannelId}:${ref.settingsId}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.settings;
    let message;
    try {
      message = await rest.request('GET', `/channels/${ref.logChannelId}/messages/${ref.settingsId}`);
    } catch (err) {
      if (err.code === 10008 || err.code === 10003 || err.status === 404) throw problem("This ticket panel's settings are gone (the log channel or its settings message was deleted). Ask an admin to save the panel again in Discord Server Builder.");
      throw err;
    }
    const file = (message.attachments || []).find((a) => a.filename === SETTINGS_FILE);
    if (!file) throw problem("This ticket panel's settings are missing. Ask an admin to save the panel again in Discord Server Builder.");
    const res = await fetchImpl(file.url);
    if (!res.ok) throw new Error(`Couldn't read the ticket settings (HTTP ${res.status}).`);
    const settings = normalizeSettings({ ...(await res.json()), logChannelId: ref.logChannelId });
    cache.set(key, { settings, expires: Date.now() + CACHE_MS });
    return settings;
  }

  const hook = (i) => `/webhooks/${i.application_id}/${i.token}`;
  const editOriginal = (i, body) => rest.request('PATCH', `${hook(i)}/messages/@original`, { body: { allowed_mentions: { parse: [] }, ...body } });
  const whisper = (i, content) => rest.request('POST', hook(i), { body: { content, flags: 64, allowed_mentions: { parse: [] } } });
  const explain = (err) =>
    err.code === 50013 || err.code === 50001
      ? 'The bot is missing permissions for tickets. It needs Manage Channels, Manage Roles, View Channel, Send Messages, Attach Files and Read Message History.'
      : err.message || 'Something went wrong.';

  async function openTicket(i, ref) {
    const s = await settingsFor(ref);
    const user = i.member.user;
    const channels = await rest.request('GET', `/guilds/${i.guild_id}/channels`);
    const existing = channels.find((c) => parseTopic(c.topic)?.userId === user.id);
    if (existing) return `You already have a ticket open: <#${existing.id}>`;
    const me = await myId();
    const overwrite = (id, type, allow, deny = 0n) => ({ id, type, allow: String(allow), deny: String(deny) });
    const body = {
      name: `${s.namePrefix}-${slug(user.username) || user.id}`.slice(0, 100),
      type: 0,
      topic: topicFor(user.id),
      permission_overwrites: [overwrite(i.guild_id, 0, 0n, P.VIEW), overwrite(user.id, 1, MEMBER_ALLOW), ...s.supportRoles.map((r) => overwrite(r, 0, MEMBER_ALLOW)), overwrite(me, 1, BOT_ALLOW)],
    };
    if (s.categoryId && channels.some((c) => c.id === s.categoryId && c.type === 4)) body.parent_id = s.categoryId;
    const channel = await rest.request('POST', `/guilds/${i.guild_id}/channels`, { body, reason: `Ticket opened by ${nameOf(user)} (${user.id})` });
    const guild = await rest.request('GET', `/guilds/${i.guild_id}`).catch(() => null);
    await rest.request('POST', `/channels/${channel.id}/messages`, { body: ticketMessage(s, user, guild?.name, ref) });
    return `🎫 Your ticket is open: <#${channel.id}>`;
  }

  async function claimTicket(i, ref) {
    const s = await settingsFor(ref);
    if (!isStaff(i.member, s)) return whisper(i, 'Only staff can claim tickets.');
    const channel = await rest.request('GET', `/channels/${i.channel_id}`);
    const info = parseTopic(channel.topic);
    if (!info) return whisper(i, "This channel isn't a ticket any more.");
    if (info.claimedBy) return whisper(i, info.claimedBy === i.member.user.id ? 'You already claimed this ticket.' : `<@${info.claimedBy}> already claimed this ticket.`);
    const staff = i.member.user;
    await editOriginal(i, claimedMessage(i.message, s, ref, staff));
    await rest.request('PATCH', `/channels/${channel.id}`, { body: { topic: topicFor(info.userId, staff.id) }, reason: `Ticket claimed by ${nameOf(staff)}` }).catch(() => {});
    await rest.request('POST', `/channels/${channel.id}/messages`, { body: { content: `🙋 <@${staff.id}> claimed this ticket and will help you from here.`, allowed_mentions: { parse: [] } } });
  }

  // Every message in the channel, oldest first.
  async function allMessages(channelId) {
    const out = [];
    let before;
    while (out.length < MAX_TRANSCRIPT_MESSAGES) {
      const batch = await rest.request('GET', `/channels/${channelId}/messages`, { query: { limit: 100, before } });
      out.push(...batch);
      if (batch.length < 100) break;
      before = batch[batch.length - 1].id;
    }
    return out.reverse();
  }

  // Copies of the images members sent, while their links still work.
  async function copyImages(messages) {
    const images = new Map();
    let used = 0;
    for (const m of messages) {
      for (const a of m.attachments || []) {
        const isImage = /^image\//.test(a.content_type || '') || IMAGE_FILE.test(a.filename || '');
        if (!isImage || !a.size || a.size > MAX_IMAGE || used + a.size > IMAGE_BUDGET) continue;
        try {
          const res = await fetchImpl(a.url);
          if (!res.ok) continue;
          const data = Buffer.from(await res.arrayBuffer());
          used += data.length;
          images.set(a.url, `data:${a.content_type || 'image/png'};base64,${data.toString('base64')}`);
        } catch {
          // left out; the transcript notes it
        }
      }
    }
    return images;
  }

  async function closeTicket(i, ref, reason) {
    const s = await settingsFor(ref);
    const channel = await rest.request('GET', `/channels/${i.channel_id}`);
    const info = parseTopic(channel.topic);
    if (!info) return whisper(i, "This channel isn't a ticket any more.");
    const closer = i.member.user;
    if (!isStaff(i.member, s) && !(s.userCanClose && info.userId === closer.id)) return whisper(i, 'Only staff can close this ticket.');

    const notice = await rest.request('POST', `/channels/${channel.id}/messages`, { body: { content: `🔒 <@${closer.id}> closed this ticket${reason ? `: ${reason}` : '.'} Saving the transcript…`, allowed_mentions: { parse: [] } } });
    const tell = (content) => rest.request('PATCH', `/channels/${channel.id}/messages/${notice.id}`, { body: { content, allowed_mentions: { parse: [] } } }).catch(() => {});

    const [messages, guild, roles, channels] = await Promise.all([
      // The closing notice isn't part of the conversation; the transcript's header says who closed it and why.
      allMessages(channel.id).then((list) => list.filter((m) => m.id !== notice.id)),
      rest.request('GET', `/guilds/${i.guild_id}`).catch(() => null),
      rest.request('GET', `/guilds/${i.guild_id}/roles`).catch(() => []),
      rest.request('GET', `/guilds/${i.guild_id}/channels`).catch(() => []),
    ]);
    const names = { users: {}, roles: Object.fromEntries(roles.map((r) => [r.id, r.name])), channels: Object.fromEntries(channels.map((c) => [c.id, c.name])) };
    const closedAt = new Date().toISOString();
    const openedAt = new Date(Number((BigInt(channel.id) >> 22n) + 1420070400000n)).toISOString();
    const html = buildTranscript({ guildName: guild?.name || 'Discord server', channelName: channel.name, messages, images: await copyImages(messages), names, meta: { openerId: info.userId, claimedBy: info.claimedBy, closedBy: closer.id, reason, openedAt, closedAt } });

    let log;
    try {
      log = await rest.request('POST', `/channels/${ref.logChannelId}/messages`, {
        body: {
          embeds: [
            {
              title: `🎫 Ticket closed · #${channel.name}`,
              color: s.ticket.color,
              fields: [
                { name: 'Opened by', value: `<@${info.userId}>`, inline: true },
                { name: 'Claimed by', value: info.claimedBy ? `<@${info.claimedBy}>` : 'Nobody', inline: true },
                { name: 'Closed by', value: `<@${closer.id}>`, inline: true },
                { name: 'Reason', value: reason ? reason.slice(0, 1024) : 'No reason given' },
                { name: 'Opened', value: `<t:${Math.floor(Date.parse(openedAt) / 1000)}:f>`, inline: true },
                { name: 'Messages', value: String(messages.length), inline: true },
              ],
              footer: { text: `Ticket ${channel.id}` },
              timestamp: closedAt,
            },
          ],
          allowed_mentions: { parse: [] },
        },
        files: [{ name: `transcript-${channel.name}.html`, data: Buffer.from(html, 'utf8'), type: 'text/html' }],
      });
    } catch (err) {
      // Without a saved transcript the ticket stays, so nothing is lost.
      return tell(`⚠️ The transcript couldn't be saved in the log channel (${explain(err)}). The ticket stays open; fix that and close it again.`);
    }
    const link = transcriptLink(ref.logChannelId, log.id);
    if (link) await rest.request('PATCH', `/channels/${ref.logChannelId}/messages/${log.id}`, { body: { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'View transcript', emoji: { name: '📄' }, url: link }] }] } }).catch(() => {});
    await tell(`🔒 <@${closer.id}> closed this ticket${reason ? `: ${reason}` : '.'} The transcript is saved, and this channel is deleted in a few seconds.`);
    await sleep(closeDelayMs);
    await rest.request('DELETE', `/channels/${channel.id}`, { reason: `Ticket closed by ${nameOf(closer)}${reason ? `: ${reason}` : ''}`.slice(0, 400) }).catch(() => {});
  }

  // Runs the work after the reply; a problem is shown to the person who pressed the button.
  const later = (i, work, onError = (err) => whisper(i, `✗ ${explain(err)}`)) => async () => {
    try {
      await work();
    } catch (err) {
      await Promise.resolve(onError(err)).catch(() => {});
    }
  };

  async function interaction(i) {
    if ((i?.type !== 3 && i?.type !== 5) || !i.guild_id || !i.member?.user) return null;
    const ref = parseCustomId(i.data?.custom_id);
    if (!ref) return null;
    switch (ref.action) {
      case 'open':
        // Thinking… (only they see it), then a link to their new ticket.
        return {
          response: { type: 5, data: { flags: 64 } },
          after: later(i, async () => editOriginal(i, { content: await openTicket(i, ref) }), (err) => editOriginal(i, { content: `✗ ${explain(err)}` })),
        };
      case 'claim':
        return { response: { type: 6 }, after: later(i, () => claimTicket(i, ref)) };
      case 'closeask':
        return {
          response: {
            type: 9,
            data: { custom_id: customId('closing', ref), title: 'Close this ticket', components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', label: 'Reason (optional)', style: 2, required: false, max_length: 400, placeholder: 'e.g. Sorted out, thanks!' }] }] },
          },
        };
      case 'close':
        return { response: { type: 6 }, after: later(i, () => closeTicket(i, ref, '')) };
      case 'closing': {
        const reason = String(i.data.components?.[0]?.components?.[0]?.value || '').trim().slice(0, 400);
        return { response: { type: 6 }, after: later(i, () => closeTicket(i, ref, reason)) };
      }
      default:
        return null;
    }
  }

  return { interaction, settingsFor };
}

module.exports = {
  createTickets,
  normalizeSettings,
  settingsFile,
  settingsNote,
  panelMessage,
  ticketMessage,
  buildTranscript,
  markdown,
  parseTopic,
  parseCustomId,
  transcriptSignature,
  checkTranscriptSignature,
  DEFAULTS,
  STYLES,
  SETTINGS_FILE,
  P,
  MEMBER_ALLOW,
  BOT_ALLOW,
  LOG_READ,
};
