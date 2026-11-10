// Social page: post in a Discord channel when a YouTube channel uploads, a Twitch channel goes live,
// a TikTok account posts a video, your Instagram account posts, or a GitHub account or repo publishes
// a release or a new repo. The checks run in the main process while the app is open or in the tray.

const PLATFORMS = {
  youtube: { name: 'YouTube', icon: 'youtube', badge: 'coral', placeholder: 'https://www.youtube.com/@channel', when: 'post a video or start a stream' },
  twitch: { name: 'Twitch', icon: 'twitch', badge: 'peri', placeholder: 'twitch.tv/name, or just the name', when: 'go live' },
  github: { name: 'GitHub', icon: 'github', badge: '', placeholder: 'github.com/you (every repo), or github.com/you/repo', when: 'release an update' },
  tiktok: { name: 'TikTok', icon: 'tiktok', badge: 'teal', placeholder: 'tiktok.com/@name, or just @name', when: 'post a video' },
  instagram: { name: 'Instagram', icon: 'instagram', badge: 'gold', placeholder: '', when: 'post' },
};

// What a GitHub alert posts for, in words.
function githubWhen(a) {
  const repos = a.source?.kind === 'user' && a.events?.repos !== false;
  const releases = a.events?.releases !== false;
  return [releases ? 'release an update' : null, repos ? 'make a new repo' : null].filter(Boolean).join(' or ') || 'do something';
}
const TWITCH_CONSOLE = 'https://dev.twitch.tv/console/apps';
const YOUTUBE_API_CONSOLE = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com';
const META_APPS = 'https://developers.facebook.com/apps';
const INSTAGRAM_PRO_HELP = 'https://help.instagram.com/502981923235522';
// The watcher's message when YouTube's public feed fails (src/main/social.js); group 1 is the HTTP status.
const FEED_ERROR = /video feed for this channel isn't answering right now \(([^)]*)\)/;

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
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Post in your Discord server when a YouTube channel uploads, a Twitch channel goes live, a TikTok account posts a video, your Instagram posts, or a GitHub account or repo publishes a release or a new repo. The app checks while it is open or in the tray; with Run 24/7 on, your mod portal checks YouTube and GitHub around the clock.'),
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

    const y = d.youtube || {};
    const youtube = row(
      'youtube',
      'YouTube',
      y.hasKey ? "Checking through YouTube's API with your key. Paste any channel's link when you add an alert." : "Works without a login, but YouTube's free feed is often down. Add a free API key (below) so alerts keep working.",
      h('span', { class: `badge ${y.hasKey ? 'teal' : 'gold'}` }, y.hasKey ? 'API key' : 'Feed only'),
    );

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

    const tiktok = row('tiktok', 'TikTok', 'Works without a login. Paste any public account when you add an alert; TikTok is checked every 10 minutes.', h('span', { class: 'badge teal' }, 'No login needed'));

    const ig = d.instagram?.accounts || [];
    const instagram = row(
      'instagram',
      'Instagram',
      ig.length ? `Connected: ${ig.map((a) => `@${a.username}`).join(', ')}. Instagram only lets the app see accounts you connect.` : 'Instagram only lets the app see accounts you connect, so these alerts are for your own account. Connect it below (free, about 10 minutes).',
      h('span', { class: `badge ${ig.length ? 'teal' : ''}` }, ig.length ? `${ig.length} connected` : 'Not connected'),
    );

    const x = row('cross', 'X / Twitter', 'Not available yet: since February 2026, X charges for every read of its API.', h('span', { class: 'badge' }, 'Later'));

    return SettingsPage.card('Accounts', 'link', h('div', { class: 'stack', style: { gap: '4px' } }, youtube, SocialPage.youtubeKeyBox(y), twitch, t.builtInClientId ? null : SocialPage.clientIdBox(t), tiktok, instagram, SocialPage.instagramBox(ig), x));
  },

  // Connecting an Instagram account: a token made for it in Meta for Developers, pasted here.
  instagramBox(accounts) {
    const input = h('input', { class: 'input mono', type: 'password', placeholder: 'Instagram token (IG…)', autocomplete: 'off', spellcheck: false });
    const connect = h('button', { class: 'btn sm' }, icon('logIn'), 'Connect');
    connect.addEventListener('click', withBusy(connect, async () => {
      if (!input.value.trim()) return toast('Paste the token first.', 'error');
      const data = await api('social:addInstagram', input.value.trim());
      SocialPage.data = data;
      toast(`Connected @${data.added.username}. You can add Instagram alerts for it now.`);
      SocialPage.rerender();
    }));
    // A token that runs out within two weeks (a working one is renewed long before).
    const soon = (a) => a.expiresAt && a.expiresAt - Date.now() < 14 * 86400000;
    const list = accounts.map((a) => {
      const remove = h('button', { class: 'btn sm ghost' }, icon('trash'), 'Disconnect');
      remove.addEventListener('click', withBusy(remove, async () => {
        const used = (SocialPage.data?.alerts || []).filter((x) => x.platform === 'instagram' && x.source.id === a.id).length;
        if (!(await confirmDialog({ title: `Disconnect @${a.username}?`, message: used ? `Its ${used === 1 ? 'alert stops' : `${used} alerts stop`} until you connect it again.` : 'You can connect it again any time.', confirmLabel: 'Disconnect' }))) return;
        SocialPage.data = await api('social:removeInstagram', a.id);
        toast(`Disconnected @${a.username}`);
        SocialPage.rerender();
      }));
      const warn = !a.connected || soon(a);
      const detail = !a.connected ? 'Its token is missing: paste a new one below.' : soon(a) ? `Its token runs out ${fmtDate(a.expiresAt)} and hasn't been renewed yet. If that doesn't change, paste a new one below.` : 'The token renews itself while the app runs.';
      return h(
        'div',
        { class: 'ig-account' },
        a.avatar ? h('img', { class: 'avatar', src: a.avatar, width: 22, height: 22, alt: '' }) : icon('instagram'),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', null, `@${a.username}`), h('div', { class: 'subtle', style: warn ? { color: 'var(--gold)' } : null }, detail)),
        remove,
      );
    });
    return h(
      'details',
      { class: 'client-id-box instagram-box', open: !accounts.length },
      h('summary', null, accounts.length ? `Instagram accounts (${accounts.length}): connect another, or paste a new token` : 'Connect your Instagram account (free, about 10 minutes)'),
      list.length ? h('div', { style: { margin: '10px 0 4px' } }, list) : null,
      h(
        'ol',
        { class: 'muted' },
        h('li', null, 'In Instagram, make the account a professional one: ', h('b', null, 'Settings → Account type and tools → Switch to professional account'), ". Creator and Business are both free; apps can't read personal accounts."),
        h('li', null, 'Open Meta for Developers and log in with Facebook. Press ', h('b', null, 'Create app'), ', give it any name, and pick the use case ', h('b', null, 'Manage messaging & content on Instagram'), '.'),
        h('li', null, 'In your new app, open ', h('b', null, 'Instagram → API setup with Instagram login'), '. Under ', h('b', null, 'Generate access tokens'), ', press ', h('b', null, 'Add account'), ' and log in to Instagram, then press ', h('b', null, 'Generate token'), ' and paste it here. Keep it private, like a password.'),
        h('li', null, 'If Meta says the account needs a role on the app: in ', h('b', null, 'App roles → Roles'), ', add it as an ', h('b', null, 'Instagram Tester'), ', accept the invite in Instagram (', h('b', null, 'Settings → Website permissions → Apps and websites → Tester invites'), '), then do step 3 again.'),
      ),
      h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', margin: '0 0 8px' } }, "The token is checked before it's saved, then kept encrypted on this PC. It lasts 60 days and the app renews it every week while it runs, so you paste it once. Posts and reels are announced; stories aren't."),
      h(
        'div',
        { class: 'row wrap' },
        h('div', { class: 'input-wrap', style: { width: '320px' } }, icon('key'), input),
        connect,
        h('button', { class: 'btn sm ghost', onclick: () => openExternal(META_APPS) }, icon('external'), 'Open Meta for Developers'),
        h('button', { class: 'btn sm ghost', onclick: () => openExternal(INSTAGRAM_PRO_HELP) }, icon('external'), 'How to switch to professional'),
      ),
    );
  },

  showInstagramBox() {
    const box = document.querySelector('.instagram-box');
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.querySelector('input')?.focus();
  },

  // A YouTube Data API key: free, and checks don't depend on YouTube's public feed.
  youtubeKeyBox(y) {
    const input = h('input', { class: 'input mono', type: 'password', placeholder: y.hasKey ? `Saved key ending in ${y.keyHint}` : 'YouTube API key (AIza…)', autocomplete: 'off', spellcheck: false });
    const save = h('button', { class: 'btn sm' }, icon('save'), y.hasKey ? 'Replace' : 'Save');
    save.addEventListener('click', withBusy(save, async () => {
      if (!input.value.trim()) return toast('Paste the API key first.', 'error');
      SocialPage.data = await api('social:setYouTubeKey', input.value.trim());
      toast('YouTube API key saved. Checking your YouTube alerts now.');
      SocialPage.rerender();
    }));
    const remove = h('button', { class: 'btn sm ghost' }, icon('trash'), 'Remove');
    remove.addEventListener('click', withBusy(remove, async () => {
      if (!(await confirmDialog({ title: 'Remove the YouTube API key?', message: "YouTube alerts go back to YouTube's public feed, which is often down.", confirmLabel: 'Remove' }))) return;
      SocialPage.data = await api('social:setYouTubeKey', '');
      toast('YouTube API key removed');
      SocialPage.rerender();
    }));
    return h(
      'details',
      { class: 'client-id-box youtube-key-box', open: !y.hasKey },
      h('summary', null, y.hasKey ? `YouTube API key (saved, ends in ${y.keyHint})` : 'Add a YouTube API key (free, about 3 minutes)'),
      h(
        'ol',
        { class: 'muted' },
        h('li', null, 'Open Google Cloud and sign in with any Google account. If it asks, create a project (any name). No billing is needed.'),
        h('li', null, 'On the ', h('b', null, 'YouTube Data API v3'), ' page that opens, press ', h('b', null, 'Enable'), '.'),
        h('li', null, 'Go to ', h('b', null, 'APIs & Services → Credentials'), ', press ', h('b', null, 'Create credentials → API key'), ', and paste the key here. Keep it private, like a password.'),
      ),
      h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', margin: '0 0 8px' } }, "The key is checked before it's saved, then kept encrypted on this PC. Each check uses 1 of the 10,000 free units Google gives you a day, enough for about 30 channels checked every 5 minutes."),
      h('div', { class: 'row wrap' }, h('div', { class: 'input-wrap', style: { width: '320px' } }, icon('key'), input), save, y.hasKey ? remove : null, h('button', { class: 'btn sm ghost', onclick: () => openExternal(YOUTUBE_API_CONSOLE) }, icon('external'), 'Open Google Cloud')),
    );
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
    // YouTube's public feeds failing with no API key saved: say what fixes it, up front.
    const feedDown = !d.youtube?.hasKey && d.alerts.some((a) => a.platform === 'youtube' && a.enabled !== false && FEED_ERROR.test(a.state?.error || ''));
    const keyCallout = feedDown
      ? h(
          'div',
          { class: 'callout warn', style: { margin: '12px 16px 0' } },
          icon('alert'),
          h(
            'div',
            { class: 'grow' },
            h('b', null, "YouTube's free video feeds are down, so these alerts can't see new videos. "),
            'This is on YouTube\'s side and affects every channel. Add a free YouTube API key under Accounts and they work again; uploads from the last 2 days are posted once it does.',
            h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onclick: () => SocialPage.showKeyBox() }, icon('key'), 'Set up the API key')),
          ),
        )
      : null;
    return h('div', { class: 'card flush' }, h('div', { class: 'card-head', style: { padding: '16px 16px 0' } }, icon('megaphone'), h('h3', null, `Alerts (${d.alerts.length})`)), keyCallout, h('div', { class: 'list', style: { marginTop: '12px', borderTop: '1px solid var(--border)' } }, d.alerts.map((a) => SocialPage.alertRow(a))));
  },

  showKeyBox() {
    const box = document.querySelector('.youtube-key-box');
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.querySelector('input')?.focus();
  },

  alertRow(a) {
    const p = PLATFORMS[a.platform];
    const bot = App.bot(a.botId);
    const state = a.state || {};
    const ping = a.mention === 'everyone' || a.mention === 'here' ? `@${a.mention}` : a.mention && a.mention !== 'none' ? a.mentionName || 'a role' : null;
    const status = [];
    if (a.enabled === false) status.push(h('span', { class: 'badge' }, 'Paused'));
    else if (state.error) {
      const feed = state.error.match(FEED_ERROR);
      const short = feed ? `YouTube feed down (${feed[1]})` : state.error.length > 70 ? `${state.error.slice(0, 70)}…` : state.error;
      status.push(h('span', { class: 'badge coral', title: state.error }, icon('alert'), short));
    }
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
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'primary ellipsis' }, a.source.name), h('span', { class: `badge ${p.badge}` }, p.name), h('span', { class: 'subtle' }, `when they ${a.platform === 'github' ? githubWhen(a) : p.when}`)),
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
      ? { ...alert, source: { ...alert.source }, events: { releases: true, repos: true, ...alert.events } }
      : { platform: 'youtube', botId: owners[0].id, guildId: '', channelId: '', mention: 'none', message: '', repoMessage: '', events: { releases: true, repos: true }, shorts: true, enabled: true, source: null };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;

    // Where to watch
    // A GitHub account covers all its public repos; a repo, just that one's releases.
    const found = (source) => {
      if (draft.platform === 'tiktok') return source.login && source.name.toLowerCase() !== source.login ? `✓ ${source.name} (@${source.login})` : `✓ @${source.login || source.name}`;
      if (draft.platform !== 'github') return `✓ ${source.name}`;
      return source.kind === 'repo' ? `✓ ${source.name}: this repo's releases` : `✓ ${source.name}: every public repo of theirs`;
    };
    const resolved = h('div', { class: 'progress-note' }, draft.source ? found(draft.source) : '');
    const sourceInput = h('input', { class: 'input', value: draft.source ? draft.source.login || draft.source.url : '', placeholder: PLATFORMS[draft.platform].placeholder, autocomplete: 'off' });
    sourceInput.addEventListener('input', () => {
      draft.source = null;
      resolved.textContent = '';
      githubParts();
    });
    // Instagram: one of the connected accounts, picked from a list.
    const igAccounts = d.instagram?.accounts || [];
    const setIgSource = (id) => {
      const acc = igAccounts.find((x) => x.id === id);
      draft.source = acc ? { id: acc.id, login: acc.username, name: acc.username, url: `https://www.instagram.com/${acc.username}/`, avatar: acc.avatar || null } : null;
    };
    const igSel = selectEl(igAccounts.length ? igAccounts.map((x) => [x.id, `@${x.username}`]) : [['', 'No account connected yet']], (draft.platform === 'instagram' ? draft.source?.id : igAccounts[0]?.id) || '', setIgSource);
    const resolve = async () => {
      if (draft.platform === 'instagram') {
        setIgSource(igSel.value);
        if (!draft.source) throw new Error('Connect your Instagram account first (Accounts, above).');
        return;
      }
      if (!sourceInput.value.trim()) throw new Error({ youtube: 'Paste the YouTube channel link.', twitch: 'Enter the Twitch channel.', github: 'Paste the GitHub link.', tiktok: 'Enter the TikTok account.' }[draft.platform]);
      resolved.textContent = 'Checking…';
      try {
        draft.source = await api('social:resolve', draft.platform, sourceInput.value.trim());
        resolved.textContent = found(draft.source);
      } catch (err) {
        resolved.textContent = '';
        throw err;
      } finally {
        githubParts();
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
    const messageField = field('Message', message, messageHint);
    const messageLabel = messageField.querySelector('label');
    const watchLabel = h('label', null, 'Channel to watch');
    let shorts = draft.shorts !== false;
    const shortsRow = h('div', null, switchEl(shorts, (v) => (shorts = v), 'Include Shorts'));

    // GitHub: what to post for. New repos only work for an account (a repo can't make more repos).
    const repoMessage = h('textarea', { class: 'textarea', rows: 2, maxlength: 1000, placeholder: d.defaults.githubRepo }, draft.repoMessage || '');
    const repoMessageField = field('Message for new repos', repoMessage, 'Leave empty for the message shown. You can use {name} (the repo) and {url}.');
    const reposHint = h('div', { class: 'hint', style: { margin: '-4px 0 0 46px' } }, 'Only for a whole account: paste github.com/you instead of a repo link to get these.');
    const reposSwitch = switchEl(draft.events.repos, (v) => {
      draft.events.repos = v;
      githubParts();
    }, 'New repos (when they make one, or make one public)');
    const githubRow = h(
      'div',
      { class: 'stack', style: { gap: '8px' } },
      h('div', { class: 'label' }, 'Post when there are'),
      switchEl(draft.events.releases, (v) => (draft.events.releases = v), 'New releases'),
      reposSwitch,
      reposHint,
    );
    function githubParts() {
      const github = draft.platform === 'github';
      const forRepo = draft.source?.kind === 'repo';
      githubRow.style.display = github ? '' : 'none';
      reposSwitch.querySelector('input').disabled = forRepo;
      reposHint.style.display = github && forRepo ? '' : 'none';
      repoMessageField.style.display = github && !forRepo && draft.events.repos ? '' : 'none';
    }
    const twitchWarning = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, 'Twitch alerts need you to log in with Twitch first (Accounts, above).'));
    const connectInstagram = () => {
      document.querySelector('#modal-root .modal-backdrop:last-child .modal')?.closeModal();
      SocialPage.showInstagramBox();
    };
    const instagramWarning = h(
      'div',
      { class: 'callout warn' },
      icon('alert'),
      h('div', { class: 'grow' }, 'Connect your Instagram account first. Instagram only lets the app see accounts you connect.', h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onclick: connectInstagram }, icon('instagram'), 'Connect Instagram'))),
    );
    const platformParts = () => {
      const p = PLATFORMS[draft.platform];
      sourceInput.placeholder = p.placeholder;
      message.placeholder = d.defaults[draft.platform];
      messageHint.textContent = {
        twitch: "Leave empty for the message shown. You can use {name}, {title}, {url} and {game}. Twitch alerts also get a card with the stream title, game and preview, so you don't need {url}.",
        youtube: "Leave empty for the message shown. You can use {name}, {title} and {url}. A {url} shows YouTube's video preview.",
        github: "Leave empty for the message shown. You can use {name} (the repo), {title} (the release) and {url}. A {url} shows GitHub's preview of the release.",
        tiktok: "Leave empty for the message shown. You can use {name}, {title} (the caption) and {url}. TikTok alerts also get a card with the caption and cover, so you don't need {url}.",
        instagram: "Leave empty for the message shown. You can use {name}, {title} (the caption) and {url}. Instagram alerts also get a card with the caption and picture, so you don't need {url}.",
      }[draft.platform];
      messageLabel.textContent = draft.platform === 'github' ? 'Message for releases' : 'Message';
      watchLabel.textContent = { github: 'Account or repo to watch', tiktok: 'Account to watch', instagram: 'Your Instagram account' }[draft.platform] || 'Channel to watch';
      const ig = draft.platform === 'instagram';
      sourceRow.style.display = ig ? 'none' : '';
      igSel.style.display = ig ? '' : 'none';
      instagramWarning.style.display = ig && !igAccounts.length ? '' : 'none';
      shortsRow.style.display = draft.platform === 'youtube' ? '' : 'none';
      mine.style.display = draft.platform === 'twitch' && d.twitch.account ? '' : 'none';
      twitchWarning.style.display = draft.platform === 'twitch' && !d.twitch.loggedIn ? '' : 'none';
      githubParts();
    };
    const sourceRow = h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row' }, h('div', { class: 'grow' }, sourceInput), checkBtn, mine), resolved);
    const platformSel = selectEl(
      [
        ['youtube', 'YouTube: a channel posts a video or starts a stream'],
        ['twitch', 'Twitch: a channel goes live'],
        ['tiktok', 'TikTok: an account posts a video'],
        ['instagram', 'Instagram: your account posts a photo, carousel or reel'],
        ['github', 'GitHub: a new release, or a new repo'],
      ],
      draft.platform,
      (v) => {
        draft.platform = v;
        draft.source = null;
        sourceInput.value = '';
        resolved.textContent = '';
        if (v === 'instagram') setIgSource(igSel.value);
        platformParts();
      },
    );
    platformParts();

    return openModal({
      title: alert ? `Edit alert for ${alert.source.name}` : 'Add a social alert',
      wide: true,
      body: [
        field('When', platformSel),
        twitchWarning,
        instagramWarning,
        h('div', { class: 'field' }, watchLabel, sourceRow, igSel),
        githubRow,
        h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot that posts', botSel), field('Server', guildSel)),
        h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Post in', channelSel), field('Ping', mentionSel)),
        messageField,
        repoMessageField,
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
            SocialPage.data = await api('social:saveAlert', { ...draft, guildId: guildSel.value, guildName, channelId: channelSel.value, channelName, mention: mentionSel.value, mentionName, message: message.value.trim(), repoMessage: repoMessage.value.trim(), shorts });
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
      if (JSON.stringify(data) === JSON.stringify(SocialPage.data)) return; // nothing new to show
      SocialPage.data = data;
      SocialPage.rerender();
    })
    .catch(() => {});
});
