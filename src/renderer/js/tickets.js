// Tickets page: panels members press to open a private support channel, the tickets that are open,
// and transcripts of closed ones. The buttons are answered by the ticket engine (src/main/tickets.js),
// in the mod portal or in this app.

const TICKET_BUTTON_STYLES = [['primary', 'Blurple', '#5865f2'], ['secondary', 'Grey', '#4e5058'], ['success', 'Green', '#248046'], ['danger', 'Red', '#da373c']];
const TICKET_DEFAULTS = {
  panel: { style: 'embed', title: 'Need help?', text: 'Press the button below to open a support ticket. Only you and our staff can see it.', color: 0x7f8cf0, button: { label: 'Open a ticket', emoji: { name: '🎫' }, style: 'primary' } },
  ticket: { title: 'Thanks for reaching out, {user}!', text: 'Write a short description of your issue below, and add screenshots if they help. A moderator or the owner will be with you soon.', color: 0x0bbfbc },
};
const NEW_CHANNEL = '__new__';
const hex = (n) => `#${Number(n ?? 0).toString(16).padStart(6, '0')}`;

const TicketsPage = {
  data: null,
  error: null,
  loading: false,

  async load() {
    TicketsPage.loading = true;
    try {
      TicketsPage.data = await api('tickets:list');
      TicketsPage.error = null;
    } catch (err) {
      TicketsPage.error = err.message;
    }
    TicketsPage.loading = false;
    TicketsPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'tickets') return;
    const scroll = document.getElementById('tickets-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('tickets-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = TicketsPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Tickets are opened and kept by your bot. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('ticket'), h('h3', null, 'No ticket panels yet'), h('p', null, 'Post a message with a button. Members press it to get a private channel with your staff, who claim the ticket and close it when it is sorted. Every closed ticket is saved as a transcript, images included.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'New ticket panel')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((p) => page.panelCard(p)));

    return h(
      'div',
      { class: 'settings', id: 'tickets-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Support'),
            h('h1', null, 'Tickets'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Members press a button to open a private channel that only they and your staff can see. Staff claim it, and closing it saves the whole conversation, images included, to your ticket log channel.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'New ticket panel'),
        ),
        content,
      ),
    );
  },

  panelCard(p) {
    const bot = App.bot(p.botId);
    const answered =
      p.answeredBy === 'portal'
        ? h('span', { class: 'badge teal', title: 'Your mod portal answers the buttons, even when this app is closed.' }, 'Answered around the clock by your portal')
        : h('span', { class: 'badge gold', title: 'Turn on slash commands on the Home page to have your mod portal answer around the clock.' }, 'Answered while this app runs');
    const line = (ic, label, value) => h('div', { class: 'ticket-line' }, icon(ic), h('span', { class: 'subtle' }, label), h('span', { class: 'ellipsis' }, value));
    const history = h('button', { class: 'btn sm' }, icon('list'), 'Tickets & transcripts');
    history.addEventListener('click', withBusy(history, () => TicketsPage.history(p)));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('ticket'), h('h3', { class: 'grow ellipsis' }, p.panel.title || p.panel.button.label), answered),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '-4px' } }, `Panel in #${p.panel.channelName || p.panel.channelId} · ${p.guildName || 'a server'} · via ${bot ? displayName(bot) : 'a removed bot'}`),
      h(
        'div',
        { class: 'stack', style: { gap: '6px', marginTop: '12px' } },
        line('folder', 'Tickets go in', p.categoryName ? p.categoryName : 'No category'),
        line('archive', 'Transcripts go to', `#${p.logChannelName || p.logChannelId}`),
        line('shield', 'Staff', p.supportRoles.length ? `${p.supportRoles.length} support role${p.supportRoles.length === 1 ? '' : 's'}, plus admins` : 'Admins and members who can manage channels'),
      ),
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        history,
        h('button', { class: 'btn sm', onclick: () => TicketsPage.edit(p) }, icon('edit'), 'Edit'),
        p.panelMessageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${p.guildId}/${p.panel.channelId}/${p.panelMessageId}`) }, icon('external'), 'Open in Discord') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => TicketsPage.remove(p) }, icon('trash'), 'Delete'),
      ),
    );
  },

  async remove(p) {
    let deletePanel = true;
    const ok = await confirmDialog({
      title: 'Delete this ticket panel?',
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Members can no longer open tickets from it. Tickets that are open stay open and can still be claimed and closed, and saved transcripts stay in the log channel.'), switchEl(true, (v) => (deletePanel = v), 'Also delete the panel message in Discord')),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      TicketsPage.data = await api('tickets:delete', p.botId, p.guildId, p.id, deletePanel);
      toast('Ticket panel deleted');
    } catch (err) {
      toastError(err);
    }
    TicketsPage.rerender();
  },

  /* ---------- Open tickets and transcripts ---------- */
  async history(p) {
    const data = await api('tickets:history', p.botId, p.guildId, p.id);
    const name = (id) => (id ? data.users[id] || 'someone' : 'Nobody');
    const openRows = data.open.length
      ? data.open.map((t) =>
          h(
            'div',
            { class: 'list-row' },
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'primary ellipsis' }, `#${t.name}`), h('div', { class: 'secondary' }, `Opened by ${name(t.userId)} ${fmtRelative(t.openedAt)} · ${t.claimedBy ? `claimed by ${name(t.claimedBy)}` : 'not claimed yet'}`)),
            h('span', { class: `badge ${t.claimedBy ? 'teal' : 'gold'}` }, t.claimedBy ? 'Claimed' : 'Waiting for staff'),
            h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${p.guildId}/${t.channelId}`) }, icon('external'), 'Open'),
          ),
        )
      : [h('div', { class: 'empty', style: { padding: '24px' } }, h('p', null, 'No tickets are open right now.'))];
    const closedRows = data.closed.length
      ? data.closed.map((t) => {
          const view = h('button', { class: 'btn sm', disabled: !t.transcript }, icon('eye'), 'View');
          view.addEventListener('click', withBusy(view, () => TicketsPage.viewTranscript(p, data.logChannelId, t)));
          const save = h('button', { class: 'btn sm ghost', disabled: !t.transcript, title: 'Save the transcript as a web page' }, icon('download'));
          save.addEventListener('click', withBusy(save, async () => {
            const file = await api('tickets:saveTranscript', p.botId, data.logChannelId, t.messageId);
            if (file) toast('Transcript saved');
          }));
          return h(
            'div',
            { class: 'list-row' },
            h(
              'div',
              { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 'primary ellipsis' }, `#${t.channelName}`, h('span', { class: 'subtle', style: { fontWeight: 400, marginLeft: '8px' } }, `${t.messages} message${t.messages === 1 ? '' : 's'}`)),
              h('div', { class: 'secondary' }, `Opened by ${name(t.openedBy)} · ${t.claimedBy ? `claimed by ${name(t.claimedBy)} · ` : ''}closed by ${name(t.closedBy)} ${fmtRelative(t.closedAt)}`),
              t.reason ? h('div', { class: 'audit-reason' }, h('span', { class: 'audit-reason-label' }, 'Reason'), h('span', null, t.reason)) : null,
            ),
            view,
            save,
          );
        })
      : [h('div', { class: 'empty', style: { padding: '24px' } }, h('p', null, 'No closed tickets yet. Their transcripts show up here.'))];
    openModal({
      title: `Tickets · ${p.panel.title || p.panel.button.label}`,
      wide: true,
      body: h(
        'div',
        { class: 'stack', style: { gap: '14px' } },
        h('div', { class: 'label' }, `Open (${data.open.length})`),
        h('div', { class: 'card flush' }, h('div', { class: 'list' }, openRows)),
        h('div', { class: 'label' }, `Closed (${data.closed.length})`),
        h('div', { class: 'card flush ticket-history' }, h('div', { class: 'list' }, closedRows)),
        h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', margin: 0 } }, 'Closed tickets are read from the log channel, so they stay even if this app is reinstalled.'),
      ),
      actions: [{ label: 'Close', kind: 'ghost' }],
    });
  },

  async viewTranscript(p, logChannelId, t) {
    const html = await api('tickets:transcript', p.botId, logChannelId, t.messageId);
    // Shown in a sandboxed frame: the page can't run anything or reach the app.
    const frame = h('iframe', { class: 'transcript-frame', sandbox: '', title: `Transcript of #${t.channelName}` });
    frame.srcdoc = html;
    openModal({
      title: `Transcript · #${t.channelName}`,
      wide: 'xl',
      body: frame,
      actions: [
        { label: 'Save as…', kind: 'ghost', icon: 'download', onClick: async () => { await api('tickets:saveTranscript', p.botId, logChannelId, t.messageId); return false; } },
        { label: 'Close', kind: 'primary' },
      ],
    });
  },

  /* ---------- Editor ---------- */
  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', guildName: '', panel: { ...JSON.parse(JSON.stringify(TICKET_DEFAULTS.panel)), channelId: '' }, ticket: { ...TICKET_DEFAULTS.ticket }, categoryId: NEW_CHANNEL, logChannelId: NEW_CHANNEL, supportRoles: [], pingSupport: true, namePrefix: 'ticket', userCanClose: true, askReason: true };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    let channels = [];
    let roles = [];
    let emojis = [];

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    botSel.disabled = !!existing;
    guildSel.disabled = !!existing;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.guildName = guildSel.selectedOptions[0]?.textContent || ''; loadServer(); });
    const panelSel = selectEl([['', 'Pick a server first']], '', (v) => { draft.panel.channelId = v; });
    const categorySel = selectEl([['', 'Pick a server first']], '', (v) => { draft.categoryId = v; });
    const logSel = selectEl([['', 'Pick a server first']], '', (v) => { draft.logChannelId = v; });
    const rolesHost = h('div', { class: 'ticket-roles' });

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
    const loadServer = async () => {
      channels = [];
      roles = [];
      emojis = [];
      if (draft.guildId) {
        try {
          [channels, roles, emojis] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/emojis`).catch(() => [])]);
        } catch {
          channels = [];
        }
      }
      const text = channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
      const cats = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      const none = draft.guildId ? 'Loading…' : 'Pick a server first';
      options(panelSel, text.length ? [['', 'Pick a channel…'], ...text.map((c) => [c.id, `#${c.name}`])] : [['', none]], draft.panel.channelId);
      options(categorySel, draft.guildId ? [[NEW_CHANNEL, '＋ Make a "Tickets" category'], ['', 'No category (top of the list)'], ...cats.map((c) => [c.id, c.name])] : [['', none]], draft.categoryId);
      options(logSel, draft.guildId ? [[NEW_CHANNEL, '＋ Make a private #ticket-logs channel'], ...text.map((c) => [c.id, `#${c.name}`])] : [['', none]], draft.logChannelId);
      // Only once a server is picked, so the placeholders don't replace the choices made so far.
      if (draft.guildId) {
        draft.panel.channelId = panelSel.value;
        draft.categoryId = categorySel.value;
        draft.logChannelId = logSel.value;
      }
      drawRoles();
      drawPreview();
    };

    function drawRoles() {
      const list = roles.filter((r) => r.id !== draft.guildId && !r.managed).sort((a, b) => b.position - a.position);
      draft.supportRoles = draft.supportRoles.filter((id) => !roles.length || list.some((r) => r.id === id));
      rolesHost.replaceChildren(
        ...(list.length
          ? list.map((r) => {
              const on = draft.supportRoles.includes(r.id);
              return h('button', { type: 'button', class: `chip ticket-role ${on ? 'on' : ''}`, onclick: () => { draft.supportRoles = on ? draft.supportRoles.filter((x) => x !== r.id) : [...draft.supportRoles, r.id]; drawRoles(); drawPreview(); } }, on ? icon('check') : h('span', { class: 'role-dot', style: { background: roleColor(r) } }), `@${r.name}`);
            })
          : [h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, draft.guildId ? 'Loading roles…' : 'Pick a server first')]),
      );
    }

    // Inputs that redraw the preview as you type.
    const input = (obj, key, attrs = {}) => {
      const el = h(attrs.rows ? 'textarea' : 'input', { class: attrs.rows ? 'textarea' : 'input', ...attrs }, attrs.rows ? obj[key] : null);
      if (!attrs.rows) el.value = obj[key] ?? '';
      el.addEventListener('input', () => { obj[key] = el.value; drawPreviewSoon(); });
      return el;
    };
    const colorInput = (obj, key) => {
      const el = h('input', { type: 'color', class: 'color-input', value: hex(obj[key]) });
      el.addEventListener('input', () => { obj[key] = parseInt(el.value.slice(1), 16); drawPreviewSoon(); });
      return el;
    };
    const b = draft.panel.button;
    const emojiBtn = h('button', { class: 'emoji-btn big', type: 'button', title: 'Button emoji' });
    const drawEmojiBtn = () => emojiBtn.replaceChildren(b.emoji ? emojiNode(b.emoji, 22) : h('span', { class: 'subtle' }, 'None'));
    emojiBtn.addEventListener('click', async () => {
      const emoji = await EmojiPicker.open(emojis);
      if (!emoji) return;
      b.emoji = emoji;
      drawEmojiBtn();
      drawPreview();
    });
    drawEmojiBtn();

    // Preview: the panel, and the first message inside a ticket.
    const preview = h('div', { class: 'stack', style: { gap: '12px' } });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 100);
    }
    const author = () => { const bot = App.bot(draft.botId); return h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(bot, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(bot)), h('span', { class: 'badge peri' }, 'APP')); };
    const button = (label, style, emoji, extra = {}) => h('span', { class: 'ticket-button', style: { background: TICKET_BUTTON_STYLES.find(([s]) => s === style)?.[2] || '#5865f2', opacity: extra.disabled ? 0.55 : 1 } }, emoji ? emojiNode(emoji, 16) : null, label);
    function drawPreview() {
      const p = draft.panel;
      const fill = (t) => String(t || '').replace(/\{user\}/g, 'Anna').replace(/\{mention\}/g, '@Anna').replace(/\{server\}/g, draft.guildName || 'your server');
      const panelInner = [p.title.trim() ? h('div', { class: 'rr-title' }, p.title.trim()) : null, p.text.trim() ? h('div', { class: 'rr-text' }, p.text.trim()) : null];
      const ticketRoles = draft.pingSupport ? roles.filter((r) => draft.supportRoles.includes(r.id)) : [];
      preview.replaceChildren(
        h('div', { class: 'label' }, 'The panel'),
        h('div', { class: 'rr-preview' }, author(), p.style === 'embed' ? h('div', { class: 'rr-embed', style: { borderLeftColor: hex(p.color) } }, panelInner) : h('div', { class: 'rr-plain' }, panelInner), h('div', { class: 'row', style: { marginTop: '8px' } }, button(b.label || 'Open a ticket', b.style, b.emoji))),
        h('div', { class: 'label' }, 'Inside a new ticket'),
        h(
          'div',
          { class: 'rr-preview' },
          author(),
          h('div', { class: 'rr-text' }, h('span', { class: 'rr-mention' }, '@Anna'), ...ticketRoles.map((r) => [' ', h('span', { class: 'rr-mention', style: { color: roleColor(r) } }, `@${r.name}`)])),
          h('div', { class: 'rr-embed', style: { borderLeftColor: hex(draft.ticket.color), marginTop: '6px' } }, fill(draft.ticket.title).trim() ? h('div', { class: 'rr-title' }, fill(draft.ticket.title)) : null, h('div', { class: 'rr-text' }, fill(draft.ticket.text)), h('div', { class: 'ticket-field' }, h('b', null, 'Opened by'), h('span', { class: 'rr-mention' }, '@Anna'))),
          h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } }, button('Claim', 'success', { name: '🙋' }), button('Close', 'danger', { name: '🔒' })),
        ),
      );
    }

    loadGuilds();
    drawRoles();
    drawPreview();

    const section = (title, ...children) => h('div', { class: 'ticket-section' }, h('div', { class: 'ticket-section-title' }, title), ...children);
    return openModal({
      title: existing ? 'Edit ticket panel' : 'New ticket panel',
      wide: 'xl',
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor welcome-editor' },
        h(
          'div',
          { class: 'stack', style: { gap: '18px' } },
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)),
          section(
            'The "open a ticket" message',
            field('Post in', panelSel),
            h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Look', selectEl([['embed', 'Card (embed)'], ['text', 'Plain message']], draft.panel.style, (v) => { draft.panel.style = v; drawPreview(); })), field('Card colour', colorInput(draft.panel, 'color'))),
            field('Title', input(draft.panel, 'title', { maxlength: 256 })),
            field('Message', input(draft.panel, 'text', { rows: 3, maxlength: 2000 })),
            h('div', { class: 'ticket-button-row' }, field('Button text', input(b, 'label', { maxlength: 80 })), field('Emoji', h('div', { class: 'row', style: { gap: '6px' } }, emojiBtn, h('button', { type: 'button', class: 'icon-btn', title: 'No emoji', onclick: () => { b.emoji = null; drawEmojiBtn(); drawPreview(); } }, icon('x')))), field('Colour', selectEl(TICKET_BUTTON_STYLES.map(([s, label]) => [s, label]), b.style, (v) => { b.style = v; drawPreview(); }))),
          ),
          section(
            'Ticket channels',
            h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Open tickets go in', categorySel), field('Channel names start with', input(draft, 'namePrefix', { maxlength: 20, placeholder: 'ticket' }), 'e.g. ticket-anna')),
            field('Staff (support roles)', rolesHost, 'Only the member, these roles and admins can see a ticket. Staff can claim and close tickets.'),
            h('div', { class: 'stack', style: { gap: '8px' } }, switchEl(draft.pingSupport, (v) => { draft.pingSupport = v; drawPreview(); }, 'Ping the support roles when a ticket opens'), switchEl(draft.userCanClose, (v) => { draft.userCanClose = v; }, 'Members can close their own tickets'), switchEl(draft.askReason, (v) => { draft.askReason = v; }, 'Ask for a reason when closing')),
          ),
          section(
            'Message inside a new ticket',
            field('Title', input(draft.ticket, 'title', { maxlength: 256 })),
            field('Message', input(draft.ticket, 'text', { rows: 4, maxlength: 1500 }), 'You can use {user}, {mention} and {server}. The Claim and Close buttons are added under it.'),
            field('Card colour', colorInput(draft.ticket, 'color')),
          ),
          section('Transcripts', field('Save transcripts in', logSel, 'When a ticket closes, its whole conversation (images included) is saved here, with a link to read it. Keep this channel private to staff.')),
        ),
        h('div', null, preview, h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, 'The bot needs Manage Channels, Manage Roles, Send Messages, Attach Files and Read Message History.')),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save and update panel' : 'Post in Discord',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            if (!guildSel.value) throw new Error('Pick the server.');
            if (!panelSel.value) throw new Error('Pick the channel for the panel.');
            const name = (sel) => (sel.selectedOptions[0]?.textContent || '').replace(/^#/, '');
            const payload = {
              ...draft,
              guildId: guildSel.value,
              guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName,
              panel: { ...draft.panel, channelId: panelSel.value, channelName: name(panelSel) },
              createCategory: categorySel.value === NEW_CHANNEL,
              categoryId: categorySel.value === NEW_CHANNEL ? '' : categorySel.value,
              categoryName: categorySel.value && categorySel.value !== NEW_CHANNEL ? name(categorySel) : '',
              createLogChannel: logSel.value === NEW_CHANNEL,
              logChannelId: logSel.value === NEW_CHANNEL ? '' : logSel.value,
              logChannelName: logSel.value === NEW_CHANNEL ? '' : name(logSel),
            };
            TicketsPage.data = await api('tickets:save', draft.botId, payload);
            toast(existing ? 'Ticket panel updated' : `Posted in #${payload.panel.channelName}`);
            TicketsPage.rerender();
          },
        },
      ],
    });
  },
};
