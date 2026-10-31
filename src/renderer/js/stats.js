// Server stats page: voice channels whose names show live counts, renamed by the main process
// (src/main/stats.js) while the app is open or in the tray.

// [key, label, default name, what it counts]; the same as src/main/stats.js.
const STAT_COUNTERS = [
  ['members', 'Members', '👥 Members: {count}', 'Everyone in the server'],
  ['users', 'Users', '🙋 Users: {count}', "Members who aren't bots"],
  ['bots', 'Bots', '🤖 Bots: {count}', 'Bot accounts'],
  ['channels', 'Channels', '💬 Channels: {count}', 'Text, voice, forum and announcement channels'],
  ['roles', 'Roles', '🏷️ Roles: {count}', 'Roles, not counting @everyone'],
];
const STAT_NEEDS_MEMBERS = new Set(['users', 'bots']);

function statCount(n, format) {
  if (n == null) return '…';
  if (format !== 'short' || n < 1000) return Number(n).toLocaleString('en-US');
  const [div, unit] = n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const value = n / div;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.floor(value)}${unit}`;
}
const statName = (template, n, format) => String(template || '').replace(/\{count\}/g, statCount(n, format)).trim().slice(0, 100);

const StatsPage = {
  data: null,
  error: null,
  loading: false,

  async load() {
    StatsPage.loading = true;
    try {
      StatsPage.data = await api('stats:list');
      StatsPage.error = null;
    } catch (err) {
      StatsPage.error = err.message;
    }
    StatsPage.loading = false;
    StatsPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'stats') return;
    const scroll = document.getElementById('stats-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('stats-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = StatsPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Your bot keeps the counters up to date. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('stats'), h('h3', null, 'No server stats yet'), h('p', null, 'Show live counts at the top of your channel list: members, users, bots, channels and roles. Name each counter however you like.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'Set up a server')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((s) => page.serverCard(s)));

    return h(
      'div',
      { class: 'settings', id: 'stats-page' },
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
            h('h1', null, 'Server stats'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, "Live counts as channels at the top of your server, like \"👥 Members: 1,234\". Members can see them but not join. The bot updates them while this app is open or in the tray, about every 5 minutes, which is as often as Discord lets a bot rename a channel."),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'Set up a server'),
        ),
        content,
      ),
    );
  },

  serverCard(s) {
    const bot = App.bot(s.botId);
    const counts = s.state?.counts || {};
    const on = STAT_COUNTERS.filter(([key]) => s.counters[key]?.on);
    const needsMembers = on.some(([key]) => STAT_NEEDS_MEMBERS.has(key));
    const refresh = h('button', { class: 'btn sm' }, icon('refresh'), 'Update now');
    refresh.addEventListener('click', withBusy(refresh, async () => {
      StatsPage.data = await api('stats:refresh', s.botId, s.guildId);
      toast('Counts read again. Changed names update within a few minutes.');
      StatsPage.rerender();
    }));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('stats'), h('h3', { class: 'grow ellipsis' }, s.guildName || 'A server'), h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, `via ${bot ? displayName(bot) : 'a removed bot'}`)),
      needsMembers && !s.membersIntent
        ? h('div', { class: 'callout warn', style: { marginBottom: '12px' } }, icon('alert'), h('div', null, h('b', null, 'Bots and Users need the Server Members Intent. '), 'In the Developer Portal, open your bot → Bot → Privileged Gateway Intents, turn on Server Members Intent and save.'))
        : null,
      h('div', { class: 'stat-list' }, on.map(([key, label]) => h('div', { class: 'stat-row' }, icon('voice'), h('span', { class: 'grow ellipsis' }, statName(s.counters[key].name, counts[key], s.format)), h('span', { class: 'subtle' }, label)))),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, s.state?.updatedAt ? `Counts read ${fmtRelative(s.state.updatedAt)} · in ${s.categoryName || 'no category'}` : 'Waiting for the first count…'),
      s.state?.problem ? h('div', { class: 'callout warn', style: { marginTop: '10px' } }, icon('alert'), h('div', null, s.state.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        refresh,
        h('button', { class: 'btn sm', onclick: () => StatsPage.edit(s) }, icon('edit'), 'Edit'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => StatsPage.remove(s) }, icon('trash'), 'Remove'),
      ),
    );
  },

  async remove(s) {
    let deleteChannels = true;
    const ok = await confirmDialog({
      title: `Remove server stats from ${s.guildName || 'this server'}?`,
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'The counters stop updating.'), switchEl(true, (v) => (deleteChannels = v), s.madeCategory ? 'Also delete the counter channels and their category' : 'Also delete the counter channels')),
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      StatsPage.data = await api('stats:remove', s.botId, s.guildId, deleteChannels);
      toast('Server stats removed');
    } catch (err) {
      toastError(err);
    }
    StatsPage.rerender();
  },

  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify({ botId: existing.botId, guildId: existing.guildId, guildName: existing.guildName, categoryId: existing.categoryId, format: existing.format, counters: existing.counters }))
      : { botId: owners[0].id, guildId: '', guildName: '', categoryId: '__new__', format: 'full', counters: Object.fromEntries(STAT_COUNTERS.map(([key, , name]) => [key, { on: true, name }])) };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    const counts = { ...(existing?.state?.counts || {}) };
    let categories = [];

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const categorySel = selectEl([['', 'Pick a server first']], '', (v) => { draft.categoryId = v; drawPreview(); });
    botSel.disabled = !!existing;
    guildSel.disabled = !!existing;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.guildName = guildSel.selectedOptions[0]?.textContent || ''; loadServer(); });

    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      try {
        const guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((g) => [g.id, g.name])], draft.guildId);
      } catch (err) {
        options(guildSel, [['', `Couldn't load servers: ${err.message}`]], '');
      }
      draft.guildId = guildSel.value;
      if (draft.guildId) draft.guildName = guildSel.selectedOptions[0]?.textContent || draft.guildName;
      loadServer();
    };
    // Today's counts, for the preview. Bots and users need the member list, so they're only known
    // once the bot has counted them.
    const loadServer = async () => {
      if (!draft.guildId) {
        options(categorySel, [['', 'Pick a server first']], '');
        drawPreview();
        return;
      }
      try {
        const [guild, channels, roles] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}`, { query: { with_counts: true } }), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`)]);
        Object.assign(counts, { members: guild.approximate_member_count ?? null, channels: channels.filter((c) => c.type !== 4).length, roles: roles.filter((r) => r.id !== draft.guildId).length });
        categories = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      } catch {
        categories = [];
      }
      options(categorySel, [['__new__', '＋ Make a "📊 Server Stats" category at the top'], ['', 'No category'], ...categories.map((c) => [c.id, c.name])], draft.categoryId);
      draft.categoryId = categorySel.value;
      drawPreview();
    };

    const formatSel = selectEl([['full', '1,234 (full number)'], ['short', '1.2K (short)']], draft.format, (v) => { draft.format = v; drawCounters(); drawPreview(); });
    const countersHost = h('div', { class: 'stack', style: { gap: '10px' } });
    function drawCounters() {
      countersHost.replaceChildren(
        ...STAT_COUNTERS.map(([key, label, name, about]) => {
          const c = draft.counters[key];
          const nameInput = h('input', { class: 'input', value: c.name, maxlength: 90, placeholder: name, disabled: !c.on });
          nameInput.addEventListener('input', () => { c.name = nameInput.value; drawPreviewSoon(); });
          return h(
            'div',
            { class: `stat-edit ${c.on ? '' : 'off'}` },
            switchEl(c.on, (v) => { c.on = v; drawCounters(); drawPreview(); }),
            h('div', { class: 'stat-edit-label' }, h('b', null, label), h('small', null, about)),
            h('div', { class: 'grow' }, nameInput),
          );
        }),
      );
    }

    // A picture of the channel list in Discord.
    const preview = h('div', { class: 'rr-preview stat-preview' });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 100);
    }
    function drawPreview() {
      const on = STAT_COUNTERS.filter(([key]) => draft.counters[key].on);
      const category = draft.categoryId === '__new__' ? '📊 Server Stats' : categories.find((c) => c.id === draft.categoryId)?.name;
      preview.replaceChildren(
        category ? h('div', { class: 'stat-preview-cat' }, '⌄ ', category.toUpperCase()) : null,
        ...on.map(([key, , name]) => h('div', { class: 'stat-preview-row' }, icon('voice'), statName(draft.counters[key].name.trim() || name, counts[key], draft.format))),
        on.length ? null : h('div', { class: 'subtle' }, 'Turn on a counter to see it here.'),
      );
    }

    loadGuilds();
    drawCounters();
    drawPreview();

    return openModal({
      title: existing ? `Server stats in ${existing.guildName || 'this server'}` : 'Set up server stats',
      wide: 'xl',
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor' },
        h(
          'div',
          { class: 'stack', style: { gap: '14px' } },
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Put the counters in', categorySel), field('Numbers', formatSel)),
          h('div', { class: 'label', style: { marginTop: '4px' } }, 'Counters'),
          countersHost,
          h('p', { class: 'hint', style: { margin: 0 } }, 'Put {count} where the number goes. Turning a counter off deletes its channel when you save.'),
        ),
        h(
          'div',
          null,
          h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview'),
          preview,
          h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, 'Users and Bots show "…" here until the bot has counted the member list. That needs the Server Members Intent. The bot needs Manage Channels.'),
        ),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save' : 'Make the counters',
          kind: 'primary',
          icon: 'check',
          onClick: async () => {
            if (!guildSel.value) throw new Error('Pick the server.');
            const payload = {
              ...draft,
              guildId: guildSel.value,
              guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName,
              createCategory: categorySel.value === '__new__',
              categoryId: categorySel.value === '__new__' ? '' : categorySel.value,
              categoryName: categorySel.value && categorySel.value !== '__new__' ? categorySel.selectedOptions[0]?.textContent || '' : '',
            };
            StatsPage.data = await api('stats:save', draft.botId, payload);
            toast(existing ? 'Server stats saved' : 'Counters made');
            StatsPage.rerender();
          },
        },
      ],
    });
  },
};

// Counts were read: refresh the page if it's showing.
let statsRefresh;
onEvent('stats:changed', () => {
  clearTimeout(statsRefresh);
  statsRefresh = setTimeout(() => {
    if (App.route.page !== 'stats' || document.querySelector('#modal-root .modal')) return;
    StatsPage.load();
  }, 400);
});
