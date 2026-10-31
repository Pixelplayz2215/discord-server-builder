// Tests for reaction polls with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/main/polls');
const { sameEmoji } = require('../src/main/reactionroles');

const G = '100000000000000001';
const CH = '300000000000000001';
const BOT = '200000000000000000';
const ANNA = '200000000000000005';
const BEN = '200000000000000006';
const PEPE = { id: '500000000000000009', name: 'pepe', animated: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keeps messages and who reacted with what, like Discord does.
function fakeDiscord() {
  const calls = [];
  const messages = new Map();
  let next = 900;
  const unknown = () => Object.assign(new Error('Unknown Message'), { status: 404, code: 10008 });
  const react = (msg, emoji, userId, add) => {
    let r = msg.reactions.find((x) => sameEmoji(x.emoji, emoji));
    if (!r) msg.reactions.push((r = { emoji, users: [] }));
    r.users = add ? [...new Set([...r.users, userId])] : r.users.filter((u) => u !== userId);
    r.count = r.users.length;
    r.me = r.users.includes(BOT);
    msg.reactions = msg.reactions.filter((x) => x.count);
  };
  return {
    calls,
    messages,
    react: (messageId, emoji, userId, add = true) => react(messages.get(messageId), emoji, userId, add),
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      let m;
      if (method === 'POST' && (m = path.match(/^\/channels\/(\d+)\/messages$/))) {
        const msg = { id: `7000000000000000${next++}`, channel_id: m[1], author: { id: BOT }, timestamp: new Date().toISOString(), reactions: [], ...opts.body };
        messages.set(msg.id, msg);
        return msg;
      }
      if ((m = path.match(/^\/channels\/\d+\/messages\/(\d+)\/reactions\/([^/]+)\/(@me|\d+)$/))) {
        const msg = messages.get(m[1]);
        if (!msg) throw unknown();
        const [name, id] = decodeURIComponent(m[2]).split(':');
        react(msg, id ? { id, name } : { name }, m[3] === '@me' ? BOT : m[3], method === 'PUT');
        return null;
      }
      if ((m = path.match(/^\/channels\/\d+\/messages\/(\d+)$/))) {
        const msg = messages.get(m[1]);
        if (!msg) throw unknown();
        if (method === 'GET') return structuredClone(msg);
        if (method === 'PATCH') return Object.assign(msg, opts.body);
        if (method === 'DELETE') messages.delete(m[1]);
      }
      return null;
    },
  };
}

const input = (extra = {}) => ({
  guildId: G,
  channelId: CH,
  title: 'Friday game?',
  message: 'Vote below!',
  options: [
    { emoji: { name: '🔥' }, label: 'Minecraft' },
    { emoji: PEPE, label: 'Valorant', color: 'purple' },
    { emoji: { name: '🎲' }, label: 'Board games' },
  ],
  ...extra,
});

test('the poll draws a coloured bar, percentage and votes under each answer', () => {
  const poll = polls.normalizePoll(input());
  assert.deepEqual(poll.options.map((o) => o.color), ['orange', 'purple', 'white']); // 🔥 and 🎲 from their emoji
  const card = polls.pollMessage(poll, [5, 2, 1]).embeds[0];
  assert.equal(card.title, 'Friday game?');
  assert.equal(card.color, 0x7f8cf0);
  assert.equal(
    card.description,
    'Vote below!\n\n*Select one or more answers*\n\n🔥 **Minecraft**\n🟧🟧🟧🟧🟧🟧⬛⬛⬛⬛ **63%** · 5 votes\n\n<:pepe:500000000000000009> **Valorant**\n🟪🟪🟪⬛⬛⬛⬛⬛⬛⬛ **25%** · 2 votes\n\n🎲 **Board games**\n⬜⬛⬛⬛⬛⬛⬛⬛⬛⬛ **13%** · 1 vote',
  );
  assert.equal(card.footer.text, '📊 8 votes · React to vote');

  const ended = polls.pollMessage({ ...poll, ended: true, multiple: false }, [1, 1, 0]).embeds[0];
  assert.match(ended.description, /\*Select one answer\*/);
  assert.match(ended.description, /🔥 \*\*Minecraft\*\* 🏆\n/);
  assert.match(ended.description, /\*\*Valorant\*\* 🏆\n/, 'a tie has two winners');
  assert.equal(ended.footer.text, '📊 2 votes · Poll ended');

  const black = polls.normalizePoll(input({ options: [{ emoji: { name: '🖤' }, label: 'a' }, { emoji: { name: '⚫' }, label: 'b*c' }] }));
  const plain = polls.pollMessage({ ...black, style: 'text' }, [1, 0]);
  assert.equal(plain.embeds.length, 0);
  assert.match(plain.content, /^\*\*Friday game\?\*\*\nVote below!/);
  assert.match(plain.content, /⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛ \*\*100%\*\* · 1 vote/);
  assert.match(plain.content, /\*\*b\\\*c\*\*\n⬜{10} \*\*0%\*\* · 0 votes/u, 'black bars use white for the empty part');
  assert.match(plain.content, /\n-# 📊 1 vote · React to vote$/);
  assert.deepEqual(plain.allowed_mentions, { parse: [] });
});

test('a /poll card can be read back, and other messages are not polls', () => {
  const poll = polls.normalizePoll(input({ multiple: false, by: { name: 'Anna', icon: 'https://cdn.discordapp.com/embed/avatars/1.png' }, options: [{ emoji: { name: '🔥' }, label: 'Mine*craft' }, { emoji: { ...PEPE, animated: true }, label: 'Valorant' }] }));
  const msg = polls.pollMessage(poll, [3, 4]);
  const back = polls.parsePoll(msg);
  assert.equal(back.title, 'Friday game?');
  assert.equal(back.message, 'Vote below!');
  assert.equal(back.multiple, false);
  assert.equal(back.ended, false);
  assert.deepEqual(back.by, { name: 'Anna', icon: 'https://cdn.discordapp.com/embed/avatars/1.png' });
  assert.deepEqual(back.options, [
    { emoji: { name: '🔥' }, label: 'Mine*craft', color: 'orange' },
    { emoji: { id: PEPE.id, name: 'pepe', animated: true }, label: 'Valorant', color: 'green' },
  ]);
  assert.equal(polls.parsePoll({ embeds: [{ description: 'Pick your roles', footer: { text: 'hi' } }] }), null);
  assert.equal(polls.parsePoll({ content: 'hello' }), null);
});

test('polls need a question and 2 to 4 answers, each with its own emoji and text', () => {
  const two = [{ emoji: { name: '🔥' }, label: 'a' }, { emoji: { name: '💧' }, label: 'b' }];
  assert.throws(() => polls.normalizePoll(input({ options: two.slice(0, 1) })), /at least 2 answers/);
  assert.throws(() => polls.normalizePoll(input({ options: [...two, ...two.map((o, i) => ({ ...o, emoji: { name: ['🌊', '🌲'][i] } })), { emoji: { name: '⭐' }, label: 'e' }] })), /up to 4 answers/);
  assert.throws(() => polls.normalizePoll(input({ options: [{ emoji: { name: '❤️' }, label: 'a' }, { emoji: { name: '❤' }, label: 'b' }] })), /its own emoji/);
  assert.throws(() => polls.normalizePoll(input({ title: '  ' })), /Write the question/);
  assert.throws(() => polls.normalizePoll(input({ options: [two[0], { ...two[1], label: ' ' }] })), /text for every answer/);
  assert.throws(() => polls.normalizePoll(input({ channelId: 'x' })), /Pick a channel/);
  const poll = polls.normalizePoll(input({ options: [{ ...two[0], color: 'pink' }, two[1]], style: 'text', color: -4 }));
  assert.equal(poll.options[0].color, 'orange', 'an unknown colour falls back to the emoji\'s');
  assert.equal(poll.options[1].color, 'blue');
  assert.equal(poll.color, 0x7f8cf0);
  assert.equal(poll.multiple, true);
});

test('emojis typed into /poll: server emojis, :names:, and emoji characters', () => {
  const server = [PEPE, { id: '500000000000000010', name: 'party_parrot', animated: true }];
  assert.deepEqual(polls.parseEmojiInput('<a:party_parrot:500000000000000010>'), { id: '500000000000000010', name: 'party_parrot', animated: true });
  assert.deepEqual(polls.parseEmojiInput(':Pepe:', server), { id: PEPE.id, name: 'pepe', animated: false });
  assert.deepEqual(polls.parseEmojiInput(':fire:'), { name: '🔥' });
  for (const e of ['❤️', '👍🏽', '1️⃣', '🇧🇷', '🏳️‍🌈', '👨‍👩‍👧']) assert.deepEqual(polls.parseEmojiInput(` ${e} `), { name: e });
  assert.throws(() => polls.parseEmojiInput('pizza time'), /isn't an emoji/);
  assert.throws(() => polls.parseEmojiInput(':nope_nope:'), /no :nope_nope: emoji/);
  assert.throws(() => polls.parseEmojiInput('🔥🔥'), /isn't an emoji/);

  const empty = polls.emojiChoices('', server);
  assert.deepEqual(empty.slice(0, 2).map((c) => c.value), ['<:pepe:500000000000000009>', '<a:party_parrot:500000000000000010>']);
  assert.ok(empty.some((c) => c.value === '👍'));
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `5000000000000001${String(i).padStart(2, '0')}`, name: `cat${i}` }));
  assert.equal(polls.emojiChoices('cat', many).length, 25);
  assert.equal(polls.emojiChoices('🔥')[0].value, '🔥');
});

test('an emoji image\'s main colour picks its bar colour', () => {
  const pixels = (...runs) => Uint8Array.from(runs.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat()));
  assert.equal(polls.dominantColor(pixels([50, [221, 46, 68, 255]])), 'red');
  // A white emoji with a smaller blue part is blue: colours count for more than white and outlines.
  assert.equal(polls.dominantColor(pixels([60, [250, 250, 250, 255]], [30, [85, 172, 238, 255]], [100, [0, 0, 0, 0]])), 'blue');
  assert.equal(polls.dominantColor(pixels([40, [238, 172, 85, 255]]), { bgra: true }), 'blue', 'BGRA from Electron');
  assert.equal(polls.dominantColor(pixels([40, [139, 69, 19, 255]])), 'brown');
  assert.equal(polls.dominantColor(pixels([10, [0, 0, 0, 0]])), null);
});

test('posting a poll adds the bot\'s reactions in order; editing keeps the votes', async () => {
  const discord = fakeDiscord();
  const poll = polls.normalizePoll(input());
  const first = await polls.publishPoll(discord, poll, null);
  assert.deepEqual(first.counts, [0, 0, 0]);
  const reactions = discord.calls.filter((c) => c.method === 'PUT').map((c) => decodeURIComponent(c.path.split('/reactions/')[1]));
  assert.deepEqual(reactions, ['🔥/@me', 'pepe:500000000000000009/@me', '🎲/@me']);

  discord.react(first.messageId, { name: '🔥' }, ANNA);
  discord.react(first.messageId, PEPE, BEN);
  const saved = { ...poll, messageId: first.messageId };
  const edited = polls.normalizePoll(input({ title: 'Saturday game?', options: [input().options[0], input().options[1]] }));
  const second = await polls.publishPoll(discord, edited, saved);
  assert.equal(second.messageId, first.messageId);
  assert.deepEqual(second.counts, [1, 1]);
  const msg = discord.messages.get(first.messageId);
  assert.equal(msg.embeds[0].title, 'Saturday game?');
  assert.match(msg.embeds[0].description, /🟧{5}⬛{5} \*\*50%\*\* · 1 vote/u);
  assert.ok(discord.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/reactions/${encodeURIComponent('🎲')}/@me`)), 'the removed answer loses the bot\'s reaction');

  // Deleted in Discord: saving posts it again, with no votes.
  discord.messages.delete(first.messageId);
  const third = await polls.publishPoll(discord, edited, { ...edited, messageId: first.messageId });
  assert.notEqual(third.messageId, first.messageId);
  assert.deepEqual(third.counts, [0, 0]);
});

function engineFor(discord, stored, extra = {}) {
  const events = { saved: [], forgot: [], found: [], problems: [] };
  const engine = polls.createPolls({
    rest: discord,
    botId: BOT,
    delayMs: 15,
    pollFor: (id) => stored.find((p) => p.messageId === id) || null,
    discover: (p) => {
      events.found.push(p);
      stored.push({ ...p, id: `found-${events.found.length}` });
    },
    saved: (p, counts) => {
      events.saved.push(counts);
      Object.assign(stored.find((s) => s.id === p.id), { counts, ended: p.ended });
    },
    forget: (p) => events.forgot.push(p.id),
    report: (p, problem) => events.problems.push(problem),
    ...extra,
  });
  return { engine, events };
}

const reaction = (messageId, userId, emoji, extra = {}) => ({ message_id: messageId, channel_id: CH, guild_id: G, user_id: userId, emoji, member: { user: { id: userId } }, message_author_id: BOT, ...extra });

test('votes redraw the bars once per burst, and one-answer polls take back other votes', async () => {
  const discord = fakeDiscord();
  const poll = polls.normalizePoll(input({ multiple: false }));
  const { messageId } = await polls.publishPoll(discord, poll, null);
  const stored = [{ ...poll, id: 'p1', messageId }];
  const { engine, events } = engineFor(discord, stored);
  const patches = () => discord.calls.filter((c) => c.method === 'PATCH').length;

  discord.react(messageId, { name: '🔥' }, ANNA);
  await engine.handle('MESSAGE_REACTION_ADD', reaction(messageId, ANNA, { name: '🔥' }));
  discord.react(messageId, { name: '🎲' }, BEN);
  await engine.handle('MESSAGE_REACTION_ADD', reaction(messageId, BEN, { name: '🎲' }));
  await sleep(60);
  assert.equal(patches(), 1, 'two votes, one edit');
  assert.deepEqual(events.saved.at(-1), [1, 0, 1]);

  // Anna changes her mind: her 🔥 is taken back for her.
  discord.react(messageId, PEPE, ANNA);
  await engine.handle('MESSAGE_REACTION_ADD', reaction(messageId, ANNA, PEPE));
  assert.ok(discord.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/reactions/${encodeURIComponent('🔥')}/${ANNA}`)));
  await sleep(60);
  assert.deepEqual(events.saved.at(-1), [0, 1, 1]);
  assert.match(discord.messages.get(messageId).embeds[0].footer.text, /2 votes/);

  // No change since the last drawing: nothing is edited.
  const before = patches();
  await engine.catchUp(stored);
  assert.equal(patches(), before);

  // Ending draws the final results; later votes are ignored.
  await engine.end(stored[0]);
  assert.equal(discord.messages.get(messageId).embeds[0].footer.text, '📊 2 votes · Poll ended');
  assert.match(discord.messages.get(messageId).embeds[0].description, /🏆/);
  assert.equal(stored[0].ended, true);
  const ended = patches();
  discord.react(messageId, { name: '🔥' }, BEN);
  await engine.handle('MESSAGE_REACTION_ADD', reaction(messageId, BEN, { name: '🔥' }));
  await sleep(60);
  assert.equal(patches(), ended);
});

test('/poll polls are found from their reactions; cleared and deleted polls are handled', async () => {
  const discord = fakeDiscord();
  // Posted by the portal: the app knows nothing about it yet.
  const poll = polls.normalizePoll(input({ by: { name: 'Anna' } }));
  const msg = await discord.request('POST', `/channels/${CH}/messages`, { body: polls.pollMessage(poll) });
  const stored = [];
  const { engine, events } = engineFor(discord, stored);
  discord.react(msg.id, { name: '🔥' }, BEN);
  await engine.handle('MESSAGE_REACTION_ADD', reaction(msg.id, BEN, { name: '🔥' }));
  assert.equal(events.found.length, 1);
  assert.equal(events.found[0].messageId, msg.id);
  assert.equal(events.found[0].guildId, G);
  assert.deepEqual(events.found[0].by, { name: 'Anna', icon: null });
  await sleep(60);
  assert.deepEqual(events.saved.at(-1), [1, 0, 0]);

  // Another of the bot's messages is looked at once, then remembered as not a poll.
  const other = await discord.request('POST', `/channels/${CH}/messages`, { body: { content: 'hello' } });
  for (let i = 0; i < 3; i++) await engine.handle('MESSAGE_REACTION_ADD', reaction(other.id, BEN, { name: '👍' }));
  assert.equal(discord.calls.filter((c) => c.method === 'GET' && c.path.endsWith(other.id)).length, 1);
  // Reactions on other people's messages are never looked at.
  await engine.handle('MESSAGE_REACTION_ADD', reaction('700000000000009999', BEN, { name: '👍' }, { message_author_id: ANNA }));
  assert.ok(!discord.calls.some((c) => c.path.endsWith('700000000000009999')));

  // A mod clears the reactions: the bot puts its own back.
  const puts = discord.calls.filter((c) => c.method === 'PUT').length;
  await engine.handle('MESSAGE_REACTION_REMOVE_ALL', { message_id: msg.id, channel_id: CH, guild_id: G });
  assert.equal(discord.calls.filter((c) => c.method === 'PUT').length, puts + 3);

  engine.handle('MESSAGE_DELETE', { id: msg.id, channel_id: CH, guild_id: G });
  assert.deepEqual(events.forgot, [stored[0].id]);
  // An edit that finds the message gone forgets it too.
  stored.push({ ...poll, id: 'gone', messageId: '700000000000008888' });
  await engine.catchUp([stored.at(-1)]);
  assert.deepEqual(events.forgot, [stored[0].id, 'gone']);
});
