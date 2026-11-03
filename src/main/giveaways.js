// Giveaways: a message members enter by reacting with its emoji (🎉, or any other, a server's own
// included), posted now or at a set time. At its "enter by" time the winners are picked at random
// from the members who reacted (bots, members who have left and members without the required role
// can't win), pinged in a reply, and listed on the message. Winners can be picked again later. Used
// by the app (src/main/main.js) and the mod portal (server/always.js), so no Electron here.
const crypto = require('crypto');
const { cleanEmoji, sameEmoji, emojiPath, emojiText } = require('./reactionroles');
const { LIMITS: CARD } = require('./announce');

const EMOJI = '🎉'; // the title's, and the entry emoji unless another is picked
const RAN_BY = 'Ran by ';
const LIMITS = { prize: 200, description: 2000, winners: 20, ranBy: CARD.author - RAN_BY.length };
const MISS_MARGIN_MS = 5 * 60 * 1000; // a scheduled post isn't sent this close to (or after) its enter-by time
const RETRY_MS = 10 * 60 * 1000; // a draw that failed is tried again after this
const MAX_CHECKS = 500; // members looked up in one draw, at most
const IMAGE_FILE = /^[\w-]{1,80}\.(png|jpe?g|gif|webp)$/i;
const GONE = new Set([10003, 10008]); // unknown channel, unknown message

const problem = (message) => Object.assign(new Error(message), { status: 400 });
const isId = (v) => /^\d{15,21}$/.test(String(v || ''));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const url = (v, what) => {
  const s = str(v, 2048);
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw problem(`The ${what} must be a web address starting with https://.`);
  return s;
};
const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const joinWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '');
// The emoji members react with: { name } for a standard one, { id, name, animated } for a server's own.
const entryEmoji = (g) => (g.emoji?.name ? g.emoji : { name: EMOJI });
const reactionPath = (g) => `/channels/${g.channelId}/messages/${g.messageId}/reactions/${emojiPath(entryEmoji(g))}`;

// Checks and tidies a giveaway from the app. A giveaway already posted can't be scheduled again.
function normalize(input, now = Date.now()) {
  const prize = str(input?.prize, LIMITS.prize);
  if (!prize) throw problem('Write what the prize is.');
  const winners = Math.trunc(Number(input?.winners));
  if (!(winners >= 1 && winners <= LIMITS.winners)) throw problem(`Pick 1 to ${LIMITS.winners} winners.`);
  const endsAt = Number(input?.endsAt) || 0;
  if (!endsAt) throw problem('Pick the date and time members can enter by.');
  const s = input?.start || {};
  const start = { on: !!s.on, at: Number(s.at) || 0 };
  if (start.on) {
    if (!start.at) throw problem('Pick when to post it.');
    if (start.at <= now) throw problem('That posting time has already passed. Pick a time in the future.');
    if (endsAt <= start.at) throw problem('The enter-by time must come after it is posted.');
  } else if (endsAt <= now) throw problem('The enter-by time has already passed. Pick a time in the future.');
  const color = Number(input?.color);
  const fields = (Array.isArray(input?.fields) ? input.fields : [])
    .map((f) => ({ name: str(f?.name, CARD.fieldName), value: str(f?.value, CARD.fieldValue), inline: !!f?.inline }))
    .filter((f) => f.name || f.value)
    .slice(0, CARD.fields);
  // Who runs it, shown at the top as "Ran by …" (typing "Ran by" too doesn't double it).
  const ranBy = { name: str(input?.ranBy?.name, CARD.author).replace(/^ran by\s*:?\s*/i, '').slice(0, LIMITS.ranBy), icon: url(input?.ranBy?.icon, 'Ran by picture link') };
  const footer = str(input?.footer, CARD.footer);
  const description = str(input?.description, LIMITS.description);
  const length = prize.length + description.length + footer.length + (ranBy.name ? RAN_BY.length + ranBy.name.length : 0) + fields.reduce((n, f) => n + f.name.length + f.value.length, 0) + 300; // and the lines the bot adds
  if (length > CARD.embedTotal) throw problem(`A giveaway card can hold about ${(CARD.embedTotal - 300).toLocaleString('en-US')} characters in all; this one has ${(length - 300).toLocaleString('en-US')}.`);
  return {
    id: input?.id ? String(input.id) : null,
    guildId: isId(input?.guildId) ? String(input.guildId) : '',
    guildName: str(input?.guildName, 100),
    channelId: isId(input?.channelId) ? String(input.channelId) : '',
    channelName: str(input?.channelName, 100),
    prize,
    description,
    ranBy,
    fields,
    thumbnail: url(input?.thumbnail, 'small picture link'),
    footer,
    winners,
    endsAt,
    requiredRole: isId(input?.requiredRole) ? String(input.requiredRole) : '',
    requiredRoleName: str(input?.requiredRoleName, 100),
    ping: ['none', 'everyone', 'here'].includes(input?.ping) || isId(input?.ping) ? String(input.ping) : 'none',
    pingName: str(input?.pingName, 100),
    emoji: input?.emoji?.name ? cleanEmoji(input.emoji) : { name: EMOJI },
    color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : 0xfaa61a,
    image: url(input?.image, 'picture link'),
    imageFile: IMAGE_FILE.test(String(input?.imageFile || '')) ? String(input.imageFile) : '',
    start,
  };
}

// The card both messages share: who runs it, the prize, its text, fields and pictures, and the
// footer. image: { name, data, type } for a picture picked from the PC, else null.
function card(g, image, lines) {
  const embed = { color: g.color, title: `${EMOJI} ${g.prize}`, description: [...(g.description ? [g.description, ''] : []), ...lines].join('\n') };
  if (g.ranBy?.name) embed.author = g.ranBy.icon ? { name: RAN_BY + g.ranBy.name, icon_url: g.ranBy.icon } : { name: RAN_BY + g.ranBy.name };
  if (g.fields?.length) embed.fields = g.fields.map((f) => ({ name: f.name || '​', value: f.value || '​', inline: f.inline }));
  if (image) embed.image = { url: `attachment://${image.name}` };
  else if (g.image) embed.image = { url: g.image };
  if (g.thumbnail) embed.thumbnail = { url: g.thumbnail };
  if (g.footer) embed.footer = { text: g.footer };
  return embed;
}

// The giveaway as posted, open for entries.
function buildMessage(g, image = null) {
  const ping = g.ping === 'everyone' ? '@everyone' : g.ping === 'here' ? '@here' : isId(g.ping) ? `<@&${g.ping}>` : '';
  const allowed = g.ping === 'everyone' || g.ping === 'here' ? { parse: ['everyone'] } : isId(g.ping) ? { parse: [], roles: [g.ping] } : { parse: [] };
  const lines = [`React with ${emojiText(entryEmoji(g))} to enter!`, `**Winners:** ${g.winners}`, `**Enter by:** ${ts(g.endsAt, 'f')} (${ts(g.endsAt, 'R')})`];
  if (g.requiredRole) lines.push(`Only members with <@&${g.requiredRole}> can win.`);
  const body = { content: ping, embeds: [card(g, image, lines)], allowed_mentions: allowed };
  return { body, files: image ? [{ name: image.name, data: image.data, type: image.type }] : undefined };
}

// Why nobody won, in words.
function noWinner(g) {
  if (!g.entries) return 'Nobody entered.';
  if (g.requiredRole) return `None of the ${plural(g.entries, 'member', 'members')} who entered could win: they've left or don't have the role.`;
  return `Everyone who entered has left the server.`;
}

// The giveaway once it's over (an edit of the posted message; the ping above it stays as it was).
function buildEndedMessage(g, image = null) {
  const list = g.winnerList || [];
  const lines = [list.length ? `**${list.length === 1 ? 'Winner' : 'Winners'}:** ${joinWords(list.map((w) => `<@${w.id}>`))}` : noWinner(g), `**Entries:** ${g.entries}`, `Ended ${ts(g.endedAt, 'R')}`];
  const body = { embeds: [card(g, image, lines)], allowed_mentions: { parse: [] } };
  return { body: image ? body : { ...body, ...(g.imageFile ? {} : { attachments: [] }) }, files: image ? [{ name: image.name, data: image.data, type: image.type }] : undefined };
}

// The reply that tells the winners (again: picked again for ones replaced).
function winnersMessage(g, winners, { again = false } = {}) {
  const mentions = joinWords(winners.map((w) => `<@${w.id}>`));
  let content;
  if (!winners.length) content = again ? `Nobody else who entered **${g.prize}** could be picked.` : `The giveaway for **${g.prize}** has ended. ${noWinner(g)}`;
  else if (again) content = `${EMOJI} ${mentions} ${winners.length === 1 ? 'is the new winner' : 'are the new winners'} of **${g.prize}**! Congratulations!`;
  else content = `${EMOJI} Congratulations ${mentions}! You won **${g.prize}**!`;
  return { content, allowed_mentions: { parse: [], users: winners.map((w) => w.id) }, message_reference: { message_id: g.messageId, fail_if_not_exists: false } };
}

// Everyone who reacted with 🎉, bots left out.
async function entrants(rest, g) {
  const ids = [];
  let after;
  for (;;) {
    const page = await rest.request('GET', reactionPath(g), { query: { limit: 100, after } });
    for (const u of page) if (!u.bot) ids.push(u.id);
    if (page.length < 100) return ids;
    after = page[page.length - 1].id;
  }
}

// Up to `count` winners from `pool`, in random order, skipping members who left or lack the role.
async function pick(rest, g, pool, count, random) {
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const winners = [];
  for (const id of order.slice(0, MAX_CHECKS)) {
    if (winners.length >= count) break;
    const member = await rest.request('GET', `/guilds/${g.guildId}/members/${id}`).catch((err) => {
      if (err.code === 10007 || err.status === 404) return null; // left the server
      throw err;
    });
    if (!member || (g.requiredRole && !member.roles?.includes(g.requiredRole))) continue;
    winners.push({ id, name: member.nick || member.user?.global_name || member.user?.username || id });
  }
  return winners;
}

// restFor(g): the bot's REST client; list(): the giveaways to look after; update(g, patch): saves
// what happened; imageFor(g): its picture from the PC, or null; ended(g, patch): a draw finished.
function createGiveaways({ restFor, list, update, imageFor = () => null, ended = () => {}, now = Date.now, random = (n) => crypto.randomInt(n), retryMs = RETRY_MS }) {
  let running = false;

  // Posts it and adds the reaction members press. Resolves to what to save.
  async function post(g) {
    const rest = restFor(g);
    const { body, files } = buildMessage(g, await imageFor(g));
    const message = await rest.request('POST', `/channels/${g.channelId}/messages`, { body, files });
    let problem = null;
    await rest.request('PUT', `${reactionPath({ ...g, messageId: message.id })}/@me`).catch((err) => {
      // Usually a server emoji from another server, or one deleted since.
      problem = `Posted, but the bot couldn't add the ${entryEmoji(g).id ? `:${entryEmoji(g).name}:` : entryEmoji(g).name} reaction (${err.message}). Members who have it can still add it themselves.`;
    });
    return { messageId: message.id, postedAt: now(), start: { ...g.start, on: false }, missedAt: null, problem };
  }

  // Picks the winners, pings them in a reply and lists them on the message. replace: the winners to
  // pick again for, plus any places left unfilled (members who have won this giveaway before can't be
  // picked). Resolves to what to save.
  async function draw(g, { replace = null } = {}) {
    const rest = restFor(g);
    const again = Array.isArray(replace);
    let entries;
    try {
      entries = await entrants(rest, g);
    } catch (err) {
      if (!GONE.has(err.code)) throw err;
      if (again) throw new Error('The giveaway message was deleted in Discord.');
      return { endedAt: now(), winnerList: [], entries: 0, problem: 'The giveaway message was deleted in Discord, so no winners were picked.', retryAt: null };
    }
    const before = g.winnerList || [];
    const exclude = new Set(again ? [...(g.pastWinnerIds || []), ...before.map((w) => w.id)] : []);
    const count = again ? replace.length + Math.max(0, g.winners - before.length) : g.winners;
    const picked = await pick(rest, g, entries.filter((id) => !exclude.has(id)), count, random);
    const winnerList = again ? [...before.filter((w) => !replace.includes(w.id)), ...picked] : picked;
    const result = { ...g, endedAt: g.endedAt || now(), winnerList, entries: entries.length };
    await rest.request('POST', `/channels/${g.channelId}/messages`, { body: winnersMessage(result, picked, { again }) });
    let problem = null;
    const { body, files } = buildEndedMessage(result, await imageFor(g));
    await rest.request('PATCH', `/channels/${g.channelId}/messages/${g.messageId}`, { body, files }).catch((err) => {
      problem = `The winners were announced, but the giveaway message couldn't be updated: ${err.message}`;
    });
    return { endedAt: result.endedAt, winnerList, pastWinnerIds: [...new Set([...(g.pastWinnerIds || []), ...winnerList.map((w) => w.id)])], entries: entries.length, problem, retryAt: null, ...(again ? { rerolledAt: now() } : {}) };
  }

  // Posts what's due and draws what has ended.
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const g of list()) {
        const t = now();
        if (!g.messageId) {
          if (!g.start?.on || t < g.start.at) continue;
          if (t > g.endsAt - MISS_MARGIN_MS) {
            update(g, { start: { ...g.start, on: false }, missedAt: g.start.at, problem: null });
            continue;
          }
          try {
            update(g, await post(g));
          } catch (err) {
            update(g, { start: { ...g.start, on: false }, problem: `Couldn't post it on time: ${err.message}` });
          }
          continue;
        }
        if (g.endedAt || t < g.endsAt || (g.retryAt && t < g.retryAt)) continue;
        try {
          const patch = await draw(g);
          update(g, patch);
          ended(g, patch);
        } catch (err) {
          update(g, { problem: `Couldn't pick the winners yet: ${err.message} It tries again in ${Math.round(retryMs / 60000)} minutes.`, retryAt: t + retryMs });
        }
      }
    } finally {
      running = false;
    }
  }

  // How many members have entered so far (the bot's own reaction left out).
  async function entryCount(g) {
    const message = await restFor(g).request('GET', `/channels/${g.channelId}/messages/${g.messageId}`);
    const r = (message.reactions || []).find((x) => sameEmoji(x.emoji, entryEmoji(g)));
    return r ? r.count - (r.me ? 1 : 0) : 0;
  }

  return { tick, post, draw, entryCount };
}

module.exports = { normalize, buildMessage, buildEndedMessage, winnersMessage, createGiveaways, EMOJI, LIMITS };
