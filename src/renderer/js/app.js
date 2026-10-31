// App state, routing, the bot rail and startup.

const App = {
  bots: [],
  presence: {}, // botId -> { state, detail }
  route: { page: 'home' },
  views: {}, // botId -> per-bot page state (kept while switching between bots)
  savedTemplates: [],

  bot(botId) {
    return this.bots.find((b) => b.id === botId);
  },

  view(botId) {
    if (!this.views[botId]) this.views[botId] = { guilds: null, guildsError: null, loadingGuilds: false, guildId: null, tab: 'overview', servers: {} };
    return this.views[botId];
  },

  server(botId, guildId) {
    const view = this.view(botId);
    if (!view.servers[guildId]) view.servers[guildId] = { memberQuery: '', memberRole: '', memberLimit: 200 };
    return view.servers[guildId];
  },

  isShowing(botId, guildId) {
    if (this.route.page !== 'bot' || this.route.botId !== botId) return false;
    return guildId === undefined || this.view(botId).guildId === guildId;
  },

  go(route) {
    this.route = route;
    this.render();
  },

  render() {
    this.renderRail();
    this.renderPage();
  },

  renderPage() {
    const bot = this.route.page === 'bot' ? this.bot(this.route.botId) : null;
    if (this.route.page === 'bot' && !bot) this.route = { page: 'home' };
    let content;
    if (bot) content = BotPage.render(bot);
    else if (this.route.page === 'settings') content = SettingsPage.render();
    else if (Community.has(this.route.page)) content = Community.render(this.route.page);
    else content = HomePage.render();
    document.getElementById('page').replaceChildren(content);
    this.renderCrumb();
  },

  // Re-render only the right-hand side of a bot page, keeping its scroll position.
  renderMain() {
    const main = document.getElementById('bot-main');
    const bot = this.bot(this.route.botId);
    if (!main || !bot) return this.renderPage();
    const scroll = main.scrollTop;
    main.replaceChildren(BotPage.mainContent(bot, this.view(bot.id)));
    main.scrollTop = scroll;
    this.renderCrumb();
  },

  renderCrumb() {
    const crumb = document.getElementById('crumb');
    crumb.replaceChildren();
    if (this.route.page === 'settings') return crumb.append(h('b', null, 'Settings'));
    if (Community.has(this.route.page)) return crumb.append('Community › ', h('b', null, Community.label(this.route.page)));
    if (this.route.page !== 'bot') return;
    const bot = this.bot(this.route.botId);
    const view = this.view(bot.id);
    const guild = view.guilds?.find((g) => g.id === view.guildId);
    crumb.append(h('b', null, displayName(bot)));
    if (guild) crumb.append(' › ', guild.name);
  },

  isMod(botId) {
    return this.bot(botId)?.type === 'mod';
  },

  presenceClass(botId) {
    if (this.isMod(botId)) return 'mod';
    const p = this.presence[botId] || { state: 'offline' };
    if (p.state === 'online') return this.bot(botId)?.presence?.status || 'online';
    if (p.state === 'invisible') return 'offline';
    return p.state;
  },

  presenceLabel(botId) {
    if (this.isMod(botId)) {
      const portalBot = this.bot(botId).portalBot;
      return portalBot ? `Moderator · via ${displayName(portalBot)}` : 'Moderator';
    }
    const p = this.presence[botId] || { state: 'offline' };
    const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', connecting: 'Connecting…', error: 'Error', offline: 'Offline' };
    if (p.state === 'error') return p.detail || 'Error';
    if (p.state === 'invisible') return 'Invisible · running your server features';
    return labels[this.presenceClass(botId)] || 'Offline';
  },

  updatePresence(botId) {
    for (const el of document.querySelectorAll(`[data-presence="${botId}"]`)) el.className = `status-dot ${this.presenceClass(botId)}`;
    for (const el of document.querySelectorAll(`[data-presence-text="${botId}"]`)) el.textContent = this.presenceLabel(botId);
  },

  upsertBot(bot) {
    const i = this.bots.findIndex((b) => b.id === bot.id);
    if (i >= 0) this.bots[i] = bot;
    else this.bots.push(bot);
  },

  renderRail() {
    const rail = document.getElementById('rail');
    const isHome = this.route.page === 'home';
    const item = (cls, tip, btn, active) => h('div', { class: `rail-item ${cls} ${active ? 'active' : ''}`, 'data-tip': tip }, btn);

    const botItems = this.bots.map((bot) => {
      const el = item(
        '',
        bot.type === 'mod' ? `${displayName(bot)} (moderator)` : displayName(bot),
        h('button', { class: 'rail-btn', onclick: () => this.go({ page: 'bot', botId: bot.id }) }, h('img', { src: userAvatar(bot), alt: '' })),
        this.route.page === 'bot' && this.route.botId === bot.id,
      );
      el.append(h('span', { class: `status-dot ${this.presenceClass(bot.id)}`, 'data-presence': bot.id }));
      el.draggable = true;
      el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/bot', bot.id));
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData('text/bot');
        if (!dragged || dragged === bot.id) return;
        const ids = this.bots.map((b) => b.id).filter((id) => id !== dragged);
        ids.splice(ids.indexOf(bot.id), 0, dragged);
        this.bots.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        api('bots:reorder', ids).catch(toastError);
        this.renderRail();
      });
      return el;
    });

    rail.replaceChildren(
      item('rail-home', 'Home', h('button', { class: 'rail-btn', onclick: () => this.go({ page: 'home' }) }, icon('home')), isHome),
      item('rail-community', 'Community: welcome cards, reaction roles, tickets, polls, server stats and social alerts', h('button', { class: 'rail-btn', onclick: () => this.go({ page: Community.last }) }, icon('grid')), Community.has(this.route.page)),
      h('div', { class: 'rail-sep' }),
      ...botItems,
      item(
        'rail-add',
        'Add a bot',
        h('button', {
          class: 'rail-btn',
          onclick: () => {
            this.go({ page: 'home' });
            document.getElementById('token-input')?.focus();
          },
        }, icon('plus')),
        false,
      ),
      h('div', { class: 'rail-spacer' }),
      item('rail-settings', 'Settings', h('button', { class: 'rail-btn', onclick: () => this.go({ page: 'settings' }) }, icon('settings')), this.route.page === 'settings'),
    );
  },
};

async function init() {
  onEvent('presence:state', ({ botId, state, detail }) => {
    App.presence[botId] = { state, detail };
    App.updatePresence(botId);
    if (state === 'error') toast(`${displayName(App.bot(botId))}: ${detail}`, 'error');
  });
  onEvent('builder:event', (event) => Builder.onEvent(event));

  try {
    [App.bots, App.savedTemplates] = await Promise.all([api('bots:list'), api('templates:list')]);
  } catch (err) {
    toastError(err);
  }
  // Presence events can arrive before the bot list does; keep whichever state is newer.
  for (const bot of App.bots) App.presence[bot.id] ??= { state: bot.presence?.enabled ? 'connecting' : 'offline' };
  App.render();
  if (Theme.settings.checkUpdates) setTimeout(() => Updater.check({ silent: true }), 2500);
}

init();
