// Announcements page: build a message (text, ping, card, link buttons), send it now or on a schedule,
// and edit it in place later. Scheduled ones are sent by the main process (src/main/announce.js)
// while the app is open or in the tray.

const ANNOUNCE_REPEATS = [['once', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']];
const ANNOUNCE_MAX_FIELDS = 25;
const ANNOUNCE_MAX_BUTTONS = 5;

// A local date and time for <input type="datetime-local">, and back.
const toLocalInput = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value) => (value ? new Date(value).getTime() : 0);
const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const AnnouncePage = {
  data: null,
  error: null,
  loading: false,
  images: {},

  async load() {
    AnnouncePage.loading = true;
    try {
      AnnouncePage.data = await api('announce:list');
      AnnouncePage.error = null;
    } catch (err) {
      AnnouncePage.error = err.message;
    }
    AnnouncePage.loading = false;
    AnnouncePage.rerender();
  },

  rerender() {
    if (App.route.page !== 'announce') return;
    const scroll = document.getElementById('announce-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('announce-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = AnnouncePage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Your bot posts the announcements. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('post'), h('h3', null, 'No announcements yet'), h('p', null, 'Build a message with a card, pictures and link buttons. Send it now, schedule it, or repeat it every day, week or month.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'New announcement')));
    } else content = h('div', { class: 'stack', style: { gap: '12px' } }, list.map((a) => page.card(a)));

    return h(
      'div',
      { class: 'settings', id: 'announce-page' },
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
            h('h1', null, 'Announcements'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Build messages with a card, pictures and link buttons, send them now or on a schedule, and edit them in place later (handy for a rules channel). Scheduled messages go out while this app is open or in the tray.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'New announcement'),
        ),
        content,
      ),
    );
  },

  card(a) {
    const s = a.schedule || {};
    const badges = [];
    if (s.on && s.nextAt) badges.push(h('span', { class: 'badge teal' }, icon('clock'), `${s.repeat === 'once' ? 'Scheduled' : ANNOUNCE_REPEATS.find(([r]) => r === s.repeat)[1]} · next ${fmtWhen(s.nextAt)}`));
    if (a.missedAt) badges.push(h('span', { class: 'badge coral' }, icon('alert'), `Missed ${fmtWhen(a.missedAt)} (the app was closed)`));
    if (a.lastSentAt) badges.push(h('span', { class: 'badge' }, `Sent ${fmtRelative(a.lastSentAt)}`));
    if (!badges.length) badges.push(h('span', { class: 'badge' }, 'Draft'));
    const sendNow = h('button', { class: 'btn sm' }, icon('send'), a.lastSentAt ? 'Send again' : 'Send now');
    sendNow.addEventListener('click', withBusy(sendNow, async () => {
      if (!(await confirmDialog({ title: `Send "${a.name}" now?`, message: `It is posted in #${a.channelName || a.channelId}${a.ping !== 'none' ? `, pinging ${a.ping === 'everyone' ? '@everyone' : a.ping === 'here' ? '@here' : `@${a.pingName || 'a role'}`}` : ''}.`, confirmLabel: 'Send' }))) return;
      AnnouncePage.data = await api('announce:send', a.botId, a.guildId, a.id);
      toast(`Sent in #${a.channelName || 'the channel'}`);
      AnnouncePage.rerender();
    }));
    const update = h('button', { class: 'btn sm' }, icon('refresh'), 'Update in Discord');
    update.addEventListener('click', withBusy(update, async () => {
      AnnouncePage.data = await api('announce:update', a.botId, a.guildId, a.id);
      toast('The message in Discord now matches');
      AnnouncePage.rerender();
    }));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('post'), h('h3', { class: 'grow ellipsis' }, a.name)),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '-4px' } }, `#${a.channelName || a.channelId} in ${a.guildName || 'a server'} · via ${displayName(App.bot(a.botId))}`),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } }, badges),
      a.problem ? h('div', { class: 'callout warn', style: { marginTop: '10px' } }, icon('alert'), h('div', null, a.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '12px' } },
        h('button', { class: 'btn sm', onclick: () => AnnouncePage.edit(a) }, icon('edit'), 'Edit'),
        sendNow,
        a.lastMessageId ? update : null,
        a.lastMessageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${a.guildId}/${a.lastChannelId || a.channelId}/${a.lastMessageId}`) }, icon('external'), 'Open in Discord') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => AnnouncePage.remove(a) }, icon('trash'), 'Delete'),
      ),
    );
  },

  async remove(a) {
    let deleteMessage = false;
    const ok = await confirmDialog({
      title: `Delete "${a.name}"?`,
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, a.schedule?.on ? 'It is taken off the schedule.' : 'It is removed from this list.'), a.lastMessageId ? switchEl(false, (val) => (deleteMessage = val), 'Also delete the message it posted in Discord') : null),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      AnnouncePage.data = await api('announce:delete', a.botId, a.guildId, a.id, deleteMessage);
      toast('Announcement deleted');
    } catch (err) {
      toastError(err);
    }
    AnnouncePage.rerender();
  },

  async image(file) {
    if (!file) return null;
    if (!(file in AnnouncePage.images)) AnnouncePage.images[file] = await api('announce:image', file).catch(() => null);
    return AnnouncePage.images[file];
  },

  /* ---------- Builder ---------- */
  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const blankEmbed = { on: true, title: '', url: '', description: '', color: 0x7f8cf0, author: { name: '', icon: '' }, image: '', imageFile: '', thumbnail: '', footer: '', timestamp: false, fields: [] };
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', guildName: '', channelId: '', name: '', ping: 'none', content: '', embed: blankEmbed, buttons: [], schedule: { on: false, at: Date.now() + 3600e3, repeat: 'once' } };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    const e = draft.embed;
    let roles = [];

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); drawPreview(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '', (v) => { draft.channelId = v; });
    const pingSel = selectEl([['none', 'No ping']], draft.ping, (v) => { draft.ping = v; drawPreview(); });
    botSel.disabled = !!existing?.lastMessageId;
    guildSel.disabled = !!existing?.lastMessageId;
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
    const loadServer = async () => {
      let channels = [];
      roles = [];
      if (draft.guildId) {
        try {
          const [list, roleList] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`)]);
          channels = list.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
          roles = roleList.filter((r) => r.id !== draft.guildId && !r.managed).sort((a, b) => b.position - a.position);
        } catch {
          channels = [];
        }
      }
      options(channelSel, draft.guildId ? [['', 'Pick a channel…'], ...channels.map((c) => [c.id, `#${c.name}${c.type === 5 ? ' (announcements)' : ''}`])] : [['', 'Pick a server first']], draft.channelId);
      options(pingSel, [['none', 'No ping'], ['everyone', '@everyone'], ['here', '@here (online members)'], ...roles.map((r) => [r.id, `@${r.name}`])], draft.ping);
      if (draft.guildId) {
        draft.channelId = channelSel.value;
        draft.ping = pingSel.value;
      }
      drawPreview();
    };

    // Inputs that redraw the preview as you type.
    const input = (obj, key, attrs = {}) => {
      const el = h(attrs.rows ? 'textarea' : 'input', { class: attrs.rows ? 'textarea' : 'input', ...attrs }, attrs.rows ? obj[key] : null);
      if (!attrs.rows) el.value = obj[key] ?? '';
      el.addEventListener('input', () => { obj[key] = el.value; drawPreviewSoon(); });
      return el;
    };
    const colour = h('input', { type: 'color', class: 'color-input', value: `#${Number(e.color).toString(16).padStart(6, '0')}` });
    colour.addEventListener('input', () => { e.color = parseInt(colour.value.slice(1), 16); drawPreviewSoon(); });

    // The card's picture: one picked from the PC (attached when sent) or a web address.
    const imageHost = h('div', { class: 'stack', style: { gap: '8px' } });
    function drawImage() {
      const pick = h('button', { type: 'button', class: 'btn sm' }, icon('image'), e.imageFile ? 'Change picture' : 'Choose a picture…');
      pick.addEventListener('click', withBusy(pick, async () => {
        const picked = await api('announce:pickImage');
        if (!picked) return;
        AnnouncePage.images[picked.file] = picked.dataUrl;
        e.imageFile = picked.file;
        e.image = '';
        drawImage();
        drawPreview();
      }));
      imageHost.replaceChildren(
        h('div', { class: 'row wrap' }, pick, e.imageFile ? h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { e.imageFile = ''; drawImage(); drawPreview(); } }, icon('x'), 'Remove picture') : null),
        e.imageFile ? null : input(e, 'image', { placeholder: 'or paste an image link (https://…)', maxlength: 2048 }),
      );
    }

    const fieldsHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const addField = h('button', { type: 'button', class: 'btn sm' }, icon('plus'), 'Add a field');
    addField.addEventListener('click', () => { e.fields.push({ name: '', value: '', inline: true }); drawFields(); drawPreview(); });
    function drawFields() {
      fieldsHost.replaceChildren(
        ...e.fields.map((f, i) =>
          h(
            'div',
            { class: 'announce-field' },
            h('div', { class: 'grow stack', style: { gap: '6px' } }, input(f, 'name', { placeholder: 'Field title', maxlength: 256 }), input(f, 'value', { rows: 2, placeholder: 'Field text', maxlength: 1024 })),
            h('div', { class: 'stack', style: { gap: '6px', alignItems: 'flex-end' } }, switchEl(f.inline, (v) => { f.inline = v; drawPreview(); }, 'Side by side'), h('button', { type: 'button', class: 'icon-btn danger', title: 'Remove', onclick: () => { e.fields.splice(i, 1); drawFields(); drawPreview(); } }, icon('x'))),
          ),
        ),
      );
      addField.disabled = e.fields.length >= ANNOUNCE_MAX_FIELDS;
    }

    const buttonsHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const addButton = h('button', { type: 'button', class: 'btn sm' }, icon('plus'), 'Add a link button');
    addButton.addEventListener('click', () => { draft.buttons.push({ label: '', url: '' }); drawButtons(); drawPreview(); });
    function drawButtons() {
      buttonsHost.replaceChildren(
        ...draft.buttons.map((b, i) =>
          h('div', { class: 'announce-button-row' }, input(b, 'label', { placeholder: 'Button text', maxlength: 80 }), input(b, 'url', { placeholder: 'https://…', maxlength: 2048 }), h('button', { type: 'button', class: 'icon-btn danger', title: 'Remove', onclick: () => { draft.buttons.splice(i, 1); drawButtons(); drawPreview(); } }, icon('x'))),
        ),
      );
      addButton.disabled = draft.buttons.length >= ANNOUNCE_MAX_BUTTONS;
    }

    // Schedule
    const when = h('input', { type: 'datetime-local', class: 'input', value: toLocalInput(draft.schedule.at || Date.now() + 3600e3) });
    when.addEventListener('change', () => { draft.schedule.at = fromLocalInput(when.value); });
    const repeat = selectEl(ANNOUNCE_REPEATS, draft.schedule.repeat || 'once', (v) => { draft.schedule.repeat = v; });
    const scheduleBox = h('div', { class: 'grid cols-2', style: { gap: '12px', display: draft.schedule.on ? '' : 'none' } }, field('Send on', when), field('Repeat', repeat));

    const cardBox = h('div', { class: 'stack', style: { gap: '12px', display: e.on ? '' : 'none' } });
    cardBox.append(
      h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Title', input(e, 'title', { maxlength: 256 })), field('Title link (optional)', input(e, 'url', { placeholder: 'https://…', maxlength: 2048 }))),
      field('Text', input(e, 'description', { rows: 5, maxlength: 4096 }), 'Discord formatting works: **bold**, *italics*, [links](https://…), lists and more.'),
      h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Author (optional)', input(e.author, 'name', { maxlength: 256 })), field('Author picture link', input(e.author, 'icon', { placeholder: 'https://…', maxlength: 2048 }))),
      field('Big picture', imageHost),
      field('Small picture, top right (link)', input(e, 'thumbnail', { placeholder: 'https://…', maxlength: 2048 })),
      h('div', { class: 'row', style: { marginTop: '2px' } }, h('div', { class: 'label grow' }, 'Fields'), addField),
      fieldsHost,
      h('div', { class: 'grid cols-2', style: { gap: '12px', alignItems: 'end' } }, field('Footer', input(e, 'footer', { maxlength: 2048 })), switchEl(e.timestamp, (v) => { e.timestamp = v; drawPreview(); }, 'Show the date and time it was sent')),
      field('Colour', colour),
    );

    /* Preview */
    const preview = h('div', { class: 'rr-preview announce-preview' });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 120);
    }
    async function drawPreview() {
      const bot = App.bot(draft.botId);
      const pingRole = roles.find((r) => r.id === draft.ping);
      const ping = draft.ping === 'everyone' ? '@everyone' : draft.ping === 'here' ? '@here' : pingRole ? `@${pingRole.name}` : '';
      const text = (t) => Updater.inline(t);
      const parts = [h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(bot, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(bot)), h('span', { class: 'badge peri' }, 'APP'))];
      if (ping || draft.content.trim()) parts.push(h('div', { class: 'rr-text' }, ping ? h('span', { class: 'rr-mention', style: pingRole?.color ? { color: roleColor(pingRole) } : null }, ping) : null, ping && draft.content.trim() ? ' ' : null, text(draft.content.trim())));
      if (e.on) {
        const image = e.imageFile ? await AnnouncePage.image(e.imageFile) : e.image;
        const fields = e.fields.filter((f) => f.name || f.value);
        parts.push(
          h(
            'div',
            { class: 'rr-embed announce-embed', style: { borderLeftColor: colour.value } },
            h(
              'div',
              { class: 'announce-embed-top' },
              h(
                'div',
                { class: 'grow', style: { minWidth: 0 } },
                e.author.name ? h('div', { class: 'announce-author' }, e.author.icon ? h('img', { src: e.author.icon, alt: '' }) : null, e.author.name) : null,
                e.title ? h('div', { class: `rr-title ${e.url ? 'announce-link' : ''}` }, e.title) : null,
                e.description ? h('div', { class: 'rr-text' }, text(e.description)) : null,
                fields.length ? h('div', { class: 'announce-fields' }, fields.map((f) => h('div', { class: f.inline ? 'inline' : 'full' }, h('b', null, f.name), h('div', { class: 'rr-text' }, text(f.value))))) : null,
              ),
              e.thumbnail ? h('img', { class: 'announce-thumb', src: e.thumbnail, alt: '' }) : null,
            ),
            image ? h('img', { class: 'announce-image', src: image, alt: '' }) : null,
            e.footer || e.timestamp ? h('div', { class: 'poll-footer' }, [e.footer, e.timestamp ? 'Today at 12:00' : ''].filter(Boolean).join(' • ')) : null,
          ),
        );
      }
      const buttons = draft.buttons.filter((b) => b.label);
      if (buttons.length) parts.push(h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } }, buttons.map((b) => h('span', { class: 'ticket-button', style: { background: '#4e5058' } }, b.label, icon('external')))));
      preview.replaceChildren(...parts);
    }

    loadGuilds();
    drawImage();
    drawFields();
    drawButtons();
    drawPreview();

    const payload = () => ({ ...draft, guildId: guildSel.value, guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName, channelId: channelSel.value, channelName: (channelSel.selectedOptions[0]?.textContent || '').replace(/^#/, '').replace(/ \(announcements\)$/, ''), ping: pingSel.value, pingName: (pingSel.selectedOptions[0]?.textContent || '').replace(/^@/, '') });
    const check = () => {
      if (!guildSel.value || !channelSel.value) throw new Error('Pick the server and channel.');
    };
    const actions = [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save',
        kind: 'ghost',
        icon: 'save',
        onClick: async () => {
          check();
          AnnouncePage.data = await api('announce:save', draft.botId, payload());
          toast(draft.schedule.on ? `Scheduled for ${fmtWhen(draft.schedule.at)}` : 'Saved');
          AnnouncePage.rerender();
        },
      },
    ];
    if (existing?.lastMessageId) {
      actions.push({
        label: 'Save and update in Discord',
        kind: 'ghost',
        icon: 'refresh',
        onClick: async () => {
          check();
          const list = await api('announce:save', draft.botId, payload());
          AnnouncePage.data = await api('announce:update', draft.botId, guildSel.value, existing.id).catch((err) => {
            AnnouncePage.data = list;
            throw err;
          });
          toast('Saved, and the message in Discord now matches');
          AnnouncePage.rerender();
        },
      });
    }
    actions.push({
      label: 'Send now',
      kind: 'primary',
      icon: 'send',
      onClick: async () => {
        check();
        const p = payload();
        if (p.ping !== 'none' && !(await confirmDialog({ title: 'Send it now?', message: `This pings ${p.ping === 'everyone' ? '@everyone' : p.ping === 'here' ? '@here' : `@${p.pingName}`}.`, confirmLabel: 'Send' }))) return false;
        // Sent now, a one-off schedule has done its job; a repeating one carries on.
        const schedule = p.schedule.on && p.schedule.repeat !== 'once' ? p.schedule : { ...p.schedule, on: false };
        AnnouncePage.data = await api('announce:save', draft.botId, { ...p, schedule }, { send: true });
        toast(`Sent in #${p.channelName}`);
        AnnouncePage.rerender();
      },
    });

    return openModal({
      title: existing ? `Edit "${existing.name}"` : 'New announcement',
      wide: 'xl',
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor welcome-editor' },
        h(
          'div',
          { class: 'stack', style: { gap: '14px' } },
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Post in', channelSel), field('Ping', pingSel)),
          field('Name (only shown in this app)', input(draft, 'name', { maxlength: 80, placeholder: 'e.g. Weekly event reminder' })),
          field('Message', input(draft, 'content', { rows: 3, maxlength: 2000, placeholder: 'Text above the card (optional)' })),
          h('div', { class: 'ticket-section' }, switchEl(e.on, (v) => { e.on = v; cardBox.style.display = v ? '' : 'none'; drawPreview(); }, 'Add a card'), cardBox),
          h('div', { class: 'ticket-section' }, h('div', { class: 'row' }, h('div', { class: 'ticket-section-title grow' }, 'Link buttons'), addButton), buttonsHost),
          h('div', { class: 'ticket-section' }, switchEl(draft.schedule.on, (v) => { draft.schedule.on = v; scheduleBox.style.display = v ? '' : 'none'; }, 'Schedule it'), scheduleBox, h('p', { class: 'hint', style: { margin: 0 } }, "Scheduled messages go out while this app is open or in the tray, at your PC's time.")),
        ),
        h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview'), preview),
      ),
      actions,
    });
  },
};

// Something was sent on schedule: refresh the list if it's showing.
onEvent('announce:changed', () => {
  if (App.route.page !== 'announce' || document.querySelector('#modal-root .modal')) return;
  AnnouncePage.load();
});
