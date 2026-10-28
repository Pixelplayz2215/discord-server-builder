// Per-bot page: sidebar with the bot's servers, and the bot dashboard.

const INVITE_PRESETS = [
  ['8', 'Administrator (recommended)'],
  [String((1n << 28n) | (1n << 4n) | (1n << 5n) | (1n << 1n) | (1n << 2n) | (1n << 40n) | (1n << 13n) | (1n << 7n) | (1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 27n)), 'Builder + moderation (no admin)'],
  [String((1n << 1n) | (1n << 2n) | (1n << 40n) | (1n << 13n) | (1n << 7n) | (1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 27n)), 'Moderation only'],
];

const inviteUrl = (bot, permissions) =>
  `https://discord.com/oauth2/authorize?client_id=${bot.appId || bot.id}&permissions=${permissions}&scope=bot%20applications.commands`;

const BotPage = {
  render(bot) {
    const view = App.view(bot.id);
    if (!view.guilds && !view.loadingGuilds) BotPage.loadGuilds(bot.id);
    return h('div', { class: 'bot-layout' }, BotPage.sidebar(bot, view), h('div', { class: 'bot-main', id: 'bot-main' }, BotPage.mainContent(bot, view)));
  },

  mainContent(bot, view) {
    return view.guildId ? ServerPage.render(bot, view) : BotPage.dashboard(bot, view);
  },

  async loadGuilds(botId) {
    const view = App.view(botId);
    view.loadingGuilds = true;
    try {
      view.guilds = await rest(botId, 'GET', '/users/@me/guilds', { query: { with_counts: true } });
      view.guildsError = null;
    } catch (err) {
      view.guildsError = err.message;
      view.guilds = view.guilds || [];
    } finally {
      view.loadingGuilds = false;
    }
    if (App.isShowing(botId)) {
      BotPage.renderSidebar(botId);
      if (!view.guildId) App.renderMain();
    }
  },

  renderSidebar(botId) {
    const side = document.getElementById('bot-side');
    if (side) side.replaceWith(BotPage.sidebar(App.bot(botId), App.view(botId)));
  },

  openGuild(botId, guildId) {
    const view = App.view(botId);
    view.guildId = guildId;
    BotPage.renderSidebar(botId);
    App.renderMain();
    document.getElementById('bot-main')?.scrollTo(0, 0);
  },

  sidebar(bot, view) {
    const refreshBtn = h('button', { class: 'icon-btn', title: 'Refresh servers' }, icon('refresh'));
    refreshBtn.addEventListener('click', () => BotPage.loadGuilds(bot.id));

    let servers;
    if (!view.guilds) servers = [1, 2, 3].map(() => h('div', { class: 'skeleton', style: { height: '44px', margin: '2px 0' } }));
    else if (!view.guilds.length) servers = h('div', { class: 'subtle', style: { padding: '8px 10px', fontSize: '12px' } }, view.guildsError || 'Not in any servers yet — invite it below.');
    else {
      servers = view.guilds.map((g) =>
        h(
          'button',
          { class: `side-item ${view.guildId === g.id ? 'active' : ''}`, onclick: () => BotPage.openGuild(bot.id, g.id) },
          guildIcon(g, 32),
          h('span', { class: 'ellipsis' }, g.name),
          h('span', { class: 'count' }, fmtNum(g.approximate_member_count)),
        ),
      );
    }

    return h(
      'aside',
      { class: 'bot-side', id: 'bot-side' },
      h(
        'div',
        { class: 'bot-id-card' },
        h(
          'div',
          { class: 'who' },
          h(
            'div',
            { class: 'avatar-wrap' },
            h('img', { class: 'avatar', src: userAvatar(bot), width: 44, height: 44, alt: '' }),
            h('span', { class: `status-dot ${App.presenceClass(bot.id)}`, 'data-presence': bot.id }),
          ),
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'name ellipsis' }, displayName(bot)),
            h('div', { class: 'tag ellipsis', 'data-presence-text': bot.id }, App.presenceLabel(bot.id)),
          ),
        ),
      ),
      h(
        'nav',
        { class: 'side-nav' },
        h(
          'button',
          { class: `side-item ${!view.guildId ? 'active' : ''}`, onclick: () => BotPage.openGuild(bot.id, null) },
          icon('bot'),
          h('span', null, 'Bot dashboard'),
        ),
        h('div', { class: 'side-label' }, `Servers — ${view.guilds ? view.guilds.length : '…'}`, refreshBtn),
        servers,
      ),
      h(
        'div',
        { class: 'side-foot' },
        h('button', { class: 'btn teal', onclick: () => openExternal(inviteUrl(bot, '8')) }, icon('userPlus'), 'Invite to a server'),
      ),
    );
  },

  dashboard(bot, view) {
    const guilds = view.guilds || [];
    const totalMembers = guilds.reduce((sum, g) => sum + (g.approximate_member_count || 0), 0);
    const intents = bot.intents || {};

    return h(
      'div',
      { class: 'content stack', style: { gap: '18px' } },
      h(
        'div',
        { class: 'row' },
        h('img', { class: 'avatar', src: userAvatar(bot, 256), width: 72, height: 72, alt: '' }),
        h(
          'div',
          { class: 'grow' },
          h('span', { class: 'eyebrow' }, 'Bot dashboard'),
          h('h2', { style: { fontSize: '28px', marginTop: '6px' } }, displayName(bot)),
          h(
            'div',
            { class: 'row wrap', style: { marginTop: '6px', gap: '6px' } },
            h('span', { class: 'badge' }, `@${bot.username}`),
            h('span', { class: 'badge peri mono', style: { cursor: 'pointer' }, title: 'Copy ID', onclick: () => copyText(bot.id, 'Bot ID copied') }, bot.id),
            bot.publicBot === true ? h('span', { class: 'badge gold' }, 'Public bot') : null,
          ),
        ),
      ),

      h(
        'div',
        { class: 'grid cols-4' },
        BotPage.stat(view.guilds ? guilds.length : '…', 'Servers'),
        BotPage.stat(view.guilds ? fmtNum(totalMembers) : '…', 'Members reached'),
        BotPage.stat([intents.members, intents.content, intents.presence].filter(Boolean).length + '/3', 'Intents enabled'),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value', style: { fontSize: '18px', paddingTop: '6px' }, 'data-presence-text': bot.id }, App.presenceLabel(bot.id)), h('div', { class: 'stat-label' }, 'Status')),
      ),

      h('div', { class: 'grid cols-2' }, BotPage.presenceCard(bot), BotPage.intentsCard(bot)),

      BotPage.inviteCard(bot),

      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, icon('server'), h('h3', null, 'Servers')),
        !view.guilds
          ? h('div', { class: 'loading-block' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))
          : guilds.length
            ? h(
                'div',
                { class: 'grid cols-3' },
                guilds.map((g) =>
                  h(
                    'div',
                    { class: 'card bot-card', style: { padding: '14px' }, onclick: () => BotPage.openGuild(bot.id, g.id) },
                    guildIcon(g, 48),
                    h(
                      'div',
                      { class: 'grow' },
                      h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, g.name),
                      h('div', { class: 'subtle', style: { fontSize: '12px' } }, `${fmtNum(g.approximate_member_count)} members${g.owner ? ' · bot owns it' : ''}`),
                    ),
                  ),
                ),
              )
            : h(
                'div',
                { class: 'empty' },
                icon('server'),
                h('h3', null, 'No servers yet'),
                h('p', null, view.guildsError || 'Invite the bot to a server you manage. It will appear here.'),
                h('button', { class: 'btn teal', onclick: () => openExternal(inviteUrl(bot, '8')) }, icon('userPlus'), 'Invite to a server'),
              ),
      ),

      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, icon('alert'), h('h3', null, 'Remove this bot')),
        h(
          'div',
          { class: 'row' },
          h('p', { class: 'muted grow' }, 'Forget the token and remove this bot from the app. The bot stays in its servers.'),
          h('button', { class: 'btn danger', onclick: () => BotPage.removeBot(bot) }, icon('trash'), 'Remove bot'),
        ),
      ),
    );
  },

  stat(value, label) {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
  },

  presenceCard(bot) {
    const presence = { enabled: true, status: 'online', text: '', ...bot.presence };
    const textInput = h('input', { class: 'input', placeholder: 'e.g. Building servers ✨', maxlength: 128, value: presence.text || '' });
    const statusSelect = selectEl([['online', '🟢 Online'], ['idle', '🌙 Idle'], ['dnd', '⛔ Do Not Disturb']], presence.status, null);
    const save = async (enabled) => {
      const next = { enabled, status: statusSelect.value, text: textInput.value.trim() };
      try {
        const updated = await api('presence:set', bot.id, next);
        App.upsertBot(updated);
        App.presence[bot.id] = { state: enabled ? (App.presence[bot.id]?.state === 'online' ? 'online' : 'connecting') : 'offline' };
        App.updatePresence(bot.id);
        toast(enabled ? 'Presence updated' : 'Bot set offline');
      } catch (err) {
        toastError(err);
      }
    };
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('power'), h('h3', null, 'Online presence'), switchEl(presence.enabled, (on) => save(on))),
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Keeps the bot showing as online in Discord while this app is open.'),
        h('div', { class: 'grid cols-2', style: { gap: '10px' } }, field('Status', statusSelect), field('Custom status', textInput)),
        h('div', null, h('button', { class: 'btn', onclick: () => save(true) }, icon('check'), 'Apply')),
      ),
    );
  },

  intentsCard(bot) {
    const intents = bot.intents || {};
    const row = (on, name, why) =>
      h(
        'div',
        { class: 'row', style: { padding: '6px 0' } },
        h('span', { class: `badge ${on ? 'teal' : 'coral'}` }, icon(on ? 'check' : 'x'), on ? 'On' : 'Off'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, name), h('div', { class: 'subtle', style: { fontSize: '12px' } }, why)),
      );
    const recheck = h('button', { class: 'btn sm' }, icon('refresh'), 'Re-check');
    recheck.addEventListener(
      'click',
      withBusy(recheck, async () => {
        App.upsertBot(await api('bots:refresh', bot.id));
        App.renderMain();
        App.renderRail();
        toast('Bot info refreshed');
      }),
    );
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('shield'), h('h3', null, 'Privileged intents'), recheck),
      row(intents.members, 'Server Members Intent', 'Required for the Members list.'),
      row(intents.content, 'Message Content Intent', 'Optional — only for reading message text.'),
      row(intents.presence, 'Presence Intent', 'Optional — online status of members.'),
      h(
        'div',
        { style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => openExternal(`https://discord.com/developers/applications/${bot.appId || bot.id}/bot`) }, icon('external'), 'Open bot settings'),
      ),
    );
  },

  inviteCard(bot) {
    const urlInput = h('input', { class: 'input mono', readonly: true, value: inviteUrl(bot, '8') });
    const perms = selectEl(INVITE_PRESETS, '8', (value) => (urlInput.value = inviteUrl(bot, value)));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('link'), h('h3', null, 'Invite link')),
      h(
        'div',
        { class: 'row' },
        h('div', { style: { width: '280px', flexShrink: 0 } }, perms),
        h('div', { class: 'grow' }, urlInput),
        h('button', { class: 'btn', onclick: () => copyText(urlInput.value, 'Invite link copied') }, icon('copy'), 'Copy'),
        h('button', { class: 'btn teal', onclick: () => openExternal(urlInput.value) }, icon('external'), 'Open'),
      ),
    );
  },

  async removeBot(bot) {
    const ok = await confirmDialog({
      title: `Remove ${displayName(bot)}?`,
      message: 'The saved token is deleted from this PC. You can add the bot again later with its token.',
      confirmLabel: 'Remove bot',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('bots:remove', bot.id);
      App.bots = App.bots.filter((b) => b.id !== bot.id);
      delete App.views[bot.id];
      delete App.presence[bot.id];
      App.go({ page: 'home' });
      toast('Bot removed');
    } catch (err) {
      toastError(err);
    }
  },
};
