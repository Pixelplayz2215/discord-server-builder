// Welcome & goodbye page: per-server messages with a card drawn for each member who joins or leaves.
// The card designer's preview uses the same drawing code as the bot (src/shared/welcomecard.js).

const WELCOME_KIND_TEXT = {
  welcome: { label: 'Welcome', on: 'Post a welcome when someone joins', event: 'joins' },
  goodbye: { label: 'Goodbye', on: 'Post a goodbye when someone leaves', event: 'leaves' },
};
const DEV_PORTAL = 'https://discord.com/developers/applications';

const WelcomePage = {
  data: null,
  error: null,
  loading: false,
  images: {}, // background file -> data URL, for previews

  async load() {
    WelcomePage.loading = true;
    try {
      WelcomePage.data = await api('welcome:list');
      WelcomePage.error = null;
    } catch (err) {
      WelcomePage.error = err.message;
    }
    WelcomePage.loading = false;
    WelcomePage.rerender();
  },

  rerender() {
    if (App.route.page !== 'welcome') return;
    const scroll = document.getElementById('welcome-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('welcome-page');
    if (page) page.scrollTop = scroll;
  },

  async image(name) {
    if (!name) return null;
    if (!(name in WelcomePage.images)) WelcomePage.images[name] = await api('welcome:image', name).catch(() => null);
    return WelcomePage.images[name];
  },

  // Draws a card on a canvas for the app, with the bot standing in for the member. isCurrent() false
  // means a newer drawing has started, so this one stops.
  async drawPreview(canvas, card, vars, bot, isCurrent = () => true) {
    const load = (src) =>
      new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    await Promise.all(['500 26px Poppins', '600 32px Poppins', '800 58px Poppins', '400 50px Silkscreen'].map((f) => document.fonts.load(f).catch(() => null)));
    const [avatar, background] = await Promise.all([load(userAvatar(bot, 256)), card.background.type === 'image' ? WelcomePage.image(card.background.image).then(load) : null]);
    if (isCurrent()) WelcomeCard.draw(canvas.getContext('2d'), card, vars, { avatar, background });
  },

  sampleVars(bot, guildName, count) {
    const name = displayName(bot);
    return { user: name, username: bot?.username || name, mention: `@${name}`, server: guildName || 'your server', count: count ?? 128 };
  },

  render() {
    const page = WelcomePage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Welcome and goodbye messages are posted by your bot. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('door'), h('h3', null, 'No welcome messages yet'), h('p', null, 'Greet new members with a card showing their avatar and name, and say goodbye when someone leaves. Pick the colours, a background image, the font and the words.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'Set up a server')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((s) => page.serverCard(s)));

    return h(
      'div',
      { class: 'settings', id: 'welcome-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Community'),
            h('h1', null, 'Welcome & goodbye'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Greet new members with your own message and a card made for them, and post a goodbye when someone leaves. Design every part of the card. The bot posts while this app is open or in the tray.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'Set up a server'),
        ),
        content,
      ),
    );
  },

  serverCard(s) {
    const bot = App.bot(s.botId);
    const kindRow = (kind) => {
      const k = s[kind];
      const thumb = h('canvas', { class: 'welcome-thumb', width: WelcomeCard.WIDTH, height: WelcomeCard.HEIGHT });
      if (k.showCard) WelcomePage.drawPreview(thumb, k.card, WelcomePage.sampleVars(bot, s.guildName), bot);
      return h(
        'div',
        { class: 'welcome-kind' },
        k.showCard ? thumb : h('div', { class: 'welcome-thumb empty-thumb' }, icon('type'), 'Text only'),
        h(
          'div',
          { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'row', style: { gap: '8px' } }, h('b', null, WELCOME_KIND_TEXT[kind].label), h('span', { class: `badge ${k.enabled ? 'teal' : ''}` }, k.enabled ? 'On' : 'Off')),
          h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '4px' } }, k.enabled ? `When someone ${WELCOME_KIND_TEXT[kind].event} → #${k.channelName || k.channelId}` : 'Not posting'),
          h('div', { class: 'secondary ellipsis', style: { marginTop: '4px' } }, k.message),
          s.problems[kind] ? h('div', { class: 'callout warn', style: { marginTop: '8px' } }, icon('alert'), h('div', null, s.problems[kind])) : null,
        ),
      );
    };
    const anyOn = s.welcome.enabled || s.goodbye.enabled;
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('door'), h('h3', { class: 'grow ellipsis' }, s.guildName || 'A server'), h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, `via ${bot ? displayName(bot) : 'a removed bot'}`)),
      anyOn && !s.membersIntent
        ? h(
            'div',
            { class: 'callout warn', style: { marginBottom: '12px' } },
            icon('alert'),
            h('div', null, h('b', null, 'Turn on the Server Members Intent. '), "Without it Discord doesn't tell the bot when members join or leave. In the Developer Portal, open your bot → Bot → Privileged Gateway Intents, turn on Server Members Intent and save. Then press Refresh on the bot's page here.", ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openExternal(DEV_PORTAL); } }, 'Open the Developer Portal')),
          )
        : null,
      h('div', { class: 'stack', style: { gap: '12px' } }, kindRow('welcome'), kindRow('goodbye')),
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        h('button', { class: 'btn sm', onclick: () => WelcomePage.edit(s) }, icon('edit'), 'Edit'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => WelcomePage.remove(s) }, icon('trash'), 'Remove'),
      ),
    );
  },

  async remove(s) {
    const ok = await confirmDialog({ title: `Stop welcome and goodbye messages in ${s.guildName || 'this server'}?`, message: 'Its settings and card designs are removed from the app. Messages already posted stay in Discord.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      WelcomePage.data = await api('welcome:remove', s.botId, s.guildId);
      toast('Removed');
    } catch (err) {
      toastError(err);
    }
    WelcomePage.rerender();
  },

  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify({ botId: existing.botId, guildId: existing.guildId, guildName: existing.guildName, welcome: existing.welcome, goodbye: existing.goodbye }))
      : { botId: owners[0].id, guildId: '', guildName: '', welcome: { ...WelcomeCard.normalizeKind({ enabled: true }, 'welcome') }, goodbye: WelcomeCard.normalizeKind({}, 'goodbye') };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    let kind = 'welcome';
    let channels = [];
    let memberCount = null;

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); drawPreview(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    botSel.disabled = !!existing;
    guildSel.disabled = !!existing;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.guildName = guildSel.selectedOptions[0]?.textContent || ''; loadServer(); });

    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      let guilds = [];
      try {
        guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((g) => [g.id, g.name])], draft.guildId);
      } catch (err) {
        options(guildSel, [['', `Couldn't load servers: ${err.message}`]], '');
      }
      draft.guildId = guildSel.value;
      if (draft.guildId) draft.guildName = guildSel.selectedOptions[0]?.textContent || draft.guildName;
      loadServer();
    };
    const loadServer = async () => {
      channels = [];
      memberCount = null;
      if (draft.guildId) {
        try {
          const [list, guild] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}`, { query: { with_counts: true } }).catch(() => null)]);
          channels = list.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
          memberCount = guild?.approximate_member_count ?? null;
        } catch {
          channels = [];
        }
      }
      drawSettings();
    };

    // Welcome / Goodbye switcher
    const tabs = h('div', { class: 'seg' });
    const drawTabs = () =>
      tabs.replaceChildren(
        ...WelcomeCard.KINDS.map((k) => h('button', { type: 'button', class: `seg-btn ${k === kind ? 'active' : ''}`, onclick: () => { kind = k; drawTabs(); drawSettings(); } }, WELCOME_KIND_TEXT[k].label, draft[k].enabled ? h('span', { class: 'seg-dot' }) : null)),
      );

    const settingsHost = h('div', { class: 'stack', style: { gap: '12px' } });
    const color = (value, onChange) => {
      const input = h('input', { type: 'color', class: 'color-input', value });
      input.addEventListener('input', () => { onChange(input.value); drawPreviewSoon(); });
      return input;
    };

    function drawSettings() {
      const k = draft[kind];
      const card = k.card;
      const bg = card.background;
      const channelSel = selectEl([['', draft.guildId ? (channels.length ? 'Pick a channel…' : 'Loading channels…') : 'Pick a server first'], ...channels.map((c) => [c.id, `#${c.name}`])], k.channelId, (v) => { k.channelId = v; k.channelName = (channels.find((c) => c.id === v)?.name) || ''; });
      if (channels.length && !channels.some((c) => c.id === k.channelId)) k.channelId = '';
      const message = h('textarea', { class: 'textarea', rows: 3, maxlength: WelcomeCard.LIMITS.message, placeholder: WelcomeCard.DEFAULTS[kind].message }, k.message);
      message.addEventListener('input', () => { k.message = message.value; drawPreviewSoon(); });

      const designer = h('div', { class: 'stack', style: { gap: '12px', display: k.showCard ? '' : 'none' } });
      const drawDesigner = () => {
        const presets = h('div', { class: 'row wrap', style: { gap: '6px' } }, Object.entries(WelcomeCard.PRESETS).map(([id, p]) => h('button', { type: 'button', class: 'btn sm ghost welcome-preset', onclick: () => { k.card = WelcomeCard.applyPreset(k.card, id); drawSettings(); drawPreview(); } }, h('span', { class: 'welcome-swatch', style: { background: p.background.type === 'gradient' ? `linear-gradient(135deg, ${p.background.from}, ${p.background.to})` : p.background.color } }), p.name)));
        let bgControls;
        if (bg.type === 'gradient') {
          bgControls = h('div', { class: 'row wrap', style: { gap: '10px' } }, field('From', color(bg.from, (v) => (bg.from = v))), field('To', color(bg.to, (v) => (bg.to = v))), field('Direction', selectEl([['diagonal', 'Diagonal'], ['horizontal', 'Left to right'], ['vertical', 'Top to bottom']], bg.direction, (v) => { bg.direction = v; drawPreview(); })));
        } else if (bg.type === 'color') {
          bgControls = field('Colour', color(bg.color, (v) => (bg.color = v)));
        } else {
          const choose = h('button', { type: 'button', class: 'btn sm' }, icon('image'), bg.image ? 'Change image' : 'Choose image…');
          choose.addEventListener('click', withBusy(choose, async () => {
            const picked = await api('welcome:pickBackground');
            if (!picked) return;
            WelcomePage.images[picked.image] = picked.dataUrl;
            bg.image = picked.image;
            drawDesigner();
            drawPreview();
          }));
          const darken = h('input', { type: 'range', min: 0, max: 85, step: 5, value: Math.round(bg.darken * 100), class: 'welcome-range' });
          const darkenLabel = h('span', { class: 'subtle' }, `${Math.round(bg.darken * 100)}%`);
          darken.addEventListener('input', () => { bg.darken = Number(darken.value) / 100; darkenLabel.textContent = `${darken.value}%`; drawPreviewSoon(); });
          bgControls = h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'row wrap' }, choose, h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, bg.image ? 'Image chosen. It fills the card, cropped to fit.' : 'PNG, JPG, WebP or GIF, up to 8 MB. About 1024 × 450 looks best.')), field('Darken the image (so the text stands out)', h('div', { class: 'row' }, darken, darkenLabel)));
        }
        // One line of card text: its words, colour and size.
        const textLine = (key, label, placeholder) => {
          const line = card[key];
          const input = h('input', { class: 'input', value: line.text, maxlength: WelcomeCard.LIMITS[key], placeholder });
          input.addEventListener('input', () => { line.text = input.value; drawPreviewSoon(); });
          const [min, max] = WelcomeCard.SIZE_RANGE;
          const size = h('input', { type: 'range', class: 'welcome-size', min: min * 100, max: max * 100, step: 5, value: Math.round(line.size * 100), title: 'Text size' });
          const sizeLabel = h('span', { class: 'subtle welcome-size-label' }, `${Math.round(line.size * 100)}%`);
          size.addEventListener('input', () => { line.size = Number(size.value) / 100; sizeLabel.textContent = `${size.value}%`; drawPreviewSoon(); });
          return h('div', { class: 'welcome-text-row' }, field(label, input), field('Colour', color(line.color, (v) => (line.color = v))), field('Size', h('div', { class: 'row', style: { gap: '6px' } }, size, sizeLabel)));
        };
        designer.replaceChildren(
          field('Quick styles', presets),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Layout', selectEl([['center', 'Avatar on top, centred'], ['left', 'Avatar on the left']], card.layout, (v) => { card.layout = v; drawPreview(); })), field('Font', selectEl(WelcomeCard.FONTS.map((f) => [f, f === 'Silkscreen' ? 'Silkscreen (pixel)' : f]), card.font, (v) => { card.font = v; drawPreview(); }))),
          field('Background', selectEl([['gradient', 'Gradient'], ['color', 'One colour'], ['image', 'Your own image']], bg.type, (v) => { bg.type = v; drawDesigner(); drawPreview(); })),
          bgControls,
          textLine('title', 'Big text', 'e.g. Welcome, {user}!'),
          textLine('subtitle', 'Small text', 'e.g. You are member #{count}'),
          textLine('extra', 'Extra line (optional)', 'e.g. Read #rules to get started'),
          h('div', { class: 'hint', style: { marginTop: '-4px' } }, 'Card text can use {user}, {username}, {server} and {count}. Text that is too long shrinks to fit.'),
          h('div', { class: 'row wrap', style: { gap: '18px', alignItems: 'flex-end' } }, field('Avatar ring', color(card.ring, (v) => (card.ring = v))), switchEl(card.shadow, (v) => { card.shadow = v; drawPreview(); }, 'Shadow behind text')),
        );
      };
      drawDesigner();

      settingsHost.replaceChildren(
        switchEl(k.enabled, (v) => { k.enabled = v; drawTabs(); }, WELCOME_KIND_TEXT[kind].on),
        field('Post in', channelSel),
        field('Message', message, 'You can use {mention}, {user}, {username}, {server} and {count} (member count). Leave it empty to post just the card.'),
        h('div', { class: 'row wrap', style: { gap: '18px' } }, kind === 'welcome' ? switchEl(k.ping, (v) => { k.ping = v; }, 'Ping the new member') : null, switchEl(k.skipBots, (v) => { k.skipBots = v; }, kind === 'welcome' ? 'Skip bots that join' : 'Skip bots that leave')),
        switchEl(k.showCard, (v) => { k.showCard = v; designer.style.display = v ? '' : 'none'; drawPreview(); }, 'Include a card'),
        designer,
      );
      drawPreview();
    }

    // Preview: the message as it shows in Discord, with the card, using the bot as the member.
    const canvas = h('canvas', { class: 'welcome-canvas', width: WelcomeCard.WIDTH, height: WelcomeCard.HEIGHT });
    const previewText = h('div', { class: 'rr-text' });
    const previewHost = h('div', { class: 'rr-preview' });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 60);
    }
    let drawing = 0;
    function drawPreview() {
      const k = draft[kind];
      const bot = App.bot(draft.botId);
      const vars = WelcomePage.sampleVars(bot, draft.guildName, memberCount);
      previewText.textContent = WelcomeCard.fill(k.message, vars);
      canvas.style.display = k.showCard ? '' : 'none';
      previewHost.replaceChildren(h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(bot, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(bot)), h('span', { class: 'badge peri' }, 'APP')), k.message.trim() ? previewText : null, canvas);
      const mine = ++drawing;
      if (k.showCard) WelcomePage.drawPreview(canvas, JSON.parse(JSON.stringify(k.card)), vars, bot, () => mine === drawing);
    }

    const testBtn = h('button', { type: 'button', class: 'btn sm' }, icon('send'), 'Send a test');
    testBtn.addEventListener('click', withBusy(testBtn, async () => {
      if (!draft.guildId) throw new Error('Pick the server first.');
      await api('welcome:test', draft.botId, draft.guildId, kind, draft[kind]);
      toast(`Test ${kind} posted in #${draft[kind].channelName}`);
    }));

    drawTabs();
    drawSettings();
    loadGuilds();

    return openModal({
      title: existing ? `Welcome & goodbye in ${existing.guildName || 'this server'}` : 'Set up welcome & goodbye',
      wide: 'xl',
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor welcome-editor' },
        h('div', { class: 'stack', style: { gap: '12px' } }, h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)), tabs, settingsHost),
        h(
          'div',
          null,
          h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview (with your bot as the member)'),
          previewHost,
          h('div', { class: 'row wrap', style: { marginTop: '10px' } }, testBtn, h('span', { class: 'subtle grow', style: { fontSize: 'calc(12rem / 14)' } }, 'Posts this one with your bot as the member. Nobody is pinged.')),
          h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, 'The bot needs View Channel, Send Messages and Attach Files in the channel, and the Server Members Intent turned on in the Developer Portal.'),
        ),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save',
          kind: 'primary',
          icon: 'check',
          onClick: async () => {
            if (!guildSel.value) throw new Error('Pick the server.');
            const payload = { ...draft, guildId: guildSel.value, guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName };
            WelcomePage.data = await api('welcome:save', draft.botId, payload.guildId, payload);
            toast('Welcome & goodbye saved');
            WelcomePage.rerender();
          },
        },
      ],
    });
  },
};
