// Tests for tickets with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const tickets = require('../src/main/tickets');

const G = '100000000000000001';
const BOT = '200000000000000000';
const ANNA = { id: '200000000000000005', username: 'anna', global_name: 'Anna', avatar: null };
const MOD = { id: '200000000000000006', username: 'moddy', global_name: 'Moddy' };
const R = { support: '400000000000000001', other: '400000000000000002' };
const C = { panel: '300000000000000001', log: '300000000000000002', category: '300000000000000003' };
const SETTINGS_MSG = '600000000000000001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const settings = (extra = {}) => tickets.normalizeSettings({ guildId: G, panel: { channelId: C.panel }, categoryId: C.category, logChannelId: C.log, supportRoles: [R.support], ...extra });

// Channels with topics and messages, the settings file, and images on a fake CDN.
function fakeDiscord(s = settings(), { failLog = false } = {}) {
  const calls = [];
  const channels = new Map([
    [C.panel, { id: C.panel, type: 0, name: 'support' }],
    [C.log, { id: C.log, type: 0, name: 'ticket-logs' }],
    [C.category, { id: C.category, type: 4, name: 'Tickets' }],
  ]);
  const messages = new Map([[C.log, [{ id: SETTINGS_MSG, attachments: [{ filename: 'ticket-settings.json', url: 'https://cdn.test/settings.json' }] }]]]);
  let next = 700000000000000000n;
  const newId = () => String(next++);
  const files = { 'https://cdn.test/settings.json': JSON.parse(tickets.settingsFile(s).toString()) };
  const fetchImpl = async (url) => {
    if (url in files) return { ok: true, json: async () => files[url] };
    if (url.startsWith('https://cdn.test/img/')) return { ok: true, arrayBuffer: async () => Buffer.from('PNGDATA') };
    return { ok: false, status: 404 };
  };
  const notFound = () => Object.assign(new Error('Unknown'), { status: 404, code: 10008 });
  return {
    calls,
    channels,
    messages,
    fetchImpl,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      let m;
      if (path === `/guilds/${G}`) return { id: G, name: 'Pixel Hangout' };
      if (path === `/guilds/${G}/roles`) return [{ id: R.support, name: 'Support' }];
      if (path === `/guilds/${G}/channels`) {
        if (method === 'GET') return [...channels.values()];
        const ch = { id: newId(), ...opts.body };
        channels.set(ch.id, ch);
        messages.set(ch.id, []);
        return ch;
      }
      if ((m = path.match(/^\/channels\/(\d+)$/))) {
        const ch = channels.get(m[1]);
        if (!ch) throw notFound();
        if (method === 'GET') return { ...ch };
        if (method === 'PATCH') return Object.assign(ch, opts.body);
        if (method === 'DELETE') return channels.delete(m[1]) && null;
      }
      if ((m = path.match(/^\/channels\/(\d+)\/messages$/))) {
        if (failLog && m[1] === C.log && method === 'POST') throw Object.assign(new Error('Missing Access'), { code: 50001 });
        const list = messages.get(m[1]) || [];
        if (method === 'POST') {
          const msg = { id: newId(), timestamp: new Date().toISOString(), author: { id: BOT, username: 'bot', bot: true }, attachments: [], embeds: [], ...opts.body, files: opts.files };
          list.push(msg);
          messages.set(m[1], list);
          return msg;
        }
        return [...list].reverse().slice(0, opts.query?.limit || 50); // newest first, like Discord
      }
      if ((m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) {
        const msg = (messages.get(m[1]) || []).find((x) => x.id === m[2]);
        if (!msg) throw notFound();
        if (method === 'PATCH') return Object.assign(msg, opts.body);
        return msg;
      }
      return {};
    },
  };
}

const press = (customId, member, extra = {}) => ({ type: 3, id: '900', application_id: BOT, token: 'tok', guild_id: G, channel_id: C.panel, member, data: { custom_id: customId }, ...extra });
const anna = { user: ANNA, roles: [], permissions: String(1n << 10n | 1n << 11n) };
const mod = { user: MOD, roles: [R.support], permissions: String(1n << 10n | 1n << 11n) };
const ref = { logChannelId: C.log, settingsId: SETTINGS_MSG };
const id = (action) => `tk:${action}:${C.log}:${SETTINGS_MSG}`;

function engine(discord, extra = {}) {
  return tickets.createTickets({ rest: discord, botId: BOT, fetchImpl: discord.fetchImpl, closeDelayMs: 0, ...extra });
}
const webhookEdits = (discord) => discord.calls.filter((c) => c.path === `/webhooks/${BOT}/tok/messages/@original`);
const whispers = (discord) => discord.calls.filter((c) => c.method === 'POST' && c.path === `/webhooks/${BOT}/tok`).map((c) => c.body);

test('settings are tidied, and the panel carries an open button that names where they live', () => {
  const s = tickets.normalizeSettings({ guildId: G, supportRoles: [R.support, 'nope', R.support], namePrefix: 'Help Desk!!', panel: { button: { label: '', style: 'rainbow', emoji: { id: 'x' } } }, ticket: { color: -1 } });
  assert.deepEqual(s.supportRoles, [R.support]);
  assert.equal(s.namePrefix, 'help-desk');
  assert.deepEqual(s.panel.button, { label: 'Open a ticket', emoji: null, style: 'primary' });
  assert.equal(s.ticket.color, tickets.DEFAULTS.ticket.color);
  const panel = tickets.panelMessage(settings(), ref);
  const button = panel.components[0].components[0];
  assert.equal(button.custom_id, id('open'));
  assert.ok(button.custom_id.length <= 100);
  assert.deepEqual(button.emoji, { name: '🎫' });
  assert.equal(panel.embeds[0].title, 'Need help?');
  assert.deepEqual(tickets.parseCustomId(id('closing')), { action: 'closing', ...ref });
  assert.equal(tickets.parseCustomId('tk:explode:1:2'), null);
});

test('opening a ticket makes a private channel for the member and staff, once per member', async () => {
  const discord = fakeDiscord();
  const t = engine(discord);
  const opened = await t.interaction(press(id('open'), anna));
  assert.deepEqual(opened.response, { type: 5, data: { flags: 64 } }, 'only they see the reply');
  await opened.after();

  const create = discord.calls.find((c) => c.method === 'POST' && c.path === `/guilds/${G}/channels`);
  assert.equal(create.body.name, 'ticket-anna');
  assert.equal(create.body.parent_id, C.category);
  assert.equal(create.body.topic.startsWith(`🎫 Ticket for <@${ANNA.id}>`), true);
  const ow = Object.fromEntries(create.body.permission_overwrites.map((o) => [o.id, o]));
  assert.equal(BigInt(ow[G].deny) & (1n << 10n), 1n << 10n, 'everyone else is shut out');
  assert.equal(ow[ANNA.id].type, 1);
  assert.equal(BigInt(ow[ANNA.id].allow) & tickets.MEMBER_ALLOW, tickets.MEMBER_ALLOW);
  assert.ok(ow[R.support] && ow[BOT], 'support roles and the bot can see it');
  assert.equal(ow[R.other], undefined);

  const channelId = [...discord.channels.values()].find((c) => c.name === 'ticket-anna').id;
  const [welcome] = discord.messages.get(channelId);
  assert.equal(welcome.content, `<@${ANNA.id}> <@&${R.support}>`);
  assert.deepEqual(welcome.allowed_mentions, { users: [ANNA.id], roles: [R.support] });
  assert.equal(welcome.embeds[0].title, 'Thanks for reaching out, Anna!');
  assert.match(welcome.embeds[0].description, /A moderator or the owner will be with you soon/);
  assert.deepEqual(welcome.components[0].components.map((b) => b.custom_id), [id('claim'), id('closeask')]);
  assert.equal(webhookEdits(discord).at(-1).body.content, `🎫 Your ticket is open: <#${channelId}>`);

  // A second press points them at the ticket they already have.
  const again = await t.interaction(press(id('open'), anna));
  await again.after();
  assert.equal(webhookEdits(discord).at(-1).body.content, `You already have a ticket open: <#${channelId}>`);
  assert.equal(discord.calls.filter((c) => c.method === 'POST' && c.path === `/guilds/${G}/channels`).length, 1);
});

test('only staff can claim, and a claim shows on the ticket', async () => {
  const discord = fakeDiscord();
  const t = engine(discord);
  await (await t.interaction(press(id('open'), anna))).after();
  const channelId = [...discord.channels.values()].find((c) => c.name === 'ticket-anna').id;
  const [welcome] = discord.messages.get(channelId);
  const inTicket = (member, action) => press(id(action), member, { channel_id: channelId, message: welcome });

  const denied = await t.interaction(inTicket(anna, 'claim'));
  assert.deepEqual(denied.response, { type: 6 });
  await denied.after();
  assert.equal(whispers(discord).at(-1).content, 'Only staff can claim tickets.');
  assert.equal(whispers(discord).at(-1).flags, 64);

  await (await t.interaction(inTicket(mod, 'claim'))).after();
  const edited = webhookEdits(discord).at(-1).body;
  assert.deepEqual(edited.embeds[0].fields.at(-1), { name: 'Claimed by', value: `<@${MOD.id}>`, inline: true });
  const claim = edited.components[0].components[0];
  assert.equal(claim.disabled, true);
  assert.equal(claim.label, 'Claimed by Moddy');
  assert.match(discord.channels.get(channelId).topic, new RegExp(`claimed by <@${MOD.id}>`));
  assert.match(discord.messages.get(channelId).at(-1).content, /claimed this ticket/);

  await (await t.interaction(inTicket({ ...mod, user: { id: '200000000000000099', username: 'other' } }, 'claim'))).after();
  assert.equal(whispers(discord).at(-1).content, `<@${MOD.id}> already claimed this ticket.`);
});

test('closing asks for a reason, saves a transcript with images to the log, then deletes the ticket', async () => {
  const discord = fakeDiscord();
  const t = engine(discord, { transcriptLink: (log, msg) => `https://portal.test/transcripts/${log}/${msg}?sig=abc` });
  await (await t.interaction(press(id('open'), anna))).after();
  const channelId = [...discord.channels.values()].find((c) => c.name === 'ticket-anna').id;
  const list = discord.messages.get(channelId);
  list.push({ id: '700000000000009001', timestamp: new Date().toISOString(), author: ANNA, content: 'My **order** <script>alert(1)</script> is stuck', attachments: [{ url: 'https://cdn.test/img/a.png', filename: 'a.png', content_type: 'image/png', size: 7 }, { url: 'https://cdn.test/img/huge.png', filename: 'huge.png', content_type: 'image/png', size: 9e6 }, { url: 'https://cdn.test/f/log.txt', filename: 'log.txt', size: 2048 }], embeds: [] });

  const ask = await t.interaction(press(id('closeask'), anna, { channel_id: channelId }));
  assert.equal(ask.response.type, 9);
  assert.equal(ask.response.data.custom_id, id('closing'));

  const submit = { ...press(id('closing'), anna, { channel_id: channelId }), type: 5, data: { custom_id: id('closing'), components: [{ type: 1, components: [{ custom_id: 'reason', value: '  Sorted, thanks!  ' }] }] } };
  const closing = await t.interaction(submit);
  assert.deepEqual(closing.response, { type: 6 });
  await closing.after();

  const log = discord.messages.get(C.log).at(-1);
  assert.equal(log.embeds[0].title, '🎫 Ticket closed · #ticket-anna');
  const fields = Object.fromEntries(log.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.equal(fields['Opened by'], `<@${ANNA.id}>`);
  assert.equal(fields['Closed by'], `<@${ANNA.id}>`);
  assert.equal(fields.Reason, 'Sorted, thanks!');
  assert.equal(fields.Messages, '2');
  assert.equal(log.embeds[0].footer.text, `Ticket ${channelId}`);
  assert.equal(log.files[0].name, 'transcript-ticket-anna.html');
  assert.deepEqual(log.components[0].components[0], { type: 2, style: 5, label: 'View transcript', emoji: { name: '📄' }, url: `https://portal.test/transcripts/${C.log}/${log.id}?sig=abc` });

  const html = log.files[0].data.toString();
  assert.ok(html.includes(`<img class="image" alt="a.png" src="data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}">`), 'images are copied in');
  assert.match(html, /huge\.png.*too large to keep/);
  assert.match(html, /📎 log\.txt \(2 KB\)/);
  assert.ok(html.includes('My <b>order</b> &lt;script&gt;alert(1)&lt;/script&gt; is stuck'), 'escaped, with markdown');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Reason for closing:<\/b> Sorted, thanks!/);
  assert.equal(discord.channels.has(channelId), false, 'the ticket channel is deleted');
});

test('who may close, and a failed log keeps the ticket', async () => {
  const strict = fakeDiscord(settings({ userCanClose: false, askReason: false }), { failLog: true });
  const t = engine(strict);
  await (await t.interaction(press(id('open'), anna))).after();
  const channelId = [...strict.channels.values()].find((c) => c.name === 'ticket-anna').id;
  const [welcome] = strict.messages.get(channelId);
  assert.equal(welcome.components[0].components[1].custom_id, id('close'), 'no reason asked');
  assert.deepEqual(welcome.allowed_mentions.roles, [R.support]);

  await (await t.interaction(press(id('close'), anna, { channel_id: channelId }))).after();
  assert.equal(whispers(strict).at(-1).content, 'Only staff can close this ticket.');
  await (await t.interaction(press(id('close'), mod, { channel_id: channelId }))).after();
  assert.ok(strict.channels.has(channelId), 'kept when the transcript could not be saved');
  assert.match(strict.messages.get(channelId).at(-1).content, /transcript couldn't be saved.*missing permissions.*stays open/s);
});

test('a panel whose settings are gone explains what to do', async () => {
  const discord = fakeDiscord();
  discord.messages.set(C.log, []);
  const opened = await engine(discord).interaction(press(id('open'), anna));
  await opened.after();
  assert.match(webhookEdits(discord).at(-1).body.content, /^✗ This ticket panel's settings are gone/);
  assert.equal(await engine(discord).interaction(press('poll:vote:1', anna)), null, 'other buttons are left alone');
});

test('transcripts show who said what, and links to them are signed', () => {
  const at = (min) => new Date(Date.UTC(2026, 9, 30, 12, min)).toISOString();
  const html = tickets.buildTranscript({
    guildName: 'Pixel <Hangout>',
    channelName: 'ticket-anna',
    messages: [
      { author: ANNA, timestamp: at(0), content: 'hi <@200000000000000006> see <#300000000000000001>', mentions: [MOD] },
      { author: ANNA, timestamp: at(2), content: '```js\nlet x = 1 < 2;\n```' },
      { author: MOD, timestamp: at(3), content: '||spoiler|| ~~no~~ <:pepe:500000000000000009> https://example.com/a?b=1&c=2' },
    ],
    names: { users: {}, roles: {}, channels: { '300000000000000001': 'support' } },
    meta: { openerId: ANNA.id, closedBy: MOD.id, openedAt: at(0), closedAt: at(5) },
  });
  assert.match(html, /<title>#ticket-anna · Pixel &lt;Hangout&gt;<\/title>/);
  assert.equal(html.match(/class="group"/g).length, 2, 'Anna\'s two messages share a header');
  assert.match(html, /<span class="mention">@Moddy<\/span> see <span class="mention">#support<\/span>/);
  assert.match(html, /<pre>let x = 1 &lt; 2;<\/pre>/);
  assert.match(html, /<span class="spoiler">spoiler<\/span> <s>no<\/s> <img class="emoji"/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noreferrer noopener"/);
  assert.match(html, /<b>Opened by<\/b>@Anna/);
  assert.match(html, /2026-10-30 12:00 UTC/);

  const sig = tickets.transcriptSignature('s'.repeat(32), C.log, '700000000000000001');
  assert.equal(tickets.checkTranscriptSignature('s'.repeat(32), C.log, '700000000000000001', sig), true);
  assert.equal(tickets.checkTranscriptSignature('s'.repeat(32), C.log, '700000000000000002', sig), false);
  assert.equal(tickets.checkTranscriptSignature('s'.repeat(32), C.log, '700000000000000001', 'nope'), false);
});
