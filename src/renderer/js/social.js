// Social page: post in a Discord channel when a YouTube channel uploads or a Twitch channel goes live.
// The checks run in the main process while the app is open or in the tray.

const PLATFORMS = {
  youtube: { name: 'YouTube', icon: 'youtube', badge: 'coral', placeholder: 'https://www.youtube.com/@channel', when: 'post a video or start a stream' },
  twitch: { name: 'Twitch', icon: 'twitch', badge: 'peri', placeholder: 'twitch.tv/name, or just the name', when: 'go live' },
};
const TWITCH_CONSOLE = 'https://dev.twitch.tv/console/apps';

const SocialPage = {
  data: null,
  error: null,
  loading: false,
  guildCache: {}, // botId -> guilds

  async load() {
    SocialPage.loading = true;
    try {
      SocialPage.data = await api('social:get');
      SocialPage.error = null;
    } catch (err) {
      SocialPage.error = err.message;
    }
    SocialPage.loading = false;
    SocialPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'social') return;
    const scroll = document.getElementById('social-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('social-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    if (!SocialPage.data && !SocialPage.loading && !SocialPage.error) SocialPage.load();
    const addBtn = h('button', { class: 'btn primary', disabled: !SocialPage.data, onclick: () => SocialPage.edit(null) }, icon('plus'), 'Add alert');
    return h(
      'div',
      { class: 'settings', id: 'social-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Announce'),
            h('h1', null, 'Social alerts'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Post in your Discord server when a YouTube channel uploads or a Twitch channel goes live. The app checks while it is open or in the tray.'),
          ),
          addBtn,
        ),
        SocialPage.error ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, SocialPage.error)) : null,
        SocialPage.connectionsCard(),
        SocialPage.alertsCard(),
      ),
    );
  },

  /* ---------- Connections ---------- */
  connectionsCard() {
    const d = SocialPage.data;
    const row = (ic, name, detail, action) => h('div', { class: 'social-row' }, h('span', { class: `social-icon ${ic}` }, icon(ic)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'primary' }, name), h('div', { class: 'secondary' }, detail)), action);
    if (!d) return SettingsPage.card('Accounts', 'link', h('div', { class: 'skeleton' }));

    const youtube = row('youtube', 'YouTube', 'No login needed. Paste any channel\'s link when you add an alert.', h('span', { class: 'badge teal' }, 'Ready'));

    const t = d.twitch;
    let twitchDetail;
    let twitchAction;
    if (t.loggedIn && t.account) {
      twitchDetail = h('span', { class: 'row', style: { gap: '6px' } }, t.account.avatar ? h('img', { class: 'avatar', src: t.account.avatar, width: 18, height: 18, alt: '' }) : null, `Logged in as ${t.account.name}. You can watch any Twitch channel, not just yours.`);
      const out = h('button', { class: 'btn sm' }, icon('logOut'), 'Log out');
      out.addEventListener('click', withBusy(out, async () => {
        if (!(await confirmDialog({ title: 'Log out of Twitch?', message: 'Twitch alerts stop until you log in again.', confirmLabel: 'Log out' }))) return;
        SocialPage.data = await api('social:twitchLogout');
        SocialPage.rerender();
      }));
      twitchAction = out;
    } else {
      const hasId = t.builtInClientId || !!t.clientId;
      twitchDetail = hasId ? 'Log in so the app can check when channels go live.' : 'Needs a Twitch Client ID first (free, about 2 minutes). See below.';
      const login = h('button', { class: 'btn sm teal', disabled: !hasId }, icon('logIn'), 'Log in with Twitch');
      login.addEventListener('click', withBusy(login, () => SocialPage.twitchLogin()));
      twitchAction = login;
    }
    const twitch = row('twitch', 'Twitch', twitchDetail, twitchAction);

    const x = row('cross', 'X / Twitter', 'Not available yet: since February 2026, X charges for every read of its API.', h('span', { class: 'badge' }, 'Later'));

    return SettingsPage.card('Accounts', 'link', h('div', { class: 'stack', style: { gap: '4px' } }, youtube, twitch, t.builtInClientId ? null : SocialPage.clientIdBox(t), x));
  },

  // Only shown when this copy of the app has no Twitch Client ID built in.
  clientIdBox(t) {
    const input = h('input', { class: 'input mono', placeholder: 'Twitch Client ID', value: t.clientId || '', autocomplete: 'off' });
    const save = h('button', { class: 'btn sm' }, icon('save'), 'Save');
    save.addEventListener('click', withBusy(save, async () => {
      SocialPage.data = await api('social:setClientId', input.value.trim());
      toast(input.value.trim() ? 'Twitch Client ID saved' : 'Twitch Client ID removed');
      SocialPage.rerender();
    }));
    return h(
      'details',
      { class: 'client-id-box', open: !t.clientId },
      h('summary', null, t.clientId ? 'Twitch Client ID (saved)' : 'Set up your Twitch Client ID'),
      h(
        'ol',
        { class: 'muted' },
        h('li', null, 'Open the Twitch developer console and log in. Twitch asks you to turn on two-factor authentication first.'),
        h('li', null, 'Press ', h('b', null, 'Register Your Application'), '. Use any name, add ', h('code', { class: 'mono' }, 'http://localhost'), ' as the OAuth Redirect URL, pick the category ', h('b', null, 'Application Integration'), ' and the Client Type ', h('b', null, 'Public'), '.'),
        h('li', null, 'Press ', h('b', null, 'Create'), ', then ', h('b', null, 'Manage'), ', and copy the Client ID here. No secret is needed.'),
      ),
      h('div', { class: 'row wrap' }, h('div', { class: 'input-wrap', style: { width: '320px' } }, icon('key'), input), save, h('button', { class: 'btn sm ghost', onclick: () => openExternal(TWITCH_CONSOLE) }, icon('external'), 'Open the Twitch console')),
    );
  },

  async twitchLogin() {
    const start = await api('social:twitchLoginStart');
    let cancelled = false;
    const waiting = openModal({
      title: 'Log in with Twitch',
      dismissable: false,
      body: [
        h('p', null, 'Twitch is opening in your browser. Check it shows this code, then press ', h('b', null, 'Authorize'), '. This window updates by itself.'),
        h('div', { class: 'device-code' }, start.userCode),
        h('button', { class: 'btn sm ghost', onclick: () => openExternal(start.verificationUri) }, icon('external'), 'Open Twitch again'),
        h('div', { class: 'progress indeterminate' }, h('div')),
      ],
      actions: [{ label: 'Cancel', kind: 'ghost', onClick: () => { cancelled = true; api('social:twitchLoginCancel').catch(() => {}); } }],
    });
    const modal = document.querySelector('#modal-root .modal-backdrop:last-child .modal');
    openExternal(start.verificationUri);
    try {
      SocialPage.data = await api('social:twitchLoginWait');
      toast(`Logged in to Twitch as ${SocialPage.data.twitch.account?.name || 'you'}`);
    } catch (err) {
      if (!cancelled) toastError(err);
    } finally {
      modal?.closeModal();
      await waiting;
    }
    SocialPage.rerender();
  },

  /* ---------- Alerts ---------- */
  alertsCard() {
    const d = SocialPage.data;
    if (!d) return SettingsPage.card('Alerts', 'megaphone', h('div', { class: 'skeleton' }));
    if (!d.alerts.length) {
      return SettingsPage.card('Alerts', 'megaphone', h('div', { class: 'empty' }, icon('megaphone'), h('h3', null, 'No alerts yet'), h('p', null, 'Add one to post in a channel of your choice when someone uploads or goes live.'), h('button', { class: 'btn primary', onclick: () => SocialPage.edit(null) }, icon('plus'), 'Add alert')));
    }
    return h('div', { class: 'card flush' }, h('div', { class: 'card-head', style: { padding: '16px 16px 0' } }, icon('megaphone'), h('h3', null, `Alerts (${d.alerts.length})`)), h('div', { class: 'list', style: { marginTop: '12px', borderTop: '1px solid var(--border)' } }, d.alerts.map((a) => SocialPage.alertRow(a))));
  },

  alertRow(a) {
    const p = PLATFORMS[a.platform];
    const bot = App.bot(a.botId);
    const state = a.state || {};
    const ping = a.mention === 'everyone' || a.mention === 'here' ? `@${a.mention}` : a.mention && a.mention !== 'none' ? a.mentionName || 'a role' : null;
    const status = [];
    if (a.enabled === false) status.push(h('span', { class: 'badge' }, 'Paused'));
    else if (state.error) status.push(h('span', { class: 'badge coral', title: state.error }, icon('alert'), state.error.length > 70 ? `${state.error.slice(0, 70)}…` : state.error));
    else if (state.checkedAt) status.push(h('span', { class: 'subtle' }, `Checked ${fmtRelative(state.checkedAt)}`));
    else status.push(h('span', { class: 'subtle' }, 'Waiting for the first check'));
    if (a.platform === 'twitch' && state.live && a.enabled !== false) status.push(h('span', { class: 'badge teal' }, 'Live now'));
    if (state.lastPostAt) status.push(h('span', { class: 'subtle' }, `Last posted ${fmtRelative(state.lastPostAt)}`));

    const test = h('button', { class: 'btn sm' }, icon('send'), 'Test');
    test.addEventListener('click', withBusy(test, async () => {
      await api('social:test', a.id);
      toast(`Test alert posted in #${a.channelName || 'the channel'}`);
    }));
    return h(
      'div',
      { class: 'list-row' },
      h('span', { class: `social-icon ${a.platform}` }, icon(p.icon)),
      h(
        'div',
        { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'primary ellipsis' }, a.source.name), h('span', { class: `badge ${p.badge}` }, p.name), h('span', { class: 'subtle' }, `when they ${p.when}`)),
        h('div', { class: 'secondary ellipsis' }, `→ #${a.channelName || a.channelId} in ${a.guildName || 'a server'} · via ${bot ? displayName(bot) : 'a removed bot'}${ping ? ` · pings ${ping}` : ''}`),
        h('div', { class: 'stat-line', style: { marginTop: '4px' } }, status),
      ),
      switchEl(a.enabled !== false, (v) => SocialPage.setEnabled(a, v)),
      test,
      h('button', { class: 'icon-btn', title: 'Edit', onclick: () => SocialPage.edit(a) }, icon('edit')),
      h('button', { class: 'icon-btn danger', title: 'Delete', onclick: () => SocialPage.remove(a) }, icon('trash')),
    );
  },

  async setEnabled(a, enabled) {
    try {
      SocialPage.data = await api('social:setEnabled', a.id, enabled);
    } catch (err) {
      toastError(err);
    }
    SocialPage.rerender();
  },

  async remove(a) {
    if (!(await confirmDialog({ title: `Delete the alert for ${a.source.name}?`, message: 'Nothing more will be posted for it.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      SocialPage.data = await api('social:removeAlert', a.id);
    } catch (err) {
      toastError(err);
    }
    SocialPage.rerender();
  },

  async guildsFor(botId) {
    if (!SocialPage.guildCache[botId]) SocialPage.guildCache[botId] = await rest(botId, 'GET', '/users/@me/guilds');
    return SocialPage.guildCache[botId];
  },

  async edit(alert) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    if (!owners.length) return toast('Connect a bot on the Home page first.', 'error');
    const d = SocialPage.data;
    const draft = alert
      ? { ...alert, source: { ...alert.source } }
      : { platform: 'youtube', botId: owners[0].id, guildId: '', channelId: '', mention: 'none', message: '', shorts: true, enabled: true, source: null };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;

    // Where to watch
    const resolved = h('div', { class: 'progress-note' }, draft.source ? `✓ ${draft.source.name}` : '');
    const sourceInput = h('input', { class: 'input', value: draft.source ? draft.source.login || draft.source.url : '', placeholder: PLATFORMS[draft.platform].placeholder, autocomplete: 'off' });
    sourceInput.addEventListener('input', () => {
      draft.source = null;
      resolved.textContent = '';
    });
    const resolve = async () => {
      if (!sourceInput.value.trim()) throw new Error(draft.platform === 'youtube' ? 'Paste the YouTube channel link.' : 'Enter the Twitch channel.');
      resolved.textContent = 'Checking…';
      try {
        draft.source = await api('social:resolve', draft.platform, sourceInput.value.trim());
        resolved.textContent = `✓ ${draft.source.name}`;
      } catch (err) {
        resolved.textContent = '';
        throw err;
      }
    };
    const checkBtn = h('button', { class: 'btn sm' }, icon('search'), 'Check');
    checkBtn.addEventListener('click', withBusy(checkBtn, resolve));
    const mine = h('button', { class: 'btn sm ghost', onclick: () => { sourceInput.value = d.twitch.account.login; draft.source = null; resolved.textContent = ''; } }, 'My channel');

    // Where to post
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; draft.channelId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '');
    const mentionSel = selectEl([['none', 'No ping']], draft.mention);
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.channelId = ''; loadChannels(); });
    channelSel.addEventListener('change', () => { draft.channelId = channelSel.value; });
    mentionSel.addEventListener('change', () => { draft.mention = mentionSel.value; });
    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      try {
        const guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((g) => [g.id, g.name])], draft.guildId);
      } catch (err) {
        options(guildSel, [['', `Couldn't load servers: ${err.message}`]], '');
      }
      loadChannels();
    };
    const loadChannels = async () => {
      if (!guildSel.value) {
        options(channelSel, [['', 'Pick a server first']], '');
        options(mentionSel, [['none', 'No ping']], 'none');
        return;
      }
      options(channelSel, [['', 'Loading channels…']], '');
      try {
        const [channels, roles] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${guildSel.value}/channels`), rest(draft.botId, 'GET', `/guilds/${guildSel.value}/roles`)]);
        const textual = channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
        options(channelSel, [['', 'Pick a channel…'], ...textual.map((c) => [c.id, `#${c.name}${c.type === 5 ? ' (announcements)' : ''}`])], draft.channelId);
        const pingable = roles.filter((r) => r.id !== guildSel.value && !r.managed).sort((a, b) => b.position - a.position);
        options(mentionSel, [['none', 'No ping'], ['everyone', '@everyone'], ['here', '@here (online members)'], ...pingable.map((r) => [r.id, `@${r.name}`])], draft.mention);
      } catch (err) {
        options(channelSel, [['', `Couldn't load channels: ${err.message}`]], '');
      }
      draft.channelId = channelSel.value;
      draft.mention = mentionSel.value;
    };
    loadGuilds();

    const message = h('textarea', { class: 'textarea', rows: 3, maxlength: 1000, placeholder: d.defaults[draft.platform] }, draft.message || '');
    const messageHint = h('div', { class: 'hint' });
    let shorts = draft.shorts !== false;
    const shortsRow = h('div', null, switchEl(shorts, (v) => (shorts = v), 'Include Shorts'));
    const twitchWarning = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, 'Twitch alerts need you to log in with Twitch first (Accounts, above).'));
    const platformParts = () => {
      const p = PLATFORMS[draft.platform];
      sourceInput.placeholder = p.placeholder;
      message.placeholder = d.defaults[draft.platform];
      messageHint.textContent = `Leave empty for the message shown. You can use {name}, {title}, {url}${draft.platform === 'twitch' ? ' and {game}. Twitch alerts also get a card with the stream title, game and preview, so you don\'t need {url}.' : '. A {url} shows YouTube\'s video preview.'}`;
      shortsRow.style.display = draft.platform === 'youtube' ? '' : 'none';
      mine.style.display = draft.platform === 'twitch' && d.twitch.account ? '' : 'none';
      twitchWarning.style.display = draft.platform === 'twitch' && !d.twitch.loggedIn ? '' : 'none';
    };
    const platformSel = selectEl([['youtube', 'YouTube: a channel posts a video or starts a stream'], ['twitch', 'Twitch: a channel goes live']], draft.platform, (v) => {
      draft.platform = v;
      draft.source = null;
      sourceInput.value = '';
      resolved.textContent = '';
      platformParts();
    });
    platformParts();

    return openModal({
      title: alert ? `Edit alert for ${alert.source.name}` : 'Add a social alert',
      wide: true,
      body: [
        field('When', platformSel),
        twitchWarning,
        field('Channel to watch', h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row' }, h('div', { class: 'grow' }, sourceInput), checkBtn, mine), resolved)),
        h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot that posts', botSel), field('Server', guildSel)),
        h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Post in', channelSel), field('Ping', mentionSel)),
        field('Message', message, messageHint),
        shortsRow,
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: alert ? 'Save' : 'Add alert',
          kind: 'primary',
          icon: 'check',
          onClick: async () => {
            if (!draft.source) await resolve();
            if (!guildSel.value || !channelSel.value) throw new Error('Pick the server and channel to post in.');
            const guildName = guildSel.selectedOptions[0]?.textContent || '';
            const channelName = (channelSel.selectedOptions[0]?.textContent || '').replace(/^#/, '').replace(/ \(announcements\)$/, '');
            const mentionName = mentionSel.selectedOptions[0]?.textContent || '';
            SocialPage.data = await api('social:saveAlert', { ...draft, guildId: guildSel.value, guildName, channelId: channelSel.value, channelName, mention: mentionSel.value, mentionName, message: message.value.trim(), shorts });
            toast(alert ? 'Alert saved' : `Alert added for ${draft.source.name}`);
            SocialPage.rerender();
          },
        },
      ],
    });
  },
};

// The main process checked the feeds: refresh the statuses if the page is open.
onEvent('social:changed', () => {
  if (App.route.page !== 'social' || document.querySelector('#modal-root .modal')) return;
  api('social:get')
    .then((data) => {
      SocialPage.data = data;
      SocialPage.rerender();
    })
    .catch(() => {});
});
