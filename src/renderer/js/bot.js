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
    if (view.guildId) return ServerPage.render(bot, view);
    return bot.type === 'mod' ? BotPage.modDashboard(bot, view) : BotPage.dashboard(bot, view);
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

    const mod = bot.type === 'mod';
    let servers;
    if (!view.guilds) servers = [1, 2, 3].map(() => h('div', { class: 'skeleton', style: { height: '44px', margin: '2px 0' } }));
    else if (!view.guilds.length) {
      const empty = mod ? 'You aren\'t a moderator in any server this bot is in.' : 'Not in any servers yet — invite it below.';
      servers = h('div', { class: 'subtle', style: { padding: '8px 10px', fontSize: 'calc(12rem / 14)' } }, view.guildsError || empty);
    }
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
          icon(mod ? 'shield' : 'bot'),
          h('span', null, mod ? 'My mod account' : 'Bot dashboard'),
        ),
        h('div', { class: 'side-label' }, `Servers — ${view.guilds ? view.guilds.length : '…'}`, refreshBtn),
        servers,
      ),
      h(
        'div',
        { class: 'side-foot' },
        mod
          ? h('button', { class: 'btn', onclick: () => BotPage.removeBot(bot) }, icon('logOut'), 'Sign out')
          : h('button', { class: 'btn teal', onclick: () => openExternal(inviteUrl(bot, '8')) }, icon('userPlus'), 'Invite to a server'),
      ),
    );
  },

  // Dashboard for a moderator who signed in through a mod portal (no bot token on this PC).
  modDashboard(bot, view) {
    const guilds = view.guilds || [];
    const portalBot = bot.portalBot;
    const recheck = h('button', { class: 'btn sm' }, icon('refresh'), 'Check sign-in');
    recheck.addEventListener(
      'click',
      withBusy(recheck, async () => {
        App.upsertBot(await api('bots:refresh', bot.id));
        App.render();
        toast('Still signed in');
      }),
    );
    const rule = (ic, text) => h('div', { class: 'row', style: { alignItems: 'flex-start', padding: '4px 0' } }, h('span', { class: 'badge teal' }, icon(ic)), h('span', { class: 'muted' }, text));

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
          h('span', { class: 'eyebrow' }, 'Moderator'),
          h('h2', { style: { fontSize: 'calc(28rem / 14)', marginTop: '6px' } }, displayName(bot)),
          h(
            'div',
            { class: 'row wrap', style: { marginTop: '6px', gap: '6px' } },
            h('span', { class: 'badge' }, `@${bot.username}`),
            h('span', { class: 'badge peri' }, icon('shield'), 'Signed in with Discord'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'grid cols-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, icon('link'), h('h3', null, 'Mod portal'), recheck),
          h(
            'dl',
            { class: 'kv' },
            h('dt', null, 'Portal'),
            h('dd', { class: 'mono' }, bot.portalUrl),
            h('dt', null, 'Bot'),
            h('dd', null, portalBot ? h('span', { class: 'row', style: { gap: '8px' } }, h('img', { class: 'avatar', src: userAvatar(portalBot, 64), width: 22, height: 22, alt: '' }), displayName(portalBot)) : '—'),
            h('dt', null, 'Signed in as'),
            h('dd', null, `${displayName(bot)} (@${bot.username})`),
          ),
          h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => BotPage.removeBot(bot) }, icon('logOut'), 'Sign out')),
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, icon('shield'), h('h3', null, 'What you can do')),
          rule('users', 'Servers where you have Kick, Ban or Timeout permission show up on the left.'),
          rule('check', 'Each action needs the same Discord permission it would need in Discord itself.'),
          rule('crown', 'You can only act on members ranked below you, never on the owner.'),
          rule('list', 'Your actions are signed with your name in the server\'s audit log.'),
          rule('lock', 'The Builder and server settings stay with the server owner.'),
        ),
      ),
      BotPage.serversCard(bot, view, guilds),
    );
  },

  serversCard(bot, view, guilds) {
    const mod = bot.type === 'mod';
    return h(
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
                    h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, `${fmtNum(g.approximate_member_count)} members${g.owner ? ' · bot owns it' : ''}`),
                  ),
                ),
              ),
            )
          : h(
              'div',
              { class: 'empty' },
              icon('server'),
              h('h3', null, mod ? 'No servers to moderate' : 'No servers yet'),
              h('p', null, view.guildsError || (mod ? 'Ask the server owner to give you Kick, Ban or Timeout permission.' : 'Invite the bot to a server you manage. It will appear here.')),
              mod ? null : h('button', { class: 'btn teal', onclick: () => openExternal(inviteUrl(bot, '8')) }, icon('userPlus'), 'Invite to a server'),
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
          h('h2', { style: { fontSize: 'calc(28rem / 14)', marginTop: '6px' } }, displayName(bot)),
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
        h('div', { class: 'stat' }, h('div', { class: 'stat-value', style: { fontSize: 'calc(18rem / 14)', paddingTop: '6px' }, 'data-presence-text': bot.id }, App.presenceLabel(bot.id)), h('div', { class: 'stat-label' }, 'Status')),
      ),

      h('div', { class: 'grid cols-2' }, BotPage.presenceCard(bot), BotPage.intentsCard(bot)),

      BotPage.inviteCard(bot),

      BotPage.serversCard(bot, view, guilds),

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
        h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, 'Keeps the bot showing as online in Discord while this app is open.'),
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
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, name), h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, why)),
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
    const mod = bot.type === 'mod';
    const ok = await confirmDialog({
      title: mod ? 'Sign out?' : `Remove ${displayName(bot)}?`,
      message: mod
        ? 'Your mod portal sign-in is removed from this PC. You can sign in with Discord again any time.'
        : 'The saved token is deleted from this PC. You can add the bot again later with its token.',
      confirmLabel: mod ? 'Sign out' : 'Remove bot',
      danger: !mod,
    });
    if (!ok) return;
    try {
      await api('bots:remove', bot.id);
      App.bots = App.bots.filter((b) => b.id !== bot.id);
      delete App.views[bot.id];
      delete App.presence[bot.id];
      App.go({ page: 'home' });
      toast(mod ? 'Signed out' : 'Bot removed');
    } catch (err) {
      toastError(err);
    }
  },
};
