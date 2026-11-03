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
              HomePage.awaySlot(),
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
    const botSelect = ownerBots.length
      ? selectEl(ownerBots.map((b) => [b.id, displayName(b)]), ownerBots[0].id, () => {
          loadStatus();
          loadAlways();
        })
      : null;
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
    // 24/7: the portal runs the community features around the clock, even with this PC off.
    const alwaysInfo = h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } });
    const alwaysServers = h('div', { class: 'stack always-servers' });
    let alwaysState = null;
    const alwaysOnBtn = h('button', { class: 'btn sm teal' }, icon('power'), 'Turn on 24/7');
    const alwaysOffBtn = h('button', { class: 'btn sm ghost' }, 'Turn off');
    const alwaysCheckBtn = h('button', { class: 'btn sm ghost' }, icon('refresh'), 'Check');
    const showAlways = () => {
      const s = alwaysState;
      alwaysServers.replaceChildren();
      // Buttons set their own display, so the hidden attribute alone wouldn't hide them.
      alwaysOnBtn.style.display = s?.on ? 'none' : '';
      alwaysOffBtn.style.display = alwaysCheckBtn.style.display = s?.on ? '' : 'none';
      if (!s) return;
      if (!s.on) {
        alwaysInfo.textContent = 'Off. Welcome cards, auto roles and the rest run while this app is open or in the tray.';
        return;
      }
      const gw = s.portal?.gateway;
      const running = s.servers.filter((srv) => srv.on).length;
      if (s.error) alwaysInfo.textContent = `✗ ${s.error}`;
      else if (gw?.state === 'online') alwaysInfo.textContent = `✓ On. Your portal runs ${running} ${running === 1 ? 'server' : 'servers'} around the clock, even with this PC off.`;
      else if (s.portal && !s.portal.running) alwaysInfo.textContent = 'On, but none of your servers have anything for the portal to run yet.';
      else alwaysInfo.textContent = `On. Your portal is connecting the bot${gw?.detail ? `: ${gw.detail}` : '…'}`;
      if (s.checkedAt) alwaysInfo.textContent += ` Checked ${fmtRelative(s.checkedAt)}.`;
      if (s.portal && !s.portal.cards) alwaysServers.append(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, "Your portal can't draw welcome cards, so welcomes go without them. On Render, choose Manual Deploy → Clear build cache & deploy.")));
      for (const srv of s.servers) {
        const problems = [srv.saveProblem && `Couldn't save its settings: ${srv.saveProblem}`, srv.problem, ...srv.problems].filter(Boolean);
        alwaysServers.append(
          h(
            'div',
            { class: 'always-server' },
            h('span', { class: `badge ${problems.length ? 'coral' : 'teal'}` }, problems.length ? 'Check' : srv.on ? '24/7' : 'Off'),
            h('b', null, srv.name),
            h('span', { class: 'subtle' }, problems.length ? problems.join(' ') : srv.on ? `Settings saved ${srv.savedAt ? fmtRelative(srv.savedAt) : ''}` : 'Nothing to run here'),
          ),
        );
      }
    };
    // pull: ask the portal now (the app also does every minute and says so with always:changed).
    const loadAlways = async ({ pull = true } = {}) => {
      if (pull) {
        alwaysState = null;
        showAlways();
        alwaysInfo.textContent = 'Checking…';
      }
      try {
        alwaysState = await api('always:status', botSelect.value, { pull });
        showAlways();
      } catch (err) {
        alwaysInfo.textContent = `✗ ${err.message}`;
      }
    };
    HomePage.onAlwaysChanged = ({ botId }) => {
      if (botSelect && botId === botSelect.value && document.body.contains(alwaysInfo)) loadAlways({ pull: false });
    };
    alwaysOnBtn.addEventListener(
      'click',
      withBusy(alwaysOnBtn, async () => {
        const bot = ownerBots.find((b) => b.id === botSelect.value);
        const ok = await confirmDialog({
          title: 'Run 24/7 on your mod portal?',
          message: h(
            'div',
            { class: 'stack', style: { gap: '10px' } },
            h('p', null, `Your portal will run welcome & goodbye cards, auto roles, reaction roles, polls, server logs, server stats, scheduled announcements and YouTube alerts for ${displayName(bot)}, even when this PC is off. This app stops running them while 24/7 is on.`),
            h('p', null, 'Each server gets a private #bot-settings channel where the settings are kept for the portal, encrypted with your bot token. Only the bot can see it, and server admins can see it exists. Please leave it there.'),
            h('div', { class: 'callout' }, icon('alert'), h('div', null, h('b', null, 'Render free plan: '), "while 24/7 is on, the portal keeps itself awake. That uses Render's 750 free hours a month, enough for one service all month. Other free services on the same Render account share those hours.")),
            h('p', { class: 'subtle' }, 'Twitch alerts and automatic backups still need this app running.'),
          ),
          confirmLabel: 'Turn on 24/7',
        });
        if (!ok) return;
        alwaysInfo.textContent = 'Turning on… (saving each server\'s settings; a sleeping portal can take up to a minute)';
        try {
          alwaysState = await api('always:enable', botSelect.value);
          noteAlwaysOn(true);
          showAlways();
          toast('24/7 is on');
        } catch (err) {
          alwaysInfo.textContent = `✗ ${err.message}`;
        }
      }),
    );
    alwaysOffBtn.addEventListener(
      'click',
      withBusy(alwaysOffBtn, async () => {
        alwaysInfo.textContent = 'Turning off…';
        try {
          alwaysState = await api('always:disable', botSelect.value);
          noteAlwaysOn(false);
          showAlways();
          toast('24/7 is off. This app runs your community features again.');
        } catch (err) {
          alwaysInfo.textContent = `✗ ${err.message}`;
        }
      }),
    );
    alwaysCheckBtn.addEventListener('click', withBusy(alwaysCheckBtn, () => loadAlways()));
    // The Community page says where its features run.
    const noteAlwaysOn = (on) => {
      const bot = App.bots.find((b) => b.id === botSelect.value);
      if (bot) bot.always = { ...bot.always, on };
    };
    if (botSelect) {
      loadStatus();
      loadAlways();
    }

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
            'Mods can also moderate right in Discord with /warn, /timeout, /kick, /ban, /unban, /cases, /purge, /lock, /unlock and /slowmode. Your portal answers them with the same permission rules, and records warnings and actions in a private #mod-cases channel. Staff get /announce (an announcement card), /giveaway and /reactionroles; giveaways and reaction roles made this way need Run 24/7 (below) and show up on their pages here. Everyone also gets /poll, which posts a poll with coloured bars (shown on the Polls page).',
          ),
          botSelect
            ? h('div', { class: 'stack', style: { gap: '8px', marginTop: '12px' } }, h('div', { class: 'row wrap' }, botSelect, enableBtn, disableBtn), slashStatus)
            : h('p', { class: 'subtle', style: { marginTop: '8px' } }, 'Connect your bot with its token above first.'),
          h(
            'p',
            { class: 'subtle', style: { marginTop: '8px', fontSize: 'calc(12rem / 14)' } },
            'On Render\'s free plan, the first command after 15 quiet minutes can fail while the portal wakes up. Turning on 24/7 (next) keeps it awake, or a free uptime monitor can open your portal\'s /health page every 10 minutes.',
          ),
        ),
        h(
          'div',
          { class: 'card step' },
          h('h3', null, 'Run 24/7 (optional)'),
          h(
            'p',
            null,
            'Keep welcome cards, auto roles, reaction roles, polls, server logs, server stats, scheduled announcements and YouTube alerts going when this PC is off. Your portal runs them around the clock with the settings you make here. Turn on slash commands first; it uses the same portal.',
          ),
          botSelect
            ? h('div', { class: 'stack', style: { gap: '8px', marginTop: '12px' } }, h('div', { class: 'row wrap' }, alwaysOnBtn, alwaysOffBtn, alwaysCheckBtn), alwaysInfo, alwaysServers)
            : h('p', { class: 'subtle', style: { marginTop: '8px' } }, 'Connect your bot with its token above first.'),
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

  /* ---------- While the app was closed (24/7) ---------- */
  awayDismissed: new Set(), // `${botId}:${from}` of the cards closed with Got it
  awayEl: null,

  // Where the cards go, filled in once the app has heard from each 24/7 bot's portal.
  awaySlot() {
    HomePage.awayEl = h('div', { class: 'away-slot' });
    HomePage.fillAway();
    return HomePage.awayEl;
  },

  async fillAway() {
    const slot = HomePage.awayEl;
    if (!slot) return;
    const bots = App.bots.filter((b) => b.type !== 'mod' && b.always?.on);
    const reports = await Promise.all(bots.map((b) => api('always:status', b.id, { pull: false }).catch(() => null)));
    const cards = bots.map((bot, i) => reports[i] && HomePage.awayCard(bot, reports[i])).filter(Boolean);
    const key = JSON.stringify(cards.map((c) => c.textContent));
    if (slot.dataset.key === key) return; // unchanged: don't redraw
    slot.dataset.key = key;
    slot.replaceChildren(...cards);
  },

  // What a bot's mod portal did while the app was closed, until dismissed, or null when there's
  // nothing worth saying (a quick restart).
  awayCard(bot, s) {
    const away = s.away;
    const dismissKey = `${bot.id}:${away?.from}`;
    if (!s.on || !away || HomePage.awayDismissed.has(dismissKey)) return null;
    const servers = s.servers.filter((srv) => srv.on && srv.away).map((srv) => ({ name: srv.name, parts: HomePage.awayParts(srv.away) }));
    const secs = (away.to - away.from) / 1000;
    const busy = servers.some((srv) => srv.parts.length);
    if (!servers.length || (!busy && secs < 30 * 60)) return null;

    const at = (t) => {
      const sameDay = new Date(away.from).toDateString() === new Date(away.to).toDateString();
      return new Date(t).toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    };
    const lines = [];
    if (s.portal?.gateway?.state === 'online') {
      lines.push(s.portal.startedAt > away.from ? `Your mod portal kept ${displayName(bot)} online (it restarted at ${at(s.portal.startedAt)}).` : `Your mod portal kept ${displayName(bot)} online the whole time.`);
    }
    if (!busy) {
      const where = servers.length > 3 ? `any of your ${servers.length} servers` : HomePage.joinWords(servers.map((srv) => srv.name), 'or');
      lines.push(`Nothing needed doing in ${where}: no welcomes, goodbyes, auto roles, reaction roles, votes, announcements, giveaways, YouTube posts or log entries.`);
    } else {
      for (const srv of servers) lines.push([h('b', null, srv.name), `: ${srv.parts.length ? HomePage.joinWords(srv.parts) : 'nothing needed doing'}.`]);
    }

    const gotIt = h('button', { class: 'btn sm ghost' }, 'Got it');
    const card = h(
      'div',
      { class: 'card away-card' },
      h('div', { class: 'card-head' }, icon('clock'), h('h3', null, 'While the app was closed'), h('span', { class: 'subtle' }, `${HomePage.awaySpan(secs)} · ${at(away.from)} to ${at(away.to)}`), gotIt),
      lines.map((line) => h('p', null, line)),
    );
    gotIt.addEventListener('click', () => {
      HomePage.awayDismissed.add(dismissKey);
      card.remove();
    });
    return card;
  },

  // What the portal did for one server, as "2 welcomes", "1 vote"… (nothing: an empty list).
  awayParts(counts) {
    const words = [
      ['welcome', 'welcome', 'welcomes'],
      ['goodbye', 'goodbye', 'goodbyes'],
      ['autoroles', 'member given auto roles', 'members given auto roles'],
      ['reactionRoles', 'reaction role', 'reaction roles'],
      ['votes', 'vote', 'votes'],
      ['announcements', 'announcement', 'announcements'],
      ['giveaways', 'giveaway drawn', 'giveaways drawn'],
      ['youtube', 'YouTube post', 'YouTube posts'],
      ['logs', 'log entry', 'log entries'],
    ];
    return words.filter(([key]) => counts[key] > 0).map(([key, one, many]) => `${fmtNum(counts[key])} ${counts[key] === 1 ? one : many}`);
  },

  // "10 hours", "3 days"…
  awaySpan(secs) {
    const [unit, size] = RELATIVE_STEPS.find(([, step]) => secs >= step && step >= 60) || ['minute', 60];
    const n = Math.max(1, Math.round(secs / size));
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  },

  // "a, b and c"
  joinWords(list, word = 'and') {
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} ${word} ${list.at(-1)}` : list[0] || '';
  },
};

onEvent('always:changed', (e) => {
  HomePage.onAlwaysChanged?.(e);
  if (HomePage.awayEl && document.body.contains(HomePage.awayEl)) HomePage.fillAway();
});
