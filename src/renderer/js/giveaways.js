// Giveaways page: post a prize members enter by reacting (with 🎉 or an emoji you pick), now or at a set time. At the
// enter-by time the bot picks the winners at random, pings them and lists them on the post. They're
// posted and drawn by the main process (src/main/giveaways.js) while the app is open or in the tray,
// or by the mod portal with 24/7 on. Uses the date helpers from announce.js.

const GIVEAWAY_MAX_WINNERS = 20;
const GIVEAWAY_ENTRIES_FRESH_MS = 60 * 1000;

const GiveawaysPage = {
  data: null,
  error: null,
  loading: false,
  entries: {}, // giveaway id -> { count, at }

  async load() {
    GiveawaysPage.loading = true;
    try {
      GiveawaysPage.data = await api('giveaways:list');
      GiveawaysPage.error = null;
    } catch (err) {
      GiveawaysPage.error = err.message;
    }
    GiveawaysPage.loading = false;
    GiveawaysPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'giveaways') return;
    const scroll = document.getElementById('giveaways-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('giveaways-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = GiveawaysPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Your bot posts the giveaways and picks the winners. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('gift'), h('h3', null, 'No giveaways yet'), h('p', null, 'Post a prize, pick how many win and when entries close. Members enter by reacting with 🎉 or an emoji you pick, and the bot picks the winners for you.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'New giveaway')));
    } else content = h('div', { class: 'stack', style: { gap: '12px' } }, list.map((g) => page.card(g)));

    return h(
      'div',
      { class: 'settings', id: 'giveaways-page' },
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
            h('h1', null, 'Giveaways'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, "Post a prize, now or later. Members enter by reacting with 🎉 (or any emoji you pick, your server's own included), and at the enter-by time the bot picks the winners at random from them, pings them and lists them on the post. Giveaways are posted and drawn while this app is open or in the tray, or around the clock with Run 24/7."),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'New giveaway'),
        ),
        content,
      ),
    );
  },

  // "Ava, Ben and Cleo"
  names(winners) {
    const list = winners.map((w) => w.name || w.id);
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '';
  },

  card(g) {
    const s = g.start || {};
    const running = g.messageId && !g.endedAt;
    const badges = [];
    if (g.endedAt) badges.push(h('span', { class: 'badge' }, icon('check'), `Ended ${fmtRelative(g.endedAt)}`));
    else if (running) badges.push(h('span', { class: 'badge teal' }, icon('clock'), `Running · enter by ${fmtWhen(g.endsAt)}`));
    else if (s.on) badges.push(h('span', { class: 'badge teal' }, icon('clock'), `Posts ${fmtWhen(s.at)} · enter by ${fmtWhen(g.endsAt)}`));
    if (g.missedAt) badges.push(h('span', { class: 'badge coral' }, icon('alert'), `Missed ${fmtWhen(g.missedAt)} (the app was closed)`));
    if (!badges.length) badges.push(h('span', { class: 'badge' }, 'Draft'));
    badges.push(h('span', { class: 'badge' }, `${g.winners} ${g.winners === 1 ? 'winner' : 'winners'}`));
    if (g.endedAt) badges.push(h('span', { class: 'badge' }, `${fmtNum(g.entries || 0)} entered`));
    if (running) {
      const entered = h('span', { class: 'badge' }, '… entered');
      GiveawaysPage.entryCount(g).then((n) => (entered.textContent = n == null ? "Couldn't count entries" : `${fmtNum(n)} entered`));
      badges.push(entered);
    }

    const won = g.winnerList || [];
    const result = g.endedAt
      ? h('div', { class: 'giveaway-result' }, icon('crown'), h('div', null, won.length ? [h('b', null, won.length === 1 ? 'Winner: ' : 'Winners: '), GiveawaysPage.names(won)] : g.entries ? 'Nobody who entered could win: they left, or lack the role.' : 'Nobody entered.'))
      : null;

    const postNow = h('button', { class: 'btn sm' }, icon('send'), 'Post now');
    postNow.addEventListener('click', withBusy(postNow, async () => {
      if (!(await confirmDialog({ title: `Post "${g.prize}" now?`, message: `It is posted in #${g.channelName || g.channelId}${g.ping !== 'none' ? `, pinging ${GiveawaysPage.pingText(g)}` : ''}. Members can enter until ${fmtWhen(g.endsAt)}.`, confirmLabel: 'Post' }))) return;
      GiveawaysPage.data = await api('giveaways:post', g.botId, g.guildId, g.id);
      toast(`Posted in #${g.channelName || 'the channel'}`);
      GiveawaysPage.rerender();
    }));
    const endNow = h('button', { class: 'btn sm' }, icon('gift'), 'End now');
    endNow.addEventListener('click', withBusy(endNow, async () => {
      if (!(await confirmDialog({ title: `End "${g.prize}" now?`, message: `Entries close now, and the bot picks ${g.winners === 1 ? 'the winner' : `${g.winners} winners`} and pings them in #${g.channelName || g.channelId}.`, confirmLabel: 'End and pick winners' }))) return;
      GiveawaysPage.data = await api('giveaways:end', g.botId, g.guildId, g.id);
      toast('Winners picked');
      GiveawaysPage.rerender();
    }));
    const again = h('button', { class: 'btn sm' }, icon('refresh'), 'Pick again');
    again.addEventListener('click', withBusy(again, () => GiveawaysPage.reroll(g)));

    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('gift'), h('h3', { class: 'grow ellipsis' }, g.prize)),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '-4px' } }, `#${g.channelName || g.channelId} in ${g.guildName || 'a server'} · via ${displayName(App.bot(g.botId))}${g.requiredRole ? ` · only @${g.requiredRoleName || 'a role'} can win` : ''}`),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } }, badges),
      result,
      g.problem ? h('div', { class: 'callout warn', style: { marginTop: '10px' } }, icon('alert'), h('div', null, g.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '12px' } },
        g.endedAt ? null : h('button', { class: 'btn sm', onclick: () => GiveawaysPage.edit(g) }, icon('edit'), 'Edit'),
        g.messageId ? null : postNow,
        running ? endNow : null,
        g.endedAt && g.messageId && g.entries ? again : null,
        g.messageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}`) }, icon('external'), 'Open in Discord') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => GiveawaysPage.remove(g) }, icon('trash'), 'Delete'),
      ),
    );
  },

  pingText(g) {
    return g.ping === 'everyone' ? '@everyone' : g.ping === 'here' ? '@here' : `@${g.pingName || 'a role'}`;
  },

  // Entries so far, read from the reactions on the post at most once a minute.
  async entryCount(g) {
    const cached = GiveawaysPage.entries[g.id];
    if (cached && Date.now() - cached.at < GIVEAWAY_ENTRIES_FRESH_MS) return cached.count;
    const count = await api('giveaways:entries', g.botId, g.guildId, g.id).catch(() => null);
    GiveawaysPage.entries[g.id] = { count, at: Date.now() };
    return count;
  },

  // Pick new winners for the ones ticked (a winner who didn't reply, say), and for any places left unfilled.
  async reroll(g) {
    const winners = g.winnerList || [];
    const replace = new Set();
    const unfilled = Math.max(0, g.winners - winners.length);
    const ok = await confirmDialog({
      title: `Pick again for "${g.prize}"?`,
      message: h(
        'div',
        { class: 'stack', style: { gap: '10px' } },
        winners.length ? h('p', null, 'Tick the winners to replace. New winners are picked at random from the members who entered and haven\'t won this giveaway, and pinged in a reply.') : null,
        winners.map((w) => {
          const box = h('input', { type: 'checkbox' });
          box.addEventListener('change', () => (box.checked ? replace.add(w.id) : replace.delete(w.id)));
          return h('label', { class: 'check-row' }, box, w.name || w.id);
        }),
        unfilled ? h('p', { class: 'subtle' }, `${unfilled} ${unfilled === 1 ? 'place wasn\'t' : 'places weren\'t'} filled the first time, so ${unfilled === 1 ? 'it\'s' : 'they\'re'} picked too.`) : null,
      ),
      confirmLabel: 'Pick again',
    });
    if (!ok) return;
    if (!replace.size && !unfilled) return toast('Tick the winners to replace first.', 'error');
    GiveawaysPage.data = await api('giveaways:reroll', g.botId, g.guildId, g.id, [...replace]);
    toast('New winners picked');
    GiveawaysPage.rerender();
  },

  async remove(g) {
    let deleteMessage = false;
    const ok = await confirmDialog({
      title: `Delete "${g.prize}"?`,
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, g.messageId && !g.endedAt ? 'It is removed from this list and no winners are picked.' : 'It is removed from this list.'), g.messageId ? switchEl(false, (val) => (deleteMessage = val), 'Also delete the giveaway post in Discord') : null),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      GiveawaysPage.data = await api('giveaways:delete', g.botId, g.guildId, g.id, deleteMessage);
      toast('Giveaway deleted');
    } catch (err) {
      toastError(err);
    }
    GiveawaysPage.rerender();
  },

  /* ---------- Builder ---------- */
  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const nextHour = Math.ceil(Date.now() / 3600e3) * 3600e3;
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', guildName: '', channelId: '', prize: '', description: '', winners: 1, endsAt: nextHour + 7 * 86400e3, requiredRole: '', ping: 'none', emoji: { name: '🎉' }, color: 0xfaa61a, image: '', imageFile: '', start: { on: false, at: nextHour } };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    if (!draft.emoji?.name) draft.emoji = { name: '🎉' };
    // Giveaways from before these existed.
    draft.ranBy ||= { name: '', icon: '' };
    draft.fields ||= [];
    draft.thumbnail ||= '';
    draft.footer ||= '';
    const posted = !!existing?.messageId;
    let roles = [];
    let emojis = []; // the server's own, for the emoji picker

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); drawPreview(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '', (v) => { draft.channelId = v; });
    const pingSel = selectEl([['none', 'No ping']], draft.ping, (v) => { draft.ping = v; drawPreview(); });
    const roleSel = selectEl([['', 'Anyone who enters']], draft.requiredRole, (v) => { draft.requiredRole = v; drawPreview(); });
    botSel.disabled = guildSel.disabled = channelSel.disabled = posted;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.guildName = guildSel.selectedOptions[0]?.textContent || ''; loadServer(); });

    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      try {
        const guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((x) => [x.id, x.name])], draft.guildId);
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
      emojis = [];
      if (draft.guildId) {
        try {
          const [list, roleList, emojiList] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/emojis`).catch(() => [])]);
          emojis = emojiList;
          channels = list.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
          roles = roleList.filter((r) => r.id !== draft.guildId && !r.managed).sort((a, b) => b.position - a.position);
        } catch {
          channels = [];
        }
      }
      options(channelSel, draft.guildId ? [['', 'Pick a channel…'], ...channels.map((c) => [c.id, `#${c.name}${c.type === 5 ? ' (announcements)' : ''}`])] : [['', 'Pick a server first']], draft.channelId);
      options(pingSel, [['none', 'No ping'], ['everyone', '@everyone'], ['here', '@here (online members)'], ...roles.map((r) => [r.id, `@${r.name}`])], draft.ping);
      options(roleSel, [['', 'Anyone who enters'], ...roles.map((r) => [r.id, `@${r.name}`])], draft.requiredRole);
      if (draft.guildId) {
        draft.channelId = channelSel.value;
        draft.ping = pingSel.value;
        draft.requiredRole = roleSel.value;
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
    const winnersInput = h('input', { type: 'number', class: 'input', min: 1, max: GIVEAWAY_MAX_WINNERS, value: draft.winners });
    winnersInput.addEventListener('input', () => { draft.winners = Number(winnersInput.value); drawPreviewSoon(); });
    const endsInput = h('input', { type: 'datetime-local', class: 'input', value: toLocalInput(draft.endsAt) });
    endsInput.addEventListener('change', () => { draft.endsAt = fromLocalInput(endsInput.value); drawPreview(); });
    const colour = h('input', { type: 'color', class: 'color-input', value: `#${Number(draft.color).toString(16).padStart(6, '0')}` });
    colour.addEventListener('input', () => { draft.color = parseInt(colour.value.slice(1), 16); drawPreviewSoon(); });
    // The emoji members react with: any standard one or one of the server's own.
    const emojiBtn = h('button', { class: 'emoji-btn big', type: 'button', title: posted ? "It can't change once posted" : 'Change emoji', disabled: posted }, emojiNode(draft.emoji, 26));
    emojiBtn.addEventListener('click', async () => {
      const emoji = await EmojiPicker.open(emojis);
      if (!emoji) return;
      draft.emoji = emoji;
      emojiBtn.replaceChildren(emojiNode(emoji, 26));
      drawPreview();
    });
    const emojiField = h('div', { class: 'row' }, emojiBtn);

    // The picture: one picked from the PC (attached when posted) or a web address.
    const imageHost = h('div', { class: 'stack', style: { gap: '8px' } });
    function drawImage() {
      const pick = h('button', { type: 'button', class: 'btn sm' }, icon('image'), draft.imageFile ? 'Change picture' : 'Choose a picture…');
      pick.addEventListener('click', withBusy(pick, async () => {
        const picked = await api('announce:pickImage');
        if (!picked) return;
        AnnouncePage.images[picked.file] = picked.dataUrl;
        draft.imageFile = picked.file;
        draft.image = '';
        drawImage();
        drawPreview();
      }));
      imageHost.replaceChildren(
        h('div', { class: 'row wrap' }, pick, draft.imageFile ? h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { draft.imageFile = ''; drawImage(); drawPreview(); } }, icon('x'), 'Remove picture') : null),
        draft.imageFile ? null : input(draft, 'image', { placeholder: 'or paste an image link (https://…)', maxlength: 2048 }),
      );
    }

    // Fields on the card, like an announcement's: a title and text, side by side or full width.
    const fieldsHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const addField = h('button', { type: 'button', class: 'btn sm' }, icon('plus'), 'Add a field');
    addField.addEventListener('click', () => { draft.fields.push({ name: '', value: '', inline: true }); drawFields(); drawPreview(); });
    function drawFields() {
      fieldsHost.replaceChildren(
        ...draft.fields.map((f, i) =>
          h(
            'div',
            { class: 'announce-field' },
            h('div', { class: 'grow stack', style: { gap: '6px' } }, input(f, 'name', { placeholder: 'Field title', maxlength: 256 }), input(f, 'value', { rows: 2, placeholder: 'Field text', maxlength: 1024 })),
            h('div', { class: 'stack', style: { gap: '6px', alignItems: 'flex-end' } }, switchEl(f.inline, (v) => { f.inline = v; drawPreview(); }, 'Side by side'), h('button', { type: 'button', class: 'icon-btn danger', title: 'Remove', onclick: () => { draft.fields.splice(i, 1); drawFields(); drawPreview(); } }, icon('x'))),
          ),
        ),
      );
      addField.disabled = draft.fields.length >= ANNOUNCE_MAX_FIELDS;
    }

    // When to post it
    const startInput = h('input', { type: 'datetime-local', class: 'input', value: toLocalInput(draft.start.at || Date.now() + 3600e3) });
    startInput.addEventListener('change', () => { draft.start.at = fromLocalInput(startInput.value); });
    const startBox = h('div', { style: { display: draft.start.on ? '' : 'none' } }, field('Post on', startInput));

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
      const role = roles.find((r) => r.id === draft.requiredRole);
      const image = draft.imageFile ? await AnnouncePage.image(draft.imageFile) : draft.image;
      const when = draft.endsAt ? new Date(draft.endsAt).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '…';
      const n = Number(draft.winners) || 1;
      const mention = (r) => h('span', { class: 'rr-mention', style: r?.color ? { color: roleColor(r) } : null }, `@${r?.name || 'role'}`);
      const parts = [h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(bot, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(bot)), h('span', { class: 'badge peri' }, 'APP'))];
      if (ping) parts.push(h('div', { class: 'rr-text' }, h('span', { class: 'rr-mention', style: pingRole?.color ? { color: roleColor(pingRole) } : null }, ping)));
      const ranBy = draft.ranBy.name.trim().replace(/^ran by\s*:?\s*/i, '');
      const fields = draft.fields.filter((f) => f.name || f.value);
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
              ranBy ? h('div', { class: 'announce-author' }, draft.ranBy.icon ? h('img', { src: draft.ranBy.icon, alt: '' }) : null, `Ran by ${ranBy}`) : null,
              h('div', { class: 'rr-title' }, `🎉 ${draft.prize.trim() || 'Your prize'}`),
              h(
                'div',
                { class: 'rr-text' },
                draft.description.trim() ? [Updater.inline(draft.description.trim()), h('br'), h('br')] : null,
                'React with ',
                emojiNode(draft.emoji, 16),
                ' to enter!',
                h('br'),
                h('b', null, 'Winners:'),
                ` ${n}`,
                h('br'),
                h('b', null, 'Enter by:'),
                ` ${when} (${draft.endsAt ? fmtRelative(draft.endsAt) : '…'})`,
                role ? [h('br'), 'Only members with ', mention(role), ' can win.'] : null,
              ),
              fields.length ? h('div', { class: 'announce-fields' }, fields.map((f) => h('div', { class: f.inline ? 'inline' : 'full' }, h('b', null, f.name), h('div', { class: 'rr-text' }, Updater.inline(f.value))))) : null,
            ),
            draft.thumbnail.trim() ? h('img', { class: 'announce-thumb', src: draft.thumbnail.trim(), alt: '' }) : null,
          ),
          image ? h('img', { class: 'announce-image', src: image, alt: '' }) : null,
          draft.footer.trim() ? h('div', { class: 'poll-footer' }, draft.footer.trim()) : null,
        ),
        h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, h('span', { class: 'rr-reaction' }, emojiNode(draft.emoji, 16), h('span', null, '1'))),
      );
      preview.replaceChildren(...parts);
    }

    loadGuilds();
    drawImage();
    drawFields();
    drawPreview();

    const payload = () => ({
      ...draft,
      winners: Number(winnersInput.value),
      endsAt: fromLocalInput(endsInput.value),
      guildId: guildSel.value || draft.guildId,
      guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName,
      channelId: channelSel.value || draft.channelId,
      channelName: (channelSel.selectedOptions[0]?.textContent || '').replace(/^#/, '').replace(/ \(announcements\)$/, '') || draft.channelName,
      ping: pingSel.value,
      pingName: (pingSel.selectedOptions[0]?.textContent || '').replace(/^@/, ''),
      requiredRole: roleSel.value,
      requiredRoleName: roleSel.value ? (roleSel.selectedOptions[0]?.textContent || '').replace(/^@/, '') : '',
    });
    const check = () => {
      if (!posted && (!guildSel.value || !channelSel.value)) throw new Error('Pick the server and channel.');
    };
    const save = async ({ post = false } = {}) => {
      check();
      const p = payload();
      if (post && p.ping !== 'none' && !(await confirmDialog({ title: 'Post it now?', message: `This pings ${GiveawaysPage.pingText(p)}.`, confirmLabel: 'Post' }))) return false;
      GiveawaysPage.data = await api('giveaways:save', draft.botId, post ? { ...p, start: { ...p.start, on: false } } : p, { post });
      if (posted) toast('Saved, and the post in Discord now matches');
      else toast(post ? `Posted in #${p.channelName}` : p.start.on ? `Scheduled for ${fmtWhen(p.start.at)}` : 'Saved as a draft');
      GiveawaysPage.rerender();
    };
    const actions = posted
      ? [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save and update in Discord', kind: 'primary', icon: 'refresh', onClick: () => save() }]
      : [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'ghost', icon: 'save', onClick: () => save() }, { label: 'Post now', kind: 'primary', icon: 'send', onClick: () => save({ post: true }) }];

    return openModal({
      title: existing ? `Edit "${existing.prize}"` : 'New giveaway',
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
          posted ? h('p', { class: 'hint', style: { margin: 0 } }, "It's already posted, so it stays in its channel. Saving updates the post.") : null,
          field('Prize', input(draft, 'prize', { maxlength: 200, placeholder: 'e.g. 1 month of Discord Nitro' })),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Ran by (optional)', input(draft.ranBy, 'name', { maxlength: 248, placeholder: 'e.g. Meg (mod)' }), 'Shown at the top as "Ran by …".'), field('Ran by picture (link)', input(draft.ranBy, 'icon', { placeholder: 'https://…', maxlength: 2048 }), 'A small round picture next to it.')),
          field('Text (optional)', input(draft, 'description', { rows: 3, maxlength: 2000, placeholder: 'How to claim it, rules…' }), 'Discord formatting works: **bold**, *italics*, [links](https://…) and more.'),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Winners', winnersInput, `1 to ${GIVEAWAY_MAX_WINNERS}`), field('Enter by', endsInput, "The winners are picked then, at your PC's time.")),
          field('Who can win', roleSel, 'Anyone can enter, but only members with this role can be picked.'),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Enter with', emojiField, posted ? 'Members already react with it, so it stays.' : 'Members react with this to enter. Server emojis work too.'), field('Colour', colour)),
          h(
            'div',
            { class: 'ticket-section' },
            h('div', { class: 'ticket-section-title' }, 'More on the card (optional)'),
            h('div', { class: 'row' }, h('div', { class: 'label grow' }, 'Fields'), addField),
            fieldsHost,
            field('Big picture', imageHost),
            field('Small picture, top right (link)', input(draft, 'thumbnail', { placeholder: 'https://…', maxlength: 2048 })),
            field('Footer', input(draft, 'footer', { maxlength: 2048, placeholder: 'Small text at the bottom of the card' })),
          ),
          posted ? null : h('div', { class: 'ticket-section' }, switchEl(draft.start.on, (v) => { draft.start.on = v; startBox.style.display = v ? '' : 'none'; }, 'Post it later'), startBox, h('p', { class: 'hint', style: { margin: 0 } }, 'Scheduled giveaways are posted while this app is open or in the tray, or by your mod portal with Run 24/7. Winners are picked the same way.')),
        ),
        h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview'), preview),
      ),
      actions,
    });
  },
};

// Something was posted or drawn: refresh the list if it's showing and something changed.
onEvent('giveaways:changed', () => {
  if (App.route.page !== 'giveaways' || document.querySelector('#modal-root .modal')) return;
  api('giveaways:list')
    .then((data) => {
      if (JSON.stringify(data) === JSON.stringify(GiveawaysPage.data)) return;
      GiveawaysPage.data = data;
      GiveawaysPage.error = null;
      GiveawaysPage.rerender();
    })
    .catch(() => {});
});
