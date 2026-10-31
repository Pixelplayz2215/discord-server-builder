// Reaction polls: a question with 2 to 4 answers, each with its own emoji. Members vote by reacting,
// and while the app is open or in the tray the bot redraws a coloured bar under each answer, like
// Discord's own polls. /poll posts the same message from the mod portal, and the app picks those
// polls up from their reactions. No Electron here, so the portal and the tests can use it.
const { publishMessage, cleanEmoji, snowflake, isUnknown, sameEmoji, emojiPath, emojiText } = require('./reactionroles');
const { STANDARD_EMOJIS } = require('../renderer/js/emojis');
const { EMOJI_BAR_COLORS } = require('./emojicolors');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const LIMITS = { title: 256, message: 900, label: 55 };
const CELLS = 10; // squares in a bar, 10% each
// Bars are coloured squares: the only colour a message shows everywhere, mobile included.
const BAR_COLORS = { red: '🟥', orange: '🟧', yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪', brown: '🟫', white: '⬜', black: '⬛' };
const FALLBACK_COLORS = ['blue', 'green', 'yellow', 'red'];
const DEFAULT_EMBED_COLOR = 0x7f8cf0;
const MARK = '📊';
const OPEN = 'React to vote';
const ENDED = 'Poll ended';
const HINT = { one: 'Select one answer', many: 'Select one or more answers' };
const POPULAR = ['👍', '👎', '✅', '❌', '🔥', '❤️', '😂', '🎉', '👀', '🤔'];
const SEEN_LIMIT = 1000; // bot messages remembered as "not a poll"

const problem = (message) => Object.assign(new Error(message), { status: 400 });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const bare = (name) => String(name || '').replace(/️/g, '');
const escapeLabel = (s) => s.replace(/([\\*_`~|])/g, '\\$1');
const unescapeLabel = (s) => s.replace(/\\([\\*_`~|])/g, '$1');

/* ---------- Bar colours ---------- */

const COLOR_OF = new Map(Object.entries(EMOJI_BAR_COLORS).flatMap(([color, list]) => list.split(' ').map((e) => [bare(e), color])));

// The colour a new answer's bar gets: its emoji's own colour when known, otherwise one per position.
const defaultColor = (emoji, index = 0) => (!emoji?.id && COLOR_OF.get(bare(emoji?.name))) || FALLBACK_COLORS[index % FALLBACK_COLORS.length];

function rgbToHsl(r, g, b) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function barColorOf(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Greys (often tinted), near-black and near-white.
  if (s < 0.22 || l < 0.12 || l > 0.9 || (l > 0.78 && s < 0.5) || (l < 0.25 && s < 0.5)) return l < 0.45 ? 'black' : 'white';
  if (h < 12 || h >= 330) return 'red'; // pinks too: there's no pink square
  if (h < 36) return l < 0.4 ? 'brown' : 'orange';
  if (h < 68) return 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return 'blue';
  return 'purple';
}

// The bar colour closest to an image's main colour, from its pixels (RGBA, or BGRA from Electron).
// Colourful pixels count for more than outlines, shading and highlights.
function dominantColor(pixels, { bgra = false } = {}) {
  const weights = {};
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const color = barColorOf(pixels[bgra ? i + 2 : i], pixels[i + 1], pixels[bgra ? i : i + 2]);
    weights[color] = (weights[color] || 0) + (color === 'black' || color === 'white' ? 0.35 : 1);
  }
  const best = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

function bar(color, share) {
  const filled = Math.round(share * CELLS);
  return (BAR_COLORS[color] || BAR_COLORS.blue).repeat(filled) + (color === 'black' ? '⬜' : '⬛').repeat(CELLS - filled);
}

/* ---------- The message ---------- */

// The poll as a message: the question, your message, then each answer with its bar. counts[i] is
// answer i's votes.
function pollMessage(poll, counts = []) {
  const votes = poll.options.map((_, i) => Math.max(0, Number(counts[i]) || 0));
  const total = votes.reduce((a, b) => a + b, 0);
  const top = Math.max(...votes);
  const answers = poll.options.map((o, i) => {
    const share = total ? votes[i] / total : 0;
    const won = poll.ended && total && votes[i] === top ? ' 🏆' : '';
    return `${emojiText(o.emoji)} **${escapeLabel(o.label)}**${won}\n${bar(o.color, share)} **${Math.round(share * 100)}%** · ${plural(votes[i], 'vote')}`;
  });
  const body = [String(poll.message || '').trim(), `*${poll.multiple ? HINT.many : HINT.one}*`, answers.join('\n\n')].filter(Boolean).join('\n\n');
  const status = `${MARK} ${plural(total, 'vote')} · ${poll.ended ? ENDED : OPEN}`;
  if (poll.style === 'text') {
    const content = [poll.title ? `**${poll.title}**` : '', body, `-# ${status}`].filter(Boolean).join('\n');
    return { content: content.slice(0, 2000), embeds: [], allowed_mentions: { parse: [] } };
  }
  const embed = { color: Number.isInteger(poll.color) ? poll.color : DEFAULT_EMBED_COLOR, title: String(poll.title || 'Poll').slice(0, 256), description: body.slice(0, 4096), footer: { text: status } };
  if (poll.by?.name) embed.author = { name: `Poll by ${poll.by.name}`.slice(0, 256), ...(poll.by.icon ? { icon_url: poll.by.icon } : {}) };
  return { content: '', embeds: [embed], allowed_mentions: { parse: [] } };
}

// Whether a message already shows what pollMessage would draw.
function sameDrawing(msg, body) {
  if (!body.embeds.length) return msg?.content === body.content;
  const [a, b] = [msg?.embeds?.[0] || {}, body.embeds[0]];
  return a.title === b.title && a.description === b.description && a.footer?.text === b.footer.text && a.color === b.color;
}

const BAR_LINE = new RegExp(`^(?:${Object.values(BAR_COLORS).join('|')}|⬜|⬛)+ \\*\\*\\d+%\\*\\* · \\d+ votes?$`, 'u');
const ANSWER_LINE = /^(<a?:\w{2,32}:\d{15,21}>|\S+) \*\*(.+)\*\*(?: 🏆)?$/u;

function emojiFromText(text) {
  const custom = text.match(/^<(a?):(\w{2,32}):(\d{15,21})>$/);
  return custom ? { id: custom[3], name: custom[2], animated: !!custom[1] } : { name: text };
}

// Reads a poll back from its card, for polls posted with /poll. Returns null for other messages.
function parsePoll(msg) {
  const embed = msg?.embeds?.[0];
  const status = embed?.footer?.text || '';
  if (!status.startsWith(`${MARK} `) || !(status.endsWith(` · ${OPEN}`) || status.endsWith(` · ${ENDED}`))) return null;
  const lines = String(embed.description || '').split('\n');
  let hintAt = -1;
  lines.forEach((line, i) => {
    if (line === `*${HINT.one}*` || line === `*${HINT.many}*`) hintAt = i;
  });
  if (hintAt < 0) return null;
  const options = [];
  for (let i = hintAt + 1; i < lines.length - 1; i++) {
    const m = lines[i].match(ANSWER_LINE);
    if (m && BAR_LINE.test(lines[i + 1])) {
      options.push({ emoji: emojiFromText(m[1]), label: unescapeLabel(m[2]) });
      i++;
    }
  }
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return null;
  const author = /^Poll by (.+)$/.exec(embed.author?.name || '');
  return {
    title: embed.title || '',
    message: lines.slice(0, hintAt).join('\n').trim(),
    style: 'embed',
    color: Number.isInteger(embed.color) ? embed.color : DEFAULT_EMBED_COLOR,
    multiple: lines[hintAt] === `*${HINT.many}*`,
    ended: status.endsWith(` · ${ENDED}`),
    by: author ? { name: author[1], icon: embed.author.icon_url || null } : null,
    options: options.map((o, i) => ({ ...o, color: defaultColor(o.emoji, i) })),
  };
}

// Votes per answer: the reactions on each emoji, not counting the bot's own.
function countVotes(poll, msg) {
  return poll.options.map((o) => {
    const r = (msg?.reactions || []).find((x) => sameEmoji(x.emoji, o.emoji));
    return r ? Math.max(0, r.count - (r.me ? 1 : 0)) : 0;
  });
}

/* ---------- Checking input ---------- */

// Checks and tidies a poll from the app (or /poll) before it's posted.
function normalizePoll(input) {
  const options = (Array.isArray(input?.options) ? input.options : []).map((o, i) => {
    const emoji = cleanEmoji(o?.emoji);
    if (!emoji.name) throw problem('Every answer needs an emoji.');
    const label = String(o?.label || '').trim().slice(0, LIMITS.label);
    if (!label) throw problem('Write the text for every answer.');
    return { emoji, label, color: BAR_COLORS[o?.color] ? o.color : defaultColor(emoji, i) };
  });
  if (options.length < MIN_OPTIONS) throw problem(`A poll needs at least ${MIN_OPTIONS} answers.`);
  if (options.length > MAX_OPTIONS) throw problem(`A poll can have up to ${MAX_OPTIONS} answers.`);
  options.forEach((o, i) => {
    if (options.findIndex((p) => sameEmoji(p.emoji, o.emoji)) !== i) throw problem('Give every answer its own emoji.');
  });
  const title = String(input?.title || '').trim().slice(0, LIMITS.title);
  if (!title) throw problem('Write the question.');
  const color = Number(input?.color);
  return {
    id: input?.id ? String(input.id) : null,
    guildId: snowflake(input?.guildId, 'server'),
    guildName: String(input?.guildName || '').slice(0, 100),
    channelId: snowflake(input?.channelId, 'channel'),
    channelName: String(input?.channelName || '').slice(0, 100),
    title,
    message: String(input?.message || '').trim().slice(0, LIMITS.message),
    style: input?.style === 'text' ? 'text' : 'embed',
    color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : DEFAULT_EMBED_COLOR,
    multiple: input?.multiple !== false,
    by: input?.by?.name ? { name: String(input.by.name).slice(0, 80), icon: input.by.icon ? String(input.by.icon) : null } : null,
    options,
  };
}

const EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}️?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*)$/u;

function findStandard(word) {
  const q = word.toLowerCase().replace(/_/g, ' ');
  for (const [, list] of STANDARD_EMOJIS) for (const [char, words] of list) if (words === q || words.split(' ').includes(q)) return char;
  return null;
}

// An emoji typed into /poll: <:name:id> (what Discord sends for a server emoji), :name:, or the
// emoji itself.
function parseEmojiInput(value, serverEmojis = []) {
  const text = String(value ?? '').trim();
  if (/^<a?:\w{2,32}:\d{15,21}>$/.test(text)) return emojiFromText(text);
  const named = text.match(/^:?([\w+-]{2,32}):?$/);
  if (named) {
    const server = serverEmojis.find((e) => e.name?.toLowerCase() === named[1].toLowerCase());
    if (server) return { id: server.id, name: server.name, animated: !!server.animated };
    const standard = findStandard(named[1]);
    if (standard) return { name: standard };
    throw problem(`There's no :${named[1]}: emoji here. Pick one from the list as you type.`);
  }
  if (EMOJI.test(text)) return { name: text };
  throw problem(`"${text.slice(0, 20)}" isn't an emoji. Pick one from the list as you type.`);
}

// Suggestions for a /poll emoji box: what was typed (if it's an emoji), the server's own emojis,
// then standard ones whose words match.
function emojiChoices(typed, serverEmojis = []) {
  const q = String(typed || '').trim().replace(/^:|:$/g, '').toLowerCase();
  const choices = [];
  const add = (name, value) => {
    if (choices.length < 25 && !choices.some((c) => c.value === value)) choices.push({ name: name.slice(0, 100), value });
  };
  if (q) {
    try {
      const e = parseEmojiInput(typed, serverEmojis);
      add(e.id ? `:${e.name}:` : e.name, emojiText(e));
    } catch {
      // not an emoji yet: just suggest
    }
  }
  const server = serverEmojis.filter((e) => e.available !== false && (!q || e.name.toLowerCase().includes(q)));
  for (const e of server.slice(0, q ? 25 : 15)) add(`:${e.name}: (this server)`, emojiText(e));
  for (const [, list] of STANDARD_EMOJIS) {
    for (const [char, words] of list) if (q ? words.includes(q) : POPULAR.some((p) => bare(p) === bare(char))) add(`${char}  ${words}`, char);
  }
  return choices;
}

/* ---------- Posting and keeping the bars up to date ---------- */

// Posts or updates a poll from the app. Returns its message id and current votes.
async function publishPoll(rest, poll, previous) {
  let counts = poll.options.map(() => 0);
  if (previous?.messageId && previous.channelId === poll.channelId) {
    const msg = await rest.request('GET', `/channels/${poll.channelId}/messages/${previous.messageId}`).catch((err) => {
      if (isUnknown(err, 10008)) return null;
      throw err;
    });
    if (msg) counts = countVotes(poll, msg);
  }
  const messageId = await publishMessage(
    rest,
    { channelId: poll.channelId, body: pollMessage(poll, counts), emojis: poll.options.map((o) => o.emoji) },
    previous && { channelId: previous.channelId, messageId: previous.messageId, emojis: previous.options.map((o) => o.emoji) },
  );
  return { messageId, counts: messageId === previous?.messageId ? counts : poll.options.map(() => 0) };
}

const ONE_ANSWER = 'To keep it to one answer each, the bot needs Manage Messages in that channel.';
const describe = (err) => (err.code === 50013 || err.code === 50001 ? "The bot can't update this poll. Give it View Channel, Send Messages and Read Message History in that channel." : err.message);

// Handles one bot's reaction events for its polls.
//   pollFor(messageId)     a known poll, or null
//   discover(poll)         a poll posted with /poll was found; the app keeps it (may be async)
//   saved(poll, counts)    the bars were redrawn (or the poll ended)
//   forget(poll)           its message was deleted
//   report(poll, problem)  the latest problem, or null once things work
// Redraws wait delayMs so a burst of votes becomes one edit.
function createPolls({ rest, botId, pollFor, discover = () => {}, saved = () => {}, forget = () => {}, report = () => {}, delayMs = 2500 }) {
  const timers = new Map(); // messageId -> pending redraw
  const queues = new Map(); // messageId -> last job, so redraws never overlap
  const notPolls = new Set();
  const looking = new Set();
  const path = (poll) => `/channels/${poll.channelId}/messages/${poll.messageId}`;

  function queue(messageId, job) {
    const next = (queues.get(messageId) || Promise.resolve()).catch(() => {}).then(job);
    queues.set(messageId, next);
    next.catch(() => {}).finally(() => {
      if (queues.get(messageId) === next) queues.delete(messageId);
    });
    return next;
  }

  // Reads the reactions and redraws the bars if the numbers changed.
  async function redraw(poll, { end = false } = {}) {
    try {
      const msg = await rest.request('GET', path(poll));
      const counts = countVotes(poll, msg);
      const next = { ...poll, ended: poll.ended || end };
      const body = pollMessage(next, counts);
      if (!sameDrawing(msg, body)) await rest.request('PATCH', path(poll), { body });
      saved(next, counts);
      report(poll, null);
      return counts;
    } catch (err) {
      if (isUnknown(err, 10008)) forget(poll);
      else report(poll, describe(err));
      throw err;
    }
  }

  function schedule(messageId) {
    if (timers.has(messageId)) return;
    timers.set(
      messageId,
      setTimeout(() => {
        timers.delete(messageId);
        queue(messageId, () => {
          const poll = pollFor(messageId);
          return poll && !poll.ended ? redraw(poll) : null;
        }).catch(() => {});
      }, delayMs),
    );
  }

  // A reaction on one of the bot's own messages that isn't a known poll: it may be a /poll poll.
  async function lookUp(d) {
    const id = d.message_id;
    if (notPolls.has(id) || looking.has(id)) return;
    looking.add(id);
    try {
      const msg = await rest.request('GET', `/channels/${d.channel_id}/messages/${id}`);
      const found = parsePoll(msg);
      if (!found) {
        if (notPolls.size >= SEEN_LIMIT) notPolls.delete(notPolls.values().next().value);
        notPolls.add(id);
        return;
      }
      await discover({ ...found, guildId: d.guild_id, channelId: d.channel_id, messageId: id, createdAt: Date.parse(msg.timestamp) || Date.now() });
      if (pollFor(id)) schedule(id);
    } catch {
      // try again on the next reaction
    } finally {
      looking.delete(id);
    }
  }

  async function onAdd(d) {
    const poll = pollFor(d.message_id);
    if (!poll) return d.message_author_id === botId && d.guild_id ? lookUp(d) : null;
    if (poll.ended) return null;
    const voter = d.user_id !== botId && !d.member?.user?.bot;
    const chosen = poll.options.find((o) => sameEmoji(o.emoji, d.emoji));
    if (voter && chosen && !poll.multiple) {
      // One answer each: take back their other reactions.
      for (const o of poll.options) {
        if (o === chosen) continue;
        await rest.request('DELETE', `${path(poll)}/reactions/${emojiPath(o.emoji)}/${d.user_id}`).catch((err) => {
          if (err.code === 50013) report(poll, ONE_ANSWER);
        });
      }
    }
    schedule(poll.messageId);
    return null;
  }

  // A mod cleared the reactions: put the bot's back so members can still vote.
  async function restore(poll, emoji) {
    for (const o of poll.options) {
      if (emoji && !sameEmoji(o.emoji, emoji)) continue;
      await rest.request('PUT', `${path(poll)}/reactions/${emojiPath(o.emoji)}/@me`).catch(() => {});
    }
    schedule(poll.messageId);
  }

  function handle(type, d) {
    if (!d) return null;
    if (type === 'MESSAGE_REACTION_ADD') return onAdd(d);
    if (type === 'MESSAGE_DELETE_BULK') {
      for (const id of d.ids || []) {
        const poll = pollFor(id);
        if (poll) forget(poll);
      }
      return null;
    }
    const poll = pollFor(d.message_id || d.id);
    if (!poll) return null;
    if (type === 'MESSAGE_DELETE') forget(poll);
    else if (poll.ended) return null;
    else if (type === 'MESSAGE_REACTION_REMOVE') schedule(poll.messageId);
    else if (type === 'MESSAGE_REACTION_REMOVE_ALL') return restore(poll, null);
    else if (type === 'MESSAGE_REACTION_REMOVE_EMOJI') return restore(poll, d.emoji);
    return null;
  }

  // Redraws polls whose votes changed while the bot wasn't watching.
  async function catchUp(polls) {
    for (const poll of polls) if (!poll.ended) await queue(poll.messageId, () => redraw(poll)).catch(() => {});
  }

  // Draws the final results and stops counting.
  function end(poll) {
    clearTimeout(timers.get(poll.messageId));
    timers.delete(poll.messageId);
    return queue(poll.messageId, () => redraw(poll, { end: true }));
  }

  return { handle, catchUp, end };
}

module.exports = {
  createPolls,
  publishPoll,
  pollMessage,
  parsePoll,
  countVotes,
  normalizePoll,
  parseEmojiInput,
  emojiChoices,
  defaultColor,
  dominantColor,
  BAR_COLORS,
  MIN_OPTIONS,
  MAX_OPTIONS,
  LIMITS,
};
