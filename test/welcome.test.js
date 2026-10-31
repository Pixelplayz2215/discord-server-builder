// Tests for welcome and goodbye cards with fake events and a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const WelcomeCard = require('../src/shared/welcomecard');
const { createWelcomer, varsFor } = require('../src/main/welcome');
const { DiscordRest } = require('../src/main/discord');

const G = '100000000000000001';
const CH = '300000000000000001';
const ANNA = { id: '200000000000000005', username: 'anna', global_name: 'Anna', avatar: null };
const PNG = Buffer.from('fake png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('placeholders fill in, and a mention in the card shows as @name', () => {
  const vars = varsFor(ANNA, { name: 'Pixel Hangout', count: 1234 });
  assert.deepEqual(vars, { user: 'Anna', username: 'anna', mention: '<@200000000000000005>', server: 'Pixel Hangout', count: 1234 });
  assert.equal(WelcomeCard.fill('Hey {mention}, welcome to **{server}**! You are #{count}. {nope}', vars), 'Hey <@200000000000000005>, welcome to **Pixel Hangout**! You are #1,234. {nope}');
  assert.equal(WelcomeCard.fill('Hi {mention}', vars, { inImage: true }), 'Hi @Anna');
  assert.equal(WelcomeCard.fill('#{count}', { ...vars, count: null }), '#?');
});

test('settings are tidied, with defaults for anything missing or wrong', () => {
  const k = WelcomeCard.normalizeKind({ enabled: 1, channelId: 'x', ping: false, card: { layout: 'diagonal', font: 'Wingdings', ring: 'red', background: { type: 'image', image: '../../evil.png', darken: 5 }, title: { text: 'Yo {user}', color: '#ABCDEF' } } }, 'welcome');
  assert.equal(k.enabled, true);
  assert.equal(k.channelId, '');
  assert.equal(k.ping, false);
  assert.equal(k.card.layout, 'center');
  assert.equal(k.card.font, 'Poppins');
  assert.equal(k.card.ring, '#ffffff');
  assert.equal(k.card.background.image, '', 'only plain file names from the app');
  assert.equal(k.card.background.darken, 0.85);
  assert.deepEqual(k.card.title, { text: 'Yo {user}', color: '#abcdef', size: 1 });
  assert.equal(WelcomeCard.normalizeKind({ ping: true }, 'goodbye').ping, false, 'nobody is pinged when they leave');
  const retro = WelcomeCard.applyPreset(k.card, 'retro');
  assert.equal(retro.font, 'Silkscreen');
  assert.equal(retro.background.type, 'color');
  assert.equal(retro.title.text, 'Yo {user}', 'a style keeps your words');
});

// Records what the card drawing does, measuring text as 10px per character.
function fakeCanvas() {
  const texts = [];
  const ctx = new Proxy(
    { texts, measureText: (t) => ({ width: t.length * 10 }), fillText: (t, x, y) => texts.push({ t, x, y, align: ctx.textAlign, font: ctx.font, fill: ctx.fillStyle }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => ((target[key] = value), true) },
  );
  return ctx;
}

test('the card shows the filled-in text, shrinking or cutting what is too long', () => {
  const card = WelcomeCard.normalizeCard({ title: { text: 'Welcome, {user}!', color: '#ff0000' }, subtitle: { text: 'Member #{count} of {server}' } });
  const ctx = fakeCanvas();
  WelcomeCard.draw(ctx, card, { user: 'Anna', server: 'Pixel Hangout', count: 42 }, {});
  assert.deepEqual(ctx.texts.map((t) => t.t), ['Welcome, Anna!', 'Member #42 of Pixel Hangout']);
  assert.equal(ctx.texts[0].fill, '#ff0000');
  assert.equal(ctx.texts[0].align, 'center');
  assert.equal(ctx.texts[0].x, WelcomeCard.WIDTH / 2);

  const left = fakeCanvas();
  WelcomeCard.draw(left, { ...card, layout: 'left', title: { text: `Welcome, ${'x'.repeat(200)}`, color: '#fff' } }, {}, {});
  assert.equal(left.texts[0].align, 'left');
  assert.ok(left.texts[0].t.endsWith('…'), 'cut to fit');
  assert.ok(left.texts[0].t.length * 10 <= WelcomeCard.WIDTH - 380 - 56);
  assert.match(left.texts[0].font, /^800 26px "Poppins"/, 'shrunk to the smallest size first');
});

function fakeDiscord({ failPost = null } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      if (path === `/guilds/${G}`) return { id: G, name: 'From API', approximate_member_count: 99 };
      if (method === 'POST' && failPost) throw Object.assign(new Error('Missing Permissions'), { code: failPost });
      return { id: '1' };
    },
  };
}

function setup({ welcome = {}, goodbye = {}, render = async () => PNG, failPost } = {}) {
  const discord = fakeDiscord({ failPost });
  const problems = [];
  const settings = { welcome: WelcomeCard.normalizeKind({ enabled: true, channelId: CH, channelName: 'welcome', ...welcome }, 'welcome'), goodbye: WelcomeCard.normalizeKind({ enabled: true, channelId: CH, ...goodbye }, 'goodbye') };
  const welcomer = createWelcomer({ rest: discord, settingsFor: (g) => (g === G ? settings : null), render, report: (g, kind, p) => problems.push([kind, p]) });
  const posts = () => discord.calls.filter((c) => c.method === 'POST');
  return { discord, welcomer, problems, posts };
}

test('a new member gets a welcome with their card; a leaver gets a goodbye; counts follow along', async () => {
  const rendered = [];
  const { welcomer, posts, problems } = setup({ render: async (card, vars, user) => (rendered.push({ card, vars, user }), PNG) });
  welcomer.handle('GUILD_CREATE', { id: G, name: 'Pixel Hangout', member_count: 10 });
  welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA });
  welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: { id: '200000000000000009', username: 'beep', bot: true } });
  welcomer.handle('GUILD_MEMBER_REMOVE', { guild_id: G, user: ANNA });
  welcomer.handle('GUILD_MEMBER_ADD', { guild_id: '100000000000000777', user: ANNA }); // another server, no settings
  await sleep(20);
  const [hello, bye] = posts();
  assert.equal(posts().length, 2, 'bots are skipped');
  assert.equal(hello.path, `/channels/${CH}/messages`);
  assert.equal(hello.body.content, 'Hey <@200000000000000005>, welcome to **Pixel Hangout**! 🎉');
  assert.deepEqual(hello.body.allowed_mentions, { users: [ANNA.id] }, 'only the new member is pinged');
  assert.deepEqual(hello.files, [{ name: 'welcome.png', data: PNG, type: 'image/png' }]);
  assert.equal(rendered[0].vars.count, 11, 'the bot that joined counts too');
  assert.equal(rendered[0].card.title.text, 'Welcome, {user}!');
  assert.equal(bye.body.content, '**Anna** left the server. 👋');
  assert.deepEqual(bye.body.allowed_mentions, { parse: [] });
  assert.equal(bye.files[0].name, 'goodbye.png');
  assert.equal(rendered[1].vars.count, 11);
  assert.deepEqual(problems, [['welcome', null], ['goodbye', null]]);
});

test('without a card or ping, after a drawing problem, and when the bot can\'t post', async () => {
  const plain = setup({ welcome: { showCard: false, ping: false, message: '' } });
  plain.welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA });
  await sleep(20);
  const [msg] = plain.posts();
  assert.equal(msg.files, undefined);
  assert.equal(msg.body.content, 'Hey <@200000000000000005>, welcome to **From API**! 🎉', 'never empty; the server name comes from Discord when it isn\'t known yet');
  assert.deepEqual(msg.body.allowed_mentions, { parse: [] });

  const broken = setup({ render: async () => { throw new Error('no window'); } });
  broken.welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA });
  await sleep(20);
  assert.equal(broken.posts()[0].files, undefined, 'still welcomed, without the card');
  assert.match(broken.problems[0][1], /card couldn't be drawn.*no window/);

  const blocked = setup({ failPost: 50013 });
  blocked.welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: ANNA });
  await sleep(20);
  assert.match(blocked.problems[0][1], /can't post in #welcome\. Give it View Channel, Send Messages and Attach Files/);
});

test('a burst of joins is posted one at a time, and a raid past the limit is skipped', async () => {
  let drawing = 0;
  let most = 0;
  const { welcomer, posts, problems } = setup({
    render: async () => {
      most = Math.max(most, ++drawing);
      await sleep(1);
      drawing--;
      return PNG;
    },
  });
  for (let i = 0; i < 30; i++) welcomer.handle('GUILD_MEMBER_ADD', { guild_id: G, user: { ...ANNA, id: `2000000000000001${String(i).padStart(2, '0')}` } });
  for (let i = 0; i < 300 && posts().length < 21; i++) await sleep(10);
  await sleep(50); // and nothing more after that
  assert.equal(most, 1, 'one at a time');
  assert.equal(posts().length, 21, 'the first, plus 20 waiting');
  assert.ok(problems.some(([, p]) => /Skipped 9 welcomes during a burst of joins/.test(p || '')));
});

test('files are sent as a multipart form with the message as payload_json', async () => {
  const realFetch = global.fetch;
  let sent;
  global.fetch = async (url, opts) => {
    sent = { url, opts };
    return new Response(JSON.stringify({ id: '1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await new DiscordRest('token').request('POST', `/channels/${CH}/messages`, { body: { content: 'hi' }, files: [{ name: 'welcome.png', data: PNG, type: 'image/png' }] });
  } finally {
    global.fetch = realFetch;
  }
  assert.ok(sent.opts.body instanceof FormData);
  assert.equal(sent.opts.headers['Content-Type'], undefined, 'fetch sets the multipart type itself');
  assert.deepEqual(JSON.parse(sent.opts.body.get('payload_json')), { content: 'hi', attachments: [{ id: 0, filename: 'welcome.png' }] });
  const file = sent.opts.body.get('files[0]');
  assert.equal(file.name, 'welcome.png');
  assert.equal(file.type, 'image/png');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'fake png');
});

test('card text is customizable: an optional third line, and a size for each line', () => {
  const card = WelcomeCard.normalizeCard({ title: { text: 'Hi {user}', size: 1.4 }, subtitle: { text: 'Member #{count}', size: 0.1 }, extra: { text: 'Read #rules, {user}', color: '#00FF00', size: 'big' } });
  assert.deepEqual([card.title.size, card.subtitle.size, card.extra.size], [1.4, 0.6, 1], 'sizes stay between 60% and 140%');
  const ctx = fakeCanvas();
  WelcomeCard.draw(ctx, card, { user: 'Anna', count: 7 }, {});
  assert.deepEqual(ctx.texts.map((t) => t.t), ['Hi Anna', 'Member #7', 'Read #rules, Anna']);
  assert.match(ctx.texts[0].font, /^800 81px /, 'big text at 140%');
  assert.match(ctx.texts[1].font, /^600 19px /, 'small text at 60%');
  assert.match(ctx.texts[2].font, /^500 26px /);
  assert.equal(ctx.texts[2].fill, '#00ff00');
  assert.ok(ctx.texts[0].y < ctx.texts[1].y && ctx.texts[1].y < ctx.texts[2].y && ctx.texts[2].y < WelcomeCard.HEIGHT);
  // An empty third line isn't drawn, and the other two keep their places.
  const two = fakeCanvas();
  WelcomeCard.draw(two, { ...card, extra: { text: '  ', color: '#fff', size: 1 } }, { user: 'Anna', count: 7 }, {});
  assert.equal(two.texts.length, 2);
  assert.equal(two.texts[0].y, 318);
});
