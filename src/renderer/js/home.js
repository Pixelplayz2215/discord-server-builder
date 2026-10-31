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

    // Moderators sign in through the owner's mod portal instead of using a token.
    const portalInput = h('input', { class: 'input', id: 'portal-input', placeholder: 'https://your-mod-portal.onrender.com', autocomplete: 'off' });
    const lastPortal = App.bots.find((b) => b.type === 'mod')?.portalUrl;
    if (lastPortal) portalInput.value = lastPortal;
    else api('app:info').then((info) => !portalInput.value && (portalInput.value = info.modPortalUrl || ''), () => {});
    const modBtn = h('button', { class: 'btn discord lg' }, icon('logIn'), 'Sign in with Discord');
    const modSignIn = withBusy(modBtn, () => HomePage.signInAsMod(portalInput.value));
    modBtn.addEventListener('click', modSignIn);
    portalInput.addEventListener('keydown', (e) => e.key === 'Enter' && modSignIn());

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
            h(
              'div',
              { class: 'connect-card card mod-card' },
              h('label', { class: 'label', for: 'portal-input' }, h('span', { class: 'badge peri' }, icon('shield'), 'Moderator?'), ' Sign in with your Discord account — no bot token needed'),
              h('div', { class: 'row' }, h('div', { class: 'input-wrap' }, icon('link'), portalInput), modBtn),
              h('div', { class: 'hint subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'Paste the mod portal address your server owner gave you. You\'ll see the servers where you have Kick, Ban or Timeout permission.'),
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

        HomePage.modAccessSection(),
      ),
    );
  },

  // Owner guide for letting mods and admins in through a mod portal (mirrors docs/MOD-PORTAL.md).
  modAccessSection() {
    const REPO = 'https://github.com/Pixelplayz2215/discord-server-builder';
    let saved = '';
    try {
      saved = localStorage.getItem('ownerPortalUrl') || '';
    } catch {
      // storage unavailable; start empty
    }
    const portalInput = h('input', { class: 'input', placeholder: 'https://your-mod-portal.onrender.com', value: saved, autocomplete: 'off' });
    const redirectCode = h('code', { class: 'mono' });
    const redirectBox = h('div', { class: 'redirect-box hidden' }, h('div', { class: 'grow ellipsis' }, redirectCode), h('button', { class: 'btn sm', onclick: () => copyText(redirectCode.textContent, 'Redirect copied') }, icon('copy'), 'Copy'));
    const status = h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } });

    const origin = () => {
      try {
        const url = new URL(portalInput.value.trim());
        return /^https?:$/.test(url.protocol) ? url.origin : null;
      } catch {
        return null;
      }
    };
    const update = () => {
      const o = origin();
      redirectBox.classList.toggle('hidden', !o);
      redirectCode.textContent = o ? `${o}/auth/callback` : '';
      status.textContent = '';
      try {
        localStorage.setItem('ownerPortalUrl', portalInput.value.trim());
      } catch {
        // remembering the address is only a convenience
      }
    };
    portalInput.addEventListener('input', update);
    update();

    const checkBtn = h('button', { class: 'btn sm teal' }, icon('check'), 'Check portal');
    checkBtn.addEventListener(
      'click',
      withBusy(checkBtn, async () => {
        if (!origin()) return toast('Paste your portal address first.', 'error');
        status.textContent = 'Checking… (a sleeping portal can take up to a minute)';
        try {
          await api('mod:checkPortal', portalInput.value);
          status.textContent = '✓ Your portal is running. If sign-in still fails, check the redirect above is saved in the Developer Portal.';
        } catch (err) {
          status.textContent = `✗ ${err.message}`;
        }
      }),
    );
    const copyAddress = () => (origin() ? copyText(origin(), 'Portal address copied') : toast('Paste your portal address first.', 'error'));

    // Slash commands: the chosen bot's interactions go to the portal, which answers the mod commands and /poll.
    const ownerBots = App.bots.filter((b) => b.type !== 'mod');
    const slashStatus = h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } });
    let lastStatus = null;
    const showStatus = () => {
      const s = lastStatus;
      if (!s) return;
      const here = origin() && s.endpoint === `${origin()}/interactions`;
      let text;
      if (here && s.registered === s.total) text = `✓ On. Your portal answers all ${s.total} commands.`;
      else if (here) text = `On, but ${s.total - s.registered} of the commands are missing. Press Turn on again to add them.`;
      else if (s.endpoint) text = `Off. This bot's commands go to ${s.endpoint}.`;
      else text = s.registered ? 'Off, but the mod commands are still listed in Discord. Press Turn off to remove them.' : 'Off.';
      if (s.others.length) text += ` This bot also has other commands (/${s.others.join(', /')}), which only work while this is off.`;
      slashStatus.textContent = text;
    };
    const botSelect = ownerBots.length ? selectEl(ownerBots.map((b) => [b.id, displayName(b)]), ownerBots[0].id, () => loadStatus()) : null;
    const loadStatus = async () => {
      lastStatus = null;
      slashStatus.textContent = 'Checking…';
      try {
        lastStatus = await api('commands:status', botSelect.value);
        showStatus();
      } catch (err) {
        slashStatus.textContent = `✗ ${err.message}`;
      }
    };
    portalInput.addEventListener('input', showStatus);

    const enableBtn = h('button', { class: 'btn sm teal' }, icon('power'), 'Turn on');
    enableBtn.addEventListener(
      'click',
      withBusy(enableBtn, async () => {
        if (!origin()) return toast('Paste your portal address in step 4 first.', 'error');
        const others = lastStatus?.others || [];
        const replaced = lastStatus?.endpoint && lastStatus.endpoint !== `${origin()}/interactions` ? lastStatus.endpoint : null;
        const ok = await confirmDialog({
          title: 'Turn on slash commands?',
          message: h(
            'div',
            { class: 'stack', style: { gap: '10px' } },
            h('p', null, `Discord will send all of ${displayName(ownerBots.find((b) => b.id === botSelect.value))}'s slash commands to ${origin()}, and the mod commands will appear in your servers.`),
            replaced ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'This replaces its current Interactions Endpoint URL: '), replaced)) : null,
            others.length ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'Its other commands will stop working: '), `/${others.join(', /')}. They work again when you turn this off.`)) : null,
          ),
          confirmLabel: 'Turn on',
        });
        if (!ok) return;
        slashStatus.textContent = 'Turning on… (a sleeping portal can take up to a minute)';
        try {
          lastStatus = await api('commands:enable', botSelect.value, origin());
          showStatus();
          toast('Slash commands are on');
        } catch (err) {
          slashStatus.textContent = `✗ ${err.message}`;
        }
      }),
    );
    const disableBtn = h('button', { class: 'btn sm ghost' }, 'Turn off');
    disableBtn.addEventListener(
      'click',
      withBusy(disableBtn, async () => {
        lastStatus = await api('commands:disable', botSelect.value, origin() || '');
        showStatus();
        toast('Slash commands are off');
      }),
    );
    if (botSelect) loadStatus();

    return [
      h(
        'div',
        { class: 'section-title' },
        h('h2', null, 'Give your mods & admins access'),
        h('span', { class: 'badge pixel peri' }, 'Optional'),
      ),
      h(
        'p',
        { class: 'muted', style: { margin: '-6px 0 16px', maxWidth: '760px' } },
        'Let your moderators use this app by signing in with Discord, without ever seeing your bot token. You run a small free "mod portal" that keeps the token. Anyone with Kick, Ban or Timeout permission in your servers gets moderation tools only. You do this once; your mods don\'t set anything up.',
      ),
      h(
        'div',
        { class: 'grid cols-2 steps' },
        HomePage.step(
          'Get your sign-in keys',
          'In the Developer Portal, open your bot\'s application → OAuth2. Copy the Client ID, then press Reset Secret and copy the Client Secret. Keep the secret private, like the token.',
          h('button', { class: 'btn sm', onclick: () => openExternal('https://discord.com/developers/applications') }, icon('external'), 'Developer Portal'),
        ),
        HomePage.step(
          'Copy the code to your GitHub',
          'Open this project on GitHub and press Fork → Create fork, so you have your own copy to deploy. Skip this if you own the original repository.',
          h('button', { class: 'btn sm', onclick: () => openExternal(REPO) }, icon('external'), 'Open on GitHub'),
        ),
        HomePage.step(
          'Deploy the portal on Render',
          'Sign up at Render with GitHub, then New → Blueprint → pick your copy. Paste your bot token, Client ID and Client Secret, and deploy. Copy the address it gives you (…onrender.com).',
          h('button', { class: 'btn sm', onclick: () => openExternal('https://dashboard.render.com/blueprints') }, icon('external'), 'Open Render'),
        ),
        h(
          'div',
          { class: 'card step' },
          h('h3', null, 'Allow the sign-in redirect'),
          h('p', null, 'Paste your portal address. Then add the redirect below under OAuth2 → Redirects in the Developer Portal and press Save Changes.'),
          h('div', { class: 'stack', style: { gap: '8px', marginTop: '12px' } }, h('div', { class: 'input-wrap' }, icon('link'), portalInput), redirectBox, h('div', { class: 'row' }, checkBtn), status),
        ),
        HomePage.step(
          'Share it with your mods',
          'Mods download the app, choose "Sign in with Discord" on the Home page and paste your portal address. They\'ll see the servers where they can kick, ban or time out members — nothing else.',
          h(
            'div',
            { class: 'row wrap' },
            h('button', { class: 'btn sm', onclick: copyAddress }, icon('copy'), 'Copy portal address'),
            h('button', { class: 'btn sm ghost', onclick: () => openExternal(`${REPO}/blob/main/docs/MOD-PORTAL.md`) }, icon('external'), 'Full guide'),
          ),
        ),
        h(
          'div',
          { class: 'card step' },
          h('h3', null, 'Add slash commands (optional)'),
          h(
            'p',
            null,
            'Mods can also moderate right in Discord with /warn, /timeout, /kick, /ban, /unban, /cases, /purge, /lock, /unlock and /slowmode. Your portal answers them with the same permission rules, and records warnings and actions in a private #mod-cases channel. Everyone also gets /poll, which posts a poll with coloured bars (shown on the Polls page).',
          ),
          botSelect
            ? h('div', { class: 'stack', style: { gap: '8px', marginTop: '12px' } }, h('div', { class: 'row wrap' }, botSelect, enableBtn, disableBtn), slashStatus)
            : h('p', { class: 'subtle', style: { marginTop: '8px' } }, 'Connect your bot with its token above first.'),
          h(
            'p',
            { class: 'subtle', style: { marginTop: '8px', fontSize: 'calc(12rem / 14)' } },
            'On Render\'s free plan, the first command after 15 quiet minutes can fail while the portal wakes up. A free uptime monitor that opens your portal\'s /health page every 10 minutes keeps it awake.',
          ),
        ),
      ),
    ];
  },

  async signInAsMod(portalUrl) {
    if (!portalUrl.trim()) {
      document.getElementById('portal-input')?.focus();
      return toast('Paste the mod portal address first.', 'error');
    }
    let cancelled = false;
    const waiting = openModal({
      title: 'Finish signing in',
      dismissable: false,
      body: [
        h('p', null, 'Your browser is opening Discord. Approve the sign-in there, then come back — this window updates by itself.'),
        h('div', { class: 'progress indeterminate' }, h('div')),
      ],
      actions: [{ label: 'Cancel', kind: 'ghost', onClick: () => { cancelled = true; api('mod:cancelSignIn').catch(() => {}); } }],
    });
    const modal = document.querySelector('#modal-root .modal-backdrop:last-child .modal');
    try {
      const account = await api('mod:signIn', portalUrl);
      App.upsertBot(account);
      toast(`Signed in as ${displayName(account)}`);
      App.go({ page: 'bot', botId: account.id });
    } catch (err) {
      if (!cancelled) toastError(err);
    } finally {
      modal?.closeModal?.();
      await waiting;
    }
  },

  step(title, text, action) {
    return h('div', { class: 'card step' }, h('h3', null, title), h('p', null, text), action ? h('div', { style: { marginTop: '12px' } }, action) : null);
  },
};
