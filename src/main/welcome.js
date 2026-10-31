// Welcome and goodbye messages: when a member joins or leaves, the bot posts your message in the
// channel you picked, with a card drawn for them (src/shared/welcomecard.js). Runs from the bot's
// gateway events while the app is open or in the tray; joins and leaves need the Server Members
// Intent. No Electron here, so it can be tested with fake events.
const WelcomeCard = require('../shared/welcomecard');

// Gateway intents: servers (names and member counts) and members joining and leaving (privileged).
const WELCOME_INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1 };
const MAX_WAITING = 20; // per server; past this (a raid) further joins aren't announced
const CARD_NAME = { welcome: 'welcome.png', goodbye: 'goodbye.png' };

const avatarUrl = (user) => (user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`);

// The {placeholders} for one member.
function varsFor(user, guild) {
  return { user: user.global_name || user.username || 'someone', username: user.username || '', mention: `<@${user.id}>`, server: guild.name || 'the server', count: guild.count ?? null };
}

// The message to post: the text (pinging only the new member, and only if allowed) and the card.
// render(card, vars, user) draws the card and resolves to PNG bytes.
async function greetingMessage(kind, settings, vars, user, render) {
  const content = WelcomeCard.fill(settings.message, vars).slice(0, 2000);
  const body = { content, allowed_mentions: kind === 'welcome' && settings.ping ? { users: [user.id] } : { parse: [] } };
  let problem = null;
  let files;
  if (settings.showCard) {
    try {
      files = [{ name: CARD_NAME[kind], data: await render(settings.card, vars, user), type: 'image/png' }];
    } catch (err) {
      problem = `The card couldn't be drawn, so the message went without it: ${err.message}`;
    }
  }
  if (!body.content && !files) body.content = WelcomeCard.fill(WelcomeCard.DEFAULTS[kind].message, vars); // never an empty message
  return { body, files, problem };
}

// settingsFor(guildId): that server's { welcome, goodbye } (normalized), or null.
// report(guildId, kind, problem): the latest problem (null when posting works).
function createWelcomer({ rest, settingsFor, render, report = () => {} }) {
  const guilds = new Map(); // guild id -> { name, count }
  const queues = new Map(); // guild id -> { waiting, running, skipped }

  const guildOf = (id) => {
    if (!guilds.has(id)) guilds.set(id, { name: '', count: null });
    return guilds.get(id);
  };

  // A server that wasn't in GUILD_CREATE yet: its name and member count from the API.
  async function fillGuild(guildId) {
    const g = guildOf(guildId);
    if (g.name && g.count != null) return g;
    const info = await rest.request('GET', `/guilds/${guildId}`, { query: { with_counts: true } }).catch(() => null);
    if (info) {
      g.name ||= info.name;
      if (g.count == null) g.count = info.approximate_member_count ?? null;
    }
    return g;
  }

  async function post(guildId, kind, user) {
    const settings = settingsFor(guildId)?.[kind];
    if (!settings?.enabled || !settings.channelId) return;
    const guild = await fillGuild(guildId);
    const { body, files, problem } = await greetingMessage(kind, settings, varsFor(user, guild), user, render);
    try {
      await rest.request('POST', `/channels/${settings.channelId}/messages`, { body, files });
      report(guildId, kind, problem);
    } catch (err) {
      report(guildId, kind, err.code === 50013 || err.code === 50001 ? `The bot can't post in #${settings.channelName || 'that channel'}. Give it View Channel, Send Messages and Attach Files there.` : err.message);
    }
  }

  // One message at a time per server, so a burst of joins can't overlap or flood the channel.
  function enqueue(guildId, kind, user) {
    let q = queues.get(guildId);
    if (!q) queues.set(guildId, (q = { waiting: [], running: false, skipped: 0 }));
    if (q.waiting.length >= MAX_WAITING) {
      q.skipped++;
      report(guildId, kind, `Skipped ${q.skipped} ${kind === 'welcome' ? 'welcomes' : 'goodbyes'} during a burst of ${kind === 'welcome' ? 'joins' : 'leaves'} (a raid?).`);
      return;
    }
    q.waiting.push({ kind, user });
    if (!q.running) run(guildId, q);
  }

  async function run(guildId, q) {
    q.running = true;
    while (q.waiting.length) {
      const { kind, user } = q.waiting.shift();
      await post(guildId, kind, user).catch(() => {});
    }
    q.running = false;
    q.skipped = 0;
  }

  function handle(type, d) {
    if (!d) return;
    if (type === 'GUILD_CREATE' || type === 'GUILD_UPDATE') {
      const g = guildOf(d.id);
      if (d.name) g.name = d.name;
      if (d.member_count != null) g.count = d.member_count;
      return;
    }
    if (type !== 'GUILD_MEMBER_ADD' && type !== 'GUILD_MEMBER_REMOVE') return;
    const g = guildOf(d.guild_id);
    const joined = type === 'GUILD_MEMBER_ADD';
    if (g.count != null) g.count = Math.max(0, g.count + (joined ? 1 : -1));
    const kind = joined ? 'welcome' : 'goodbye';
    const settings = settingsFor(d.guild_id)?.[kind];
    if (!settings?.enabled || !d.user || (settings.skipBots && d.user.bot)) return;
    enqueue(d.guild_id, kind, d.user);
  }

  return { handle, guildInfo: fillGuild };
}

module.exports = { createWelcomer, greetingMessage, varsFor, avatarUrl, WELCOME_INTENTS };
