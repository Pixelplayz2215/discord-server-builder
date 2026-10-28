// Home page: connect a bot token, list saved bots, setup guide.

const HomePage = {
  render() {
    const tokenInput = h('input', { class: 'input', type: 'password', id: 'token-input', placeholder: 'Paste your bot token…', autocomplete: 'off' });
    const eye = h('button', { class: 'icon-btn', title: 'Show / hide token', type: 'button' }, icon('eye'));
    eye.addEventListener('click', () => {
      tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
      eye.replaceChildren(icon(tokenInput.type === 'password' ? 'eye' : 'eyeOff'));
    });
    const connectBtn = h('button', { class: 'btn primary lg' }, icon('power'), 'Connect bot');
    const connect = withBusy(connectBtn, async () => {
      if (!tokenInput.value.trim()) {
        tokenInput.focus();
        return toast('Paste a bot token first.', 'error');
      }
      const bot = await api('bots:add', tokenInput.value);
      tokenInput.value = '';
      App.upsertBot(bot);
      App.presence[bot.id] = { state: 'offline' };
      if (bot.presence?.enabled) {
        App.presence[bot.id] = { state: 'connecting' };
        api('presence:set', bot.id, bot.presence).catch(toastError);
      }
      toast(`Connected ${displayName(bot)}`);
      App.go({ page: 'bot', botId: bot.id });
    });
    connectBtn.addEventListener('click', connect);
    tokenInput.addEventListener('keydown', (e) => e.key === 'Enter' && connect());

    const shape = (name, cls) => h('div', { class: `shape ${cls}` }, icon(name));

    return h(
      'div',
      { class: 'home' },
      h(
        'div',
        { class: 'home-inner' },
        h(
          'section',
          { class: 'hero' },
          h(
            'div',
            null,
            h('span', { class: 'eyebrow' }, 'Bot control center'),
            h('h1', null, 'Build your Discord server ', h('span', { class: 'grad-text' }, 'in clicks.')),
            h(
              'p',
              { class: 'lead' },
              'Connect as many bots as you like. Each one gets its own page where you can browse its servers, see members, moderate, and build whole server layouts (roles, categories, channels and permissions) from templates.',
            ),
            h(
              'div',
              { class: 'connect-card card' },
              h('label', { class: 'label', for: 'token-input' }, 'Bot token'),
              h('div', { class: 'row' }, h('div', { class: 'input-wrap' }, icon('key'), tokenInput, eye), connectBtn),
              h('div', { class: 'hint subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'Tokens are encrypted on this PC (Windows DPAPI) and are only ever sent to Discord.'),
            ),
          ),
          h(
            'div',
            { class: 'hero-art' },
            shape('triangle', 's1'),
            shape('circle', 's2'),
            shape('cross', 's3'),
            shape('square', 's4'),
            h(
              'div',
              { class: 'hero-badge' },
              h('img', { src: Theme.logoSrc(), class: Theme.hasCustomLogo() ? 'custom' : null, alt: '' }),
              h('div', { class: 'ring-text' }, Theme.settings.appName),
            ),
          ),
        ),

        App.bots.length
          ? [
              h('div', { class: 'section-title' }, h('h2', null, 'Your bots'), h('span', { class: 'badge pixel teal' }, `${App.bots.length} connected`)),
              h(
                'div',
                { class: 'grid cols-3' },
                App.bots.map((bot) =>
                  h(
                    'div',
                    { class: 'card bot-card', onclick: () => App.go({ page: 'bot', botId: bot.id }) },
                    h(
                      'div',
                      { class: 'avatar-wrap' },
                      h('img', { class: 'avatar', src: userAvatar(bot), width: 52, height: 52, alt: '' }),
                      h('span', { class: `status-dot ${App.presenceClass(bot.id)}`, 'data-presence': bot.id }),
                    ),
                    h(
                      'div',
                      { class: 'grow' },
                      h('div', { class: 'ellipsis', style: { fontWeight: 700 } }, displayName(bot)),
                      h('div', { class: 'subtle ellipsis', style: { fontSize: 'calc(12rem / 14)' }, 'data-presence-text': bot.id }, App.presenceLabel(bot.id)),
                    ),
                    icon('chevronRight', 'subtle'),
                  ),
                ),
              ),
            ]
          : null,

        h('div', { class: 'section-title' }, h('h2', null, 'Getting started')),
        h(
          'div',
          { class: 'grid cols-2 steps' },
          HomePage.step(
            'Create a bot application',
            'Open the Discord Developer Portal, click New Application, then open the Bot tab.',
            h('button', { class: 'btn sm', onclick: () => openExternal('https://discord.com/developers/applications') }, icon('external'), 'Developer Portal'),
          ),
          HomePage.step('Copy the token', 'On the Bot tab press Reset Token, copy it and paste it above. Treat it like a password.'),
          HomePage.step('Turn on Server Members Intent', 'Still on the Bot tab, enable "Server Members Intent" so the Members page can list everyone.'),
          HomePage.step('Invite it and build', 'Open the bot\'s page, press "Invite to a server" (Administrator recommended), then pick the server and start building.'),
        ),
      ),
    );
  },

  step(title, text, action) {
    return h('div', { class: 'card step' }, h('h3', null, title), h('p', null, text), action ? h('div', { style: { marginTop: '12px' } }, action) : null);
  },
};
